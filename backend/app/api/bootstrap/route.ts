import { context, noStore, replyError, unwrap } from '@/lib/api'
import { statusCounts, type LineState } from '@/lib/status'

export async function GET(request: Request) {
  try {
    const { db, user } = await context(request)
    const profile = unwrap(await db.from('profiles').select('id,role,full_name,nrp,class_name,program_code').eq('id', user.id).single())
    const attendance = profile.role === 'student'
      ? unwrap(await db.from('attendance').select('id,class_date,course_name,week_no,status').eq('student_id', user.id).eq('status', 'A').order('class_date'))
      : []
    const requests = profile.role === 'student'
      ? unwrap(await db.from('form14_requests').select('id,status,current_version_id,created_at,updated_at').eq('student_id', user.id).order('created_at', { ascending: false }))
      : unwrap(await db.from('form14_requests').select('id,status,current_version_id,created_at,updated_at,profiles!form14_requests_student_id_fkey(full_name,nrp,program_code)').neq('status', 'draft').order('created_at', { ascending: false }))
    const versions = requests.length
      ? unwrap(await db.from('form14_versions').select('id,request_id,version_no').in('request_id', requests.map(r => r.id)))
      : []
    const lines = versions.length
      ? unwrap(await db.from('form14_lines').select('version_id,attendance_id,state').in('version_id', versions.map(v => v.id)))
      : []
    const versionById = new Map(versions.map(v => [v.id, v]))
    const linesByRequest = new Map<string, { attendance_id: string; state: LineState; version_no: number }[]>()
    for (const line of lines) {
      const version = versionById.get(line.version_id)
      if (!version) continue
      const list = linesByRequest.get(version.request_id) ?? []
      list.push({ attendance_id: line.attendance_id, state: line.state as LineState, version_no: version.version_no })
      linesByRequest.set(version.request_id, list)
    }
    return noStore({
      profile, attendance, requests: requests.map(r => ({ ...r, status_counts: statusCounts(linesByRequest.get(r.id) ?? []) })),
      form14_statement: 'Demikian pernyataan ini saya buat dengan penuh tanggung jawab dan untuk dipergunakan sesuai Peraturan Akademik yang berlaku di Politeknik Elektronika Negeri Surabaya.',
      reason_mapping: { forgot_ethol: 'H', sick: 'S', permission: 'I' },
      reason_mapping_source: 'Penjelasan pemilik kebutuhan; bukan teks Form 14',
    })
  } catch (error) { return replyError(error) }
}
