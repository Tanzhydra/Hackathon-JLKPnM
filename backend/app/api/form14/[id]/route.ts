import { context, noStore, replyError, unwrap, ApiError } from '@/lib/api'
import { id } from '@/lib/validation'
import { statusCounts, type LineState } from '@/lib/status'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const requestId = id.parse((await params).id)
    const { db } = await context(request)
    const form = unwrap(await db.from('form14_requests').select('id,student_id,status,current_version_id,created_at,updated_at').eq('id', requestId).maybeSingle())
    if (!form) throw new ApiError(404, 'Permohonan tidak ditemukan')
    const versions = unwrap(await db.from('form14_versions').select('id,version_no,name_snapshot,nrp_snapshot,class_snapshot,program_snapshot,statement_date,form_path,submitted_at,created_at').eq('request_id', requestId).order('version_no'))
    const lines = unwrap(await db.from('form14_lines').select('id,version_id,line_no,attendance_id,class_date,course_name,week_no,lecturer_name,reason,permission_kind,doctor_path,target_status,state,reviewed_by,reviewed_at,review_reason,student_signature_checked,lecturer_signature_checked,doctor_letter_checked,applied_at').in('version_id', versions.map(v => v.id)).order('line_no'))
    const audit = unwrap(await db.from('form14_audit').select('id,version_id,line_id,actor_id,action,reason,created_at').eq('request_id', requestId).order('id'))
    const scans = unwrap(await db.from('form14_scans').select('id,status,version_id,form_path,doctor_path,extraction,issues,model_version,rule_version,processed_at').eq('request_id', requestId).order('created_at'))
    const versionNumbers = new Map(versions.map(v => [v.id, v.version_no]))
    const counts = statusCounts(lines.map(l => ({ attendance_id: l.attendance_id, state: l.state as LineState, version_no: versionNumbers.get(l.version_id)! })))
    return noStore({ form, status_counts: counts, versions: versions.map(v => ({ ...v, lines: lines.filter(l => l.version_id === v.id) })), scans, audit })
  } catch (error) { return replyError(error) }
}
