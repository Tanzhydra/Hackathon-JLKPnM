import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError, context, json, noStore, replyError } from '@/lib/api'

const profileInput = z.object({
  full_name: z.string().trim().min(2).max(120),
  nrp: z.string().trim().min(2).max(40),
  class_name: z.string().trim().min(2).max(80),
  program_code: z.string().trim().min(2).max(40),
}).strict()

export async function POST(request: Request) {
  try {
    const { db, user } = await context(request)
    const existing = await db.from('profiles').select('id,role').eq('id', user.id).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) return noStore(existing.data)
    const input = profileInput.parse(await json(request))
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new ApiError(503, 'Pendaftaran profil belum dikonfigurasi')
    const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await service.from('profiles').insert({ id: user.id, role: 'student', ...input }).select('id,role').single()
    if (error) throw error
    return noStore(data, 201)
  } catch (error) { return replyError(error) }
}
