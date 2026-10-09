import { context, json, noStore, replyError, unwrap } from '@/lib/api'
import { decision, id } from '@/lib/validation'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const lineId = id.parse((await params).id)
    const input = decision.parse(await json(request))
    const { db } = await context(request)
    return noStore(unwrap(await db.rpc('form14_decide', {
      p_line: lineId, p_decision: input.decision, p_reason: input.reason,
      p_student_signature_checked: input.student_signature_checked,
      p_lecturer_signature_checked: input.lecturer_signature_checked,
      p_doctor_letter_checked: input.doctor_letter_checked,
    })))
  } catch (error) { return replyError(error) }
}
