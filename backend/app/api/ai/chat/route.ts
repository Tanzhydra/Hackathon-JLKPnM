import { context, replyError, ApiError } from '@/lib/api'
import { chatCompletion } from '@/lib/llm'
import { buildDashboardPrompt } from '@/lib/dashboard-summary'
import { buildRagPrompt, NO_SOURCE_REPLY } from '@/lib/rag'

export async function POST(request: Request) {
  try {
    const { db, user } = await context(request)

    // Parse body
    const body = await request.json().catch(() => {
      throw new ApiError(400, 'JSON tidak valid')
    })
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Isi permintaan tidak valid')
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message || message.length > 1000) {
      throw new ApiError(400, 'Pesan harus 1-1000 karakter')
    }
    if (body.context !== 'dashboard' && body.context !== 'general') throw new ApiError(400, 'Konteks tidak valid')
    if (body.stream === true) throw new ApiError(400, 'Streaming belum tersedia')
    const mode: 'dashboard' | 'general' = body.context

    // Get user profile for role check
    const { data: profile, error: profileError } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (profileError) throw profileError

    // Build prompt based on mode
    let messages
    let snapshot
    let sources
    if (mode === 'dashboard') {
      // Only officers can summarize dashboard
      if (profile?.role !== 'officer') {
        throw new ApiError(403, 'Hanya pegawai yang dapat merangkum dashboard')
      }
      const dashboard = await buildDashboardPrompt(db)
      messages = dashboard.messages
      snapshot = dashboard.snapshot
    } else {
      const rag = await buildRagPrompt(db, message)
      if (!rag) return Response.json({ reply: NO_SOURCE_REPLY, sources: [] }, { headers: { 'Cache-Control': 'no-store' } })
      messages = rag.messages
      sources = rag.sources
    }

    const reply = snapshot?.total === 0
      ? 'Belum ada pengajuan dalam lingkup program Anda.'
      : await chatCompletion(messages, { max_tokens: mode === 'dashboard' ? 250 : 180, temperature: 0.2 })
    return Response.json({ reply, ...(snapshot ? { snapshot } : {}), ...(sources ? { sources } : {}) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return replyError(error)
  }
}
