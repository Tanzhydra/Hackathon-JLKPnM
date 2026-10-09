import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { context, replyError, unwrap, ApiError } from '@/lib/api'
import { id } from '@/lib/validation'

const label: Record<string, string> = {
  draft: 'Draf', submitted: 'Diajukan', needs_fix: 'Perlu perbaikan',
  rejected: 'Ditolak', approved_pending: 'Disetujui, menunggu pembaruan',
  applied: 'Selesai', conflict: 'Konflik data sumber',
}

function printable(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '?')
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const requestId = id.parse((await params).id)
    const { db } = await context(request)
    const form = unwrap(await db.from('form14_requests').select('id,status,current_version_id,student_id').eq('id', requestId).maybeSingle())
    if (!form) throw new ApiError(404, 'Permohonan tidak ditemukan')
    const version = unwrap(await db.from('form14_versions').select('id,version_no,name_snapshot,nrp_snapshot,class_snapshot,program_snapshot,statement_date,submitted_at').eq('id', form.current_version_id).maybeSingle())
    if (!version) throw new ApiError(404, 'Versi tidak ditemukan')
    const versions = unwrap(await db.from('form14_versions').select('id,version_no').eq('request_id', requestId).order('version_no', { ascending: false }))
    const allLines = unwrap(await db.from('form14_lines').select('line_no,version_id,class_date,course_name,week_no,reason,permission_kind,target_status,state,review_reason,applied_at,attendance_id').in('version_id', versions.map(v => v.id)))
    const byAttendance = new Map<string, (typeof allLines)[number]>()
    for (const candidate of allLines) {
      const current = byAttendance.get(candidate.attendance_id)
      if (!current || versions.findIndex(v => v.id === candidate.version_id) < versions.findIndex(v => v.id === current.version_id))
        byAttendance.set(candidate.attendance_id, candidate)
    }
    const lines = [...byAttendance.values()].sort((a, b) => a.line_no - b.line_no)
    const source = lines.length ? unwrap(await db.from('attendance').select('id,status').in('id', lines.map(l => l.attendance_id))) : []
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([498.9, 708.66]) // ISO B5, points
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const ink = rgb(0.12, 0.17, 0.25)
    const draw = (value: string, x: number, y: number, size = 10, emphasis = false) =>
      page.drawText(printable(value).slice(0, 88), { x, y, size, font: emphasis ? bold : font, color: ink })
    draw('HASIL KOREKSI PRESENSI DEMO', 32, 668, 15, true)
    draw('Form 14 - Surat Pernyataan Tidak Menggunakan PENS Attendance', 32, 646, 9)
    draw(`Nomor: ${form.id}`, 32, 615, 10)
    draw(`Mahasiswa: ${version.name_snapshot}`, 32, 597)
    draw(`NRP/Kelas: ${version.nrp_snapshot} / ${version.class_snapshot}`, 32, 579)
    draw(`Program Studi: ${version.program_snapshot}`, 32, 561)
    draw(`Versi: ${version.version_no} | Status: ${label[form.status] ?? form.status}`, 32, 543)
    draw(`Tanggal pernyataan: ${version.statement_date}`, 32, 525)
    page.drawLine({ start: { x: 32, y: 511 }, end: { x: 467, y: 511 }, thickness: 0.7, color: ink })
    let y = 487
    for (const line of lines) {
      const stored = source.find(a => a.id === line.attendance_id)?.status ?? '?'
      draw(`${line.line_no}. ${line.class_date} | ${line.course_name} | Minggu ${line.week_no}`, 32, y, 10, true)
      draw(`Alasan: ${line.reason}${line.permission_kind ? ` (${line.permission_kind})` : ''}`, 43, y - 17, 9)
      draw(`Keputusan: ${label[line.state] ?? line.state} | Target: ${line.target_status} | Tersimpan: ${stored}`, 43, y - 34, 9)
      if (line.review_reason) draw(`Catatan petugas: ${line.review_reason}`, 43, y - 51, 9)
      y -= 75
    }
    page.drawLine({ start: { x: 32, y: 95 }, end: { x: 467, y: 95 }, thickness: 0.7, color: ink })
    draw('Hasil dari data demo. Perubahan sistem presensi resmi tidak dilakukan.', 32, 78, 8)
    draw('Salinan Form 14 bertanda tangan dan bukti tersimpan secara terpisah.', 32, 64, 8)
    const bytes = await pdf.save()
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="form14-${requestId}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) { return replyError(error) }
}
