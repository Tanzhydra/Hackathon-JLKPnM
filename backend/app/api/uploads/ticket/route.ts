import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { context, json, noStore, replyError, ApiError } from '@/lib/api'

const inputSchema = z.object({
  mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  purpose: z.enum(['signed_form', 'doctor_letter']),
})

export async function POST(request: Request) {
  try {
    const { db, user } = await context(request)
    const input = inputSchema.parse(await json(request))
    const profile = await db.from('profiles').select('role').eq('id', user.id).single()
    if (profile.error || profile.data?.role !== 'student') throw new ApiError(403, 'Hanya mahasiswa dapat mengunggah')
    const extension = input.mime_type === 'application/pdf' ? 'pdf' : input.mime_type === 'image/png' ? 'png' : 'jpg'
    const path = `${user.id}/${input.purpose}/${randomUUID()}.${extension}`
    const { data, error } = await db.storage.from('form14-private').createSignedUploadUrl(path)
    if (error || !data) throw new ApiError(500, 'Tiket unggah gagal dibuat')
    return noStore({ path, token: data.token, signed_url: data.signedUrl, max_bytes: 10485760 }, 201)
  } catch (error) { return replyError(error) }
}
