import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError, context, json, noStore, replyError, unwrap } from '@/lib/api'
import { checkExtraction } from '@/lib/scan'
import { readForm14, visionModelVersion } from '@/lib/vision'

const inputSchema = z.object({
  submission_key: z.string().min(8).max(100),
  request_id: z.uuid().nullable().optional(),
  form_path: z.string().min(1).max(300),
  doctor_path: z.string().min(1).max(300).nullable().optional(),
}).strict()

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new ApiError(503, 'Kunci server Supabase belum dikonfigurasi')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function POST(request: Request) {
  try {
    const { db, user } = await context(request)
    const input = inputSchema.parse(await json(request))
    const service = serviceClient()
    const started = unwrap(await db.rpc('form14_scan_start', {
      p_key: input.submission_key, p_request: input.request_id ?? null,
      p_form_path: input.form_path, p_doctor_path: input.doctor_path ?? null,
    })) as { scan_id: string; status: string; request_id: string | null }
    if (started.status === 'submitted') return noStore(started)
    if (started.status === 'ready')
      return noStore(unwrap(await db.rpc('form14_scan_submit', { p_scan: started.scan_id })), 201)
    if (started.status === 'needs_reupload') return noStore({ ...started, issues: ['Unggah scan baru dengan submission_key baru'] }, 422)
    const eligible = started.status === 'uploaded' || started.status === 'ai_failed'
    const stale = started.status === 'processing' && await service.from('form14_scans').select('updated_at')
      .eq('id', started.scan_id).single().then(({ data }) => data && Date.now() - Date.parse(data.updated_at) > 240_000)
    if (!eligible && !stale) return noStore(started, 202)
    let claim = service.from('form14_scans').update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', started.scan_id).eq('status', started.status)
    if (stale) claim = claim.lt('updated_at', new Date(Date.now() - 120_000).toISOString())
    const claimed = await claim.select('id')
    if (claimed.error) throw claimed.error
    if (!claimed.data?.length) return noStore({ ...started, status: 'processing' }, 202)
    await service.from('form14_scan_events').insert({ scan_id: started.scan_id, actor: 'vision-service', action: 'processing', rule_version: 'scan-v1' })
    try {
      const downloaded = await db.storage.from('form14-private').download(input.form_path)
      if (downloaded.error || !downloaded.data) throw new ApiError(409, 'Scan belum berhasil diunggah')
      const extraction = await readForm14(await downloaded.data.arrayBuffer(), input.form_path)
      const profile = unwrap(await db.from('profiles').select('full_name,nrp,class_name,program_code').eq('id', user.id).single())
      const attendance = unwrap(await db.from('attendance').select('id,class_date,course_name,week_no,status').eq('student_id', user.id))
      const checked = checkExtraction(extraction, profile, attendance, input.doctor_path ?? null)
      const status = checked.issues.length ? 'needs_reupload' : 'ready'
      unwrap(await service.from('form14_scans').update({
        status, extraction, validated_lines: checked.lines,
        statement_date: /^\d{4}-\d{2}-\d{2}$/.test(extraction.statement_date.text) ? extraction.statement_date.text : null,
        issues: checked.issues, model_version: visionModelVersion(),
        rule_version: 'scan-v1', processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', started.scan_id).select('id').single())
      await service.from('form14_scan_events').insert({ scan_id: started.scan_id, actor: 'vision-service', action: status,
        reason: checked.issues.join('; ') || null, model_version: visionModelVersion(), rule_version: 'scan-v1' })
      if (checked.issues.length) return noStore({ scan_id: started.scan_id, status, issues: checked.issues }, 422)
    } catch (error) {
      await service.from('form14_scans').update({ status: 'ai_failed', issues: ['Pembacaan atau pengajuan gagal'],
        updated_at: new Date().toISOString() }).eq('id', started.scan_id).eq('status', 'processing')
      await service.from('form14_scan_events').insert({ scan_id: started.scan_id, actor: 'vision-service', action: 'ai_failed',
        reason: error instanceof Error ? error.message.slice(0, 300) : 'Kesalahan tidak diketahui', rule_version: 'scan-v1' })
      throw error
    }
    return noStore(unwrap(await db.rpc('form14_scan_submit', { p_scan: started.scan_id })), 201)
  } catch (error) { return replyError(error) }
}
