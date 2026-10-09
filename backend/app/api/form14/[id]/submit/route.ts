import { context, noStore, replyError } from '@/lib/api'

export async function POST(request: Request) {
  try {
    await context(request)
    return noStore({ error: 'Pengajuan dilakukan otomatis setelah pemeriksaan scan' }, 410)
  } catch (error) { return replyError(error) }
}
