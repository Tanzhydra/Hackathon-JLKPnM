import { context, noStore, replyError } from '@/lib/api'

export async function POST(request: Request) {
  try {
    await context(request)
    return noStore({ error: 'Gunakan /api/scans untuk mengunggah dan membaca Form 14' }, 410)
  } catch (error) { return replyError(error) }
}
