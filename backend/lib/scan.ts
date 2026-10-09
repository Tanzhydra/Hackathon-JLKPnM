import { z } from 'zod'

const field = z.object({
  text: z.string().trim().max(300),
  confidence: z.number().min(0).max(1),
  location: z.string().trim().max(200),
})
const mark = z.object({ present: z.boolean(), confidence: z.number().min(0).max(1), location: z.string().trim().max(200) })
export const extractionSchema = z.object({
  name: field, nrp: field, class_name: field, program: field, statement_date: field,
  student_signature: mark,
  lines: z.array(z.object({
    class_date: field, course_name: field, week_no: field,
    lecturer_name: field, lecturer_signature: mark, reason: field,
  })).min(1).max(5),
})
export type Extraction = z.infer<typeof extractionSchema>

export type Attendance = { id: string; class_date: string; course_name: string; week_no: number; status: string }
export type Profile = { full_name: string; nrp: string | null; class_name: string | null; program_code: string }

const normalize = (value: string) => value.trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ')
const months = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus',
  'september', 'oktober', 'november', 'desember']

export function normalizeScanDate(value: string) {
  const match = value.trim().toLocaleLowerCase('id-ID').match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/)
  if (!match) return value.trim()
  const month = months.indexOf(match[2]) + 1
  if (!month) return value.trim()
  const day = Number(match[1])
  const year = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return value.trim()
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
const confident = (value: { confidence: number; text?: string }, threshold: number) =>
  value.confidence >= threshold && (value.text === undefined || value.text.trim().length > 0)

export function classifyReason(text: string): { reason: 'forgot_ethol' | 'sick' | 'permission'; permission_kind?: string } | null {
  const value = normalize(text)
  if (/\b(sakit)\b/.test(value)) return { reason: 'sick' }
  if (/lupa.*(absen|presensi|ethol)|(?:absen|presensi).*lupa/.test(value)) return { reason: 'forgot_ethol' }
  const kind = value.replace(/^(izin|ijin)(\s+karena|\s+untuk|\s*[:,-])?\s*/, '').trim()
  if (/^(izin|ijin)\b/.test(value) && kind.length >= 3 && !/^(lainnya?|keperluan|urusan|pribadi|tidak masuk)$/.test(kind))
    return { reason: 'permission', permission_kind: kind }
  return null
}

export function checkExtraction(extraction: Extraction, profile: Profile, attendance: Attendance[], doctorPath: string | null, threshold = 0.8) {
  const issues: string[] = []
  const required = ['name', 'nrp', 'class_name', 'program', 'statement_date'] as const
  for (const key of required) if (!confident(extraction[key], threshold)) issues.push(`${key}: kosong atau keyakinan rendah`)
  if (normalize(extraction.nrp.text) !== normalize(profile.nrp ?? '')) issues.push('NRP tidak sesuai akun')
  if (normalize(extraction.name.text) !== normalize(profile.full_name)) issues.push('Nama tidak sesuai akun')
  if (normalize(extraction.class_name.text) !== normalize(profile.class_name ?? '')) issues.push('Kelas tidak sesuai akun')
  if (normalize(extraction.program.text) !== normalize(profile.program_code)) issues.push('Program studi tidak sesuai akun')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(extraction.statement_date.text) ||
      Number.isNaN(Date.parse(extraction.statement_date.text)) ||
      new Date(extraction.statement_date.text).toISOString().slice(0, 10) !== extraction.statement_date.text)
    issues.push('Tanggal pernyataan tidak valid')
  if (!extraction.student_signature.present || !confident(extraction.student_signature, threshold)) issues.push('Area tanda tangan mahasiswa kosong atau tidak yakin')
  const seen = new Set<string>()
  const lines: Array<Record<string, unknown>> = []
  if (extraction.lines.length === 0) issues.push('Tidak ada baris kejadian yang terisi')
  for (const [index, row] of extraction.lines.entries()) {
    const prefix = `Baris ${index + 1}`
    for (const key of ['class_date', 'course_name', 'week_no', 'lecturer_name', 'reason'] as const)
      if (!confident(row[key], threshold)) issues.push(`${prefix}: ${key} kosong atau keyakinan rendah`)
    if (!row.lecturer_signature.present || !confident(row.lecturer_signature, threshold)) issues.push(`${prefix}: tanda tangan dosen kosong atau tidak yakin`)
    if (row.lecturer_name.text.trim().length < 2) issues.push(`${prefix}: nama dosen belum lengkap`)
    const week = Number(row.week_no.text)
    if (!Number.isInteger(week) || week < 1 || week > 30) issues.push(`${prefix}: minggu tidak valid`)
    const matched = attendance.filter(item => item.class_date === row.class_date.text &&
      normalize(item.course_name) === normalize(row.course_name.text) && item.week_no === week && item.status === 'A')
    if (matched.length !== 1) issues.push(`${prefix}: tidak cocok dengan tepat satu catatan A`)
    const reason = classifyReason(row.reason.text)
    if (!reason) issues.push(`${prefix}: alasan atau jenis izin tidak spesifik`)
    if (reason?.reason === 'sick' && !doctorPath) issues.push(`${prefix}: surat dokter belum diunggah`)
    if (matched[0] && seen.has(matched[0].id)) issues.push(`${prefix}: catatan A dipakai dua kali`)
    if (matched[0]) seen.add(matched[0].id)
    if (matched.length === 1 && reason) lines.push({
      attendance_id: matched[0].id, class_date: matched[0].class_date,
      course_name: matched[0].course_name, week_no: matched[0].week_no,
      lecturer_name: row.lecturer_name.text, reason: reason.reason,
      permission_kind: reason.permission_kind ?? null,
      doctor_path: reason.reason === 'sick' ? doctorPath : null,
    })
  }
  return { issues, lines }
}
