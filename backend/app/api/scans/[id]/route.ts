import { context, noStore, replyError, unwrap } from '@/lib/api'
import { id } from '@/lib/validation'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scanId = id.parse((await params).id)
    const { db } = await context(request)
    const scan = unwrap(await db.from('form14_scans').select('id,status,request_id,version_id,form_path,doctor_path,extraction,issues,model_version,rule_version,created_at,processed_at').eq('id', scanId).maybeSingle())
    const events = unwrap(await db.from('form14_scan_events').select('actor,action,reason,model_version,rule_version,created_at').eq('scan_id', scanId).order('id'))
    return noStore({ scan, events })
  } catch (error) { return replyError(error) }
}
