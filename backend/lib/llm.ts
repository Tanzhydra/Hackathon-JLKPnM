import { ApiError } from './api.ts'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type LLMOptions = { temperature?: number; max_tokens?: number; model?: string }

const DEFAULT_BASE_URL = 'https://litellm-hackathon.digdaya.ai/v1'
const DEFAULT_MODEL = 'qwen3.8-flash'
const TIMEOUT_MS = 25000

function configuration() {
  const base = process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL
  let url: URL
  try { url = new URL(base) } catch { throw new ApiError(503, 'Konfigurasi layanan AI tidak valid') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ApiError(503, 'Konfigurasi layanan AI tidak valid')
  }
  const model = process.env.AI_MODEL?.trim() || DEFAULT_MODEL
  const key = process.env.AI_API_KEY?.trim()
  if (!key) throw new ApiError(503, 'Layanan AI belum dikonfigurasi')
  return { baseUrl: base.replace(/\/+$/, ''), model, key }
}

export async function chatCompletion(messages: ChatMessage[], options?: LLMOptions): Promise<string> {
  const { baseUrl, model, key } = configuration()
  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: options?.model || model,
        messages,
        stream: false,
        ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options?.max_tokens === undefined ? {} : { max_tokens: options.max_tokens }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new ApiError(502, 'Layanan AI tidak dapat dihubungi atau waktu tunggu habis')
  }
  if (!response.ok) {
    if (response.status === 429) throw new ApiError(429, 'Layanan AI sedang sibuk; coba lagi nanti')
    if (response.status === 401 || response.status === 403) throw new ApiError(503, 'Akses layanan AI belum tersedia')
    throw new ApiError(502, 'Layanan AI gagal memproses permintaan')
  }
  let data: unknown
  try { data = await response.json() } catch { throw new ApiError(502, 'Respons layanan AI tidak valid') }
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new ApiError(502, 'Respons layanan AI tidak valid')
  return content
}
