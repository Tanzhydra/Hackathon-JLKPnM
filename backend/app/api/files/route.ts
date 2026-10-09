import { context, noStore, replyError, ApiError } from '@/lib/api'

export async function GET(request: Request) {
  try {
    const { db } = await context(request)
    const path = new URL(request.url).searchParams.get('path')
    if (!path || path.length > 300) throw new ApiError(400, 'Path berkas tidak valid')
    const { data, error } = await db.storage.from('form14-private').createSignedUrl(path, 60)
    if (error || !data) throw new ApiError(403, 'Berkas tidak dapat diakses')
    return noStore({ url: data.signedUrl, expires_in: 60 })
  } catch (error) { return replyError(error) }
}
