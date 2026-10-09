import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { ZodError } from 'zod'

export class ApiError extends Error {
  public status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function context(request: Request): Promise<{ db: SupabaseClient; user: User }> {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) throw new ApiError(401, 'Sesi diperlukan')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new ApiError(503, 'Supabase belum dikonfigurasi')
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await db.auth.getUser(token)
  if (error?.status === 0) {
    console.error('Supabase auth unreachable', { name: error.name, message: error.message })
    throw new ApiError(503, 'Layanan autentikasi tidak dapat dihubungi oleh server. Periksa koneksi server ke Supabase.')
  }
  if (error || !data.user) {
    console.error('Supabase session validation failed', { status: error?.status, code: error?.code, message: error?.message })
    throw new ApiError(401, 'Sesi tidak valid')
  }
  return { db, user: data.user }
}

export async function json(request: Request): Promise<unknown> {
  try { return await request.json() } catch { throw new ApiError(400, 'JSON tidak valid') }
}

const knownErrors: Record<string, [number, string]> = {
  AUTH_REQUIRED: [401, 'Sesi diperlukan'], STUDENT_REQUIRED: [403, 'Hanya mahasiswa'],
  OFFICER_DENIED: [403, 'Petugas di luar lingkup atau versi tidak berlaku'],
  REQUEST_DENIED: [403, 'Permohonan tidak dapat diakses'],
  INVALID_FORM: [400, 'Data formulir tidak valid'], INVALID_LINE: [400, 'Baris tidak valid'],
  LINE_COUNT: [400, 'Form 14 harus berisi 1 sampai 5 baris'],
  LINE_MISMATCH: [400, 'Baris tidak cocok dengan catatan presensi'],
  INCOMPLETE_FORM: [400, 'Formulir belum lengkap'],
  PERMISSION_KIND_REQUIRED: [400, 'Jenis izin harus dijelaskan'],
  DOCTOR_LETTER_REQUIRED: [400, 'Surat dokter diperlukan'],
  FORM_UPLOAD_MISSING: [409, 'Salinan Form 14 belum berhasil diunggah'],
  DOCTOR_UPLOAD_MISSING: [409, 'Surat dokter belum berhasil diunggah'],
  ATTENDANCE_UNAVAILABLE: [409, 'Catatan presensi tidak lagi berstatus A'],
  ALREADY_CLAIMED: [409, 'Catatan A sudah ada pada permohonan aktif'],
  REVISION_NOT_ALLOWED: [409, 'Versi ini belum dapat diperbaiki'],
  ALREADY_REVIEWED: [409, 'Baris sudah diputuskan'],
  NOT_APPROVED: [409, 'Baris belum disetujui'],
  REASON_REQUIRED: [400, 'Keputusan memerlukan alasan'],
  SIGNATURE_CHECK_REQUIRED: [400, 'Tanda tangan mahasiswa dan dosen harus diperiksa sebelum persetujuan'],
  DOCTOR_CHECK_REQUIRED: [400, 'Surat dokter harus diperiksa sebelum persetujuan'],
  SCAN_NOT_READY: [409, 'Scan belum lolos pemeriksaan otomatis'],
}

export function replyError(error: unknown): Response {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status })
  if (error instanceof ZodError) return Response.json({ error: 'Isian tidak valid', details: error.issues }, { status: 400 })
  const code = error instanceof Error ? error.message : ''
  const mapped = knownErrors[code]
  if (mapped) return Response.json({ error: mapped[1], code }, { status: mapped[0] })
  if (code === '23505') return Response.json({ error: 'Data sudah ada' }, { status: 409 })
  console.error('Form 14 API error', error)
  return Response.json({ error: 'Operasi gagal; muat ulang status sebelum mencoba lagi' }, { status: 500 })
}

export function unwrap<T>(result: { data: T; error: { message: string; code?: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(knownErrors[result.error.message] ? result.error.message : (result.error.code || result.error.message))
  if (result.data == null) throw new ApiError(404, 'Data tidak ditemukan')
  return result.data as NonNullable<T>
}

export function noStore(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}
