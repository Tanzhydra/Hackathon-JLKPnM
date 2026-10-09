import { type SupabaseClient } from '@supabase/supabase-js'
import { type ChatMessage } from './llm.ts'
import { ApiError, unwrap } from './api.ts'

const STATUSES = ['submitted', 'approved_pending', 'needs_fix', 'rejected', 'complete', 'conflict'] as const
const REASONS = ['forgot_ethol', 'sick', 'permission'] as const
const MAX_REQUESTS = 1000

export interface DashboardSnapshot {
  snapshot_at: string
  total: number
  ready: number
  waiting: number
  rejected: number
  statuses: Record<(typeof STATUSES)[number], number>
  reasons: Record<(typeof REASONS)[number], number>
  recent: { status: string; created_at: string }[]
}

const DASHBOARD_SYSTEM_PROMPT = `Anda membantu petugas BAAK memahami antrean pengajuan.
Tulis satu paragraf alami dalam bahasa Indonesia, 2-3 kalimat pendek. Mulai dari keadaan antrean yang paling penting, lalu sebutkan pengajuan selesai atau alasan yang menonjol bila ada.
Gunakan hanya data yang diberikan. Jangan mengarang identitas, keputusan, atau tindakan. Jangan menyalin daftar angka mentah: abaikan kategori bernilai nol kecuali untuk menyatakan bahwa tidak ada pengajuan yang perlu ditindaklanjuti.
Jangan gunakan istilah teknis seperti snapshot, non-draf, kode status, atau waktu ISO. Waktu pengambilan data sudah ditampilkan terpisah di layar. Satu pengajuan dapat memiliki beberapa alasan, jadi jangan menyamakan jumlah alasan dengan jumlah pengajuan.`

function dashboardBrief(snapshot: DashboardSnapshot): string {
  const statusDetails = [
    ['baru diajukan', snapshot.statuses.submitted],
    ['menunggu penerapan keputusan', snapshot.statuses.approved_pending],
    ['perlu perbaikan', snapshot.statuses.needs_fix],
    ['mengalami konflik', snapshot.statuses.conflict],
    ['ditolak', snapshot.statuses.rejected],
    ['selesai', snapshot.statuses.complete],
  ] as const
  const reasonDetails = [
    ['lupa presensi', snapshot.reasons.forgot_ethol],
    ['sakit', snapshot.reasons.sick],
    ['izin', snapshot.reasons.permission],
  ] as const
  const nonzero = (items: readonly (readonly [string, number])[]) =>
    items.filter(([, count]) => count > 0).map(([label, count]) => `${label}: ${count}`).join('; ') || 'tidak ada'

  return `Jumlah pengajuan: ${snapshot.total}.
Siap divalidasi: ${snapshot.ready}; menunggu tindak lanjut: ${snapshot.waiting}; ditolak: ${snapshot.rejected}.
Status yang ada: ${nonzero(statusDetails)}.
Catatan alasan pada versi aktif: ${nonzero(reasonDetails)}.
Buat ringkasan untuk pegawai, bukan laporan tabel. Sebutkan angka penting hanya sekali.`
}

export async function buildDashboardPrompt(db: SupabaseClient): Promise<{ messages: ChatMessage[]; snapshot: DashboardSnapshot }> {
  // Klien pengguna dari context(request) membuat RLS membatasi program studi.
  const result = await db.from('form14_requests')
    .select('id,status,current_version_id,created_at', { count: 'exact' })
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(MAX_REQUESTS)
  const rows = unwrap(result)
  if (result.count == null || result.count > MAX_REQUESTS) throw new ApiError(503, 'Jumlah pengajuan tidak dapat dipastikan untuk ringkasan; gunakan dashboard langsung')

  const statuses = Object.fromEntries(STATUSES.map(status => [status, 0])) as DashboardSnapshot['statuses']
  for (const row of rows) {
    if (STATUSES.includes(row.status as (typeof STATUSES)[number])) statuses[row.status as (typeof STATUSES)[number]]++
  }

  const reasons = Object.fromEntries(REASONS.map(reason => [reason, 0])) as DashboardSnapshot['reasons']
  const versionIds = rows.map(row => row.current_version_id).filter((id): id is string => !!id)
  for (let start = 0; start < versionIds.length; start += 100) {
    const ids = versionIds.slice(start, start + 100)
    for (let offset = 0; ; offset += 1000) {
      const lines = unwrap(await db.from('form14_lines').select('version_id,reason')
        .in('version_id', ids).range(offset, offset + 999))
      for (const line of lines) {
        if (REASONS.includes(line.reason as (typeof REASONS)[number])) reasons[line.reason as (typeof REASONS)[number]]++
      }
      if (lines.length < 1000) break
    }
  }

  const snapshot: DashboardSnapshot = {
    snapshot_at: new Date().toISOString(),
    total: rows.length,
    ready: statuses.submitted + statuses.approved_pending,
    waiting: statuses.needs_fix + statuses.conflict,
    rejected: statuses.rejected,
    statuses,
    reasons,
    recent: rows.slice(0, 5).map(row => ({ status: row.status, created_at: row.created_at })),
  }
  return {
    snapshot,
    messages: [
      { role: 'system', content: DASHBOARD_SYSTEM_PROMPT },
      { role: 'user', content: dashboardBrief(snapshot) },
    ],
  }
}
