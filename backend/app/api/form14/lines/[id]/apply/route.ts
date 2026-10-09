import { context, noStore, replyError, unwrap } from '@/lib/api'
import { id } from '@/lib/validation'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const lineId = id.parse((await params).id)
    const { db } = await context(request)
    return noStore(unwrap(await db.rpc('form14_apply', { p_line: lineId })))
  } catch (error) { return replyError(error) }
}
