import { spawn } from 'node:child_process'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { ApiError } from './api.ts'
import { readForm14Ocr } from './fast-ocr.ts'

function verifyImage(bytes: Buffer, path: string) {
  const png = path.endsWith('.png') && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  const jpeg = path.endsWith('.jpg') && bytes[0] === 0xff && bytes[1] === 0xd8
  if (!png && !jpeg) throw new ApiError(400, 'Format gambar tidak sesuai unggahan')
  return bytes
}

// Form 14 has a fixed five-row table. The inner lecturer cell excludes grid lines.
// A blank lecturer cell must not be accepted as a signature.
async function inkFraction(image: Buffer, lineIndex: number, xRanges: [number, number][]) {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true })
  const top = Math.floor(info.height * (0.456 + lineIndex * 0.051))
  const bottom = Math.min(info.height, Math.floor(info.height * (0.494 + lineIndex * 0.051)))
  if (lineIndex < 0 || lineIndex > 4 || bottom <= top) return 0
  let dark = 0
  let total = 0
  for (let y = top; y < bottom; y++) for (const [from, to] of xRanges) {
    const left = Math.floor(info.width * from)
    const right = Math.floor(info.width * to)
    for (let x = left; x < right; x++) {
      if (data[(y * info.width + x) * info.channels] < 120) dark++
      total++
    }
  }
  return total ? dark / total : 0
}

export async function lecturerCellHasInk(image: Buffer, lineIndex: number) {
  return (await inkFraction(image, lineIndex, [[0.64, 0.76]])) >= 0.002
}

export async function formRowHasInk(image: Buffer, lineIndex: number) {
  return (await inkFraction(image, lineIndex, [[0.11, 0.26], [0.29, 0.49], [0.52, 0.60], [0.79, 0.95]])) >= 0.002
}

export async function renderPdf(bytes: Buffer): Promise<Buffer> {
  let pdf: PDFDocument
  try { pdf = await PDFDocument.load(bytes) }
  catch { throw new ApiError(400, 'PDF tidak dapat dibaca') }
  if (pdf.getPageCount() !== 1) throw new ApiError(400, 'Scan Form 14 PDF harus satu halaman')
  const command = process.env.FORM14_PDFTOPPM_PATH || 'pdftoppm'
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '1800', '-png', '-'],
      { stdio: ['pipe', 'pipe', 'pipe'], signal: AbortSignal.timeout(30_000) })
    const chunks: Buffer[] = []
    let size = 0
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 20_000_000) child.kill()
      else chunks.push(chunk)
    })
    child.stderr.resume()
    child.on('error', () => reject(new ApiError(503, 'Perender PDF Poppler tidak tersedia')))
    child.on('close', code => {
      if (code !== 0 || size > 20_000_000) return reject(new ApiError(502, 'PDF gagal diubah menjadi gambar'))
      const image = Buffer.concat(chunks)
      if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
        return reject(new ApiError(502, 'Hasil render PDF tidak valid'))
      resolve(image)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(bytes)
  })
}

export async function readForm14WithSource(bytes: ArrayBuffer, path: string) {
  const startedAt = performance.now()
  if (bytes.byteLength === 0 || bytes.byteLength > 10_485_760) throw new ApiError(400, 'Ukuran scan tidak valid')
  const original = Buffer.from(bytes)
  const image = path.endsWith('.pdf') ? await renderPdf(original) : verifyImage(original, path)
  const extraction = await readForm14Ocr(image)
  console.info('Form 14 OCR timing', { total_seconds: Math.round((performance.now() - startedAt) / 100) / 10 })
  return { extraction, modelVersion: 'tesseract:eng' }
}

export async function readForm14(bytes: ArrayBuffer, path: string) {
  return (await readForm14WithSource(bytes, path)).extraction
}
