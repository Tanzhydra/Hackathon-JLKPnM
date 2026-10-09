import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { createRequire } from 'node:module'
import { ApiError } from './api.ts'
import { normalizeScanDate, type Extraction } from './scan.ts'

const require = createRequire(import.meta.url)
const english = require('@tesseract.js-data/eng') as { langPath: string; gzip: boolean }

type Region = [number, number, number, number]
type Read = { text: string; confidence: number }

function inkFraction(data: Buffer, width: number, height: number, [x1, y1, x2, y2]: Region) {
  let dark = 0
  let count = 0
  for (let y = Math.floor(height * y1); y < Math.floor(height * y2); y++)
    for (let x = Math.floor(width * x1); x < Math.floor(width * x2); x++) {
      if (data[y * width + x] < 100) dark++
      count++
    }
  return count ? dark / count : 0
}

function closeTo(a: string, b: string) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return [...a].filter((char, index) => char !== b[index]).length === 1
}

function field(read: Read, location: string, minimum: number) {
  return { text: read.text, confidence: read.confidence >= minimum ? 0.9 : read.confidence / 100, location }
}

const ocrDate = (text: string) => normalizeScanDate(text.replace(/^(\d{1,2})[.,]\s*/, '$1 '))

export async function readForm14Ocr(image: Buffer): Promise<Extraction> {
  let width: number | undefined
  let height: number | undefined
  try { ({ width, height } = await sharp(image).metadata()) }
  catch { throw new ApiError(400, 'Gambar scan tidak dapat diproses') }
  if (!width || !height || width < 1000 || height < 1200)
    throw new ApiError(422, 'Resolusi scan terlalu rendah; unggah gambar yang lebih jelas')
  const { data: pixels } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true })
  const rowHasInk = (index: number) => {
    const top = .456 + index * .051
    const bottom = .494 + index * .051
    return [[.11, .26], [.29, .49], [.52, .60], [.79, .95]].some(([left, right]) =>
      inkFraction(pixels, width, height, [left, top, right, bottom]) >= .002)
  }
  const rows = Array.from({ length: 5 }, (_, index) => index).filter(rowHasInk)
  if (!rows.length) throw new ApiError(422, 'Baris Form 14 tidak terbaca; unggah scan yang lebih jelas')

  let worker: Awaited<ReturnType<typeof createWorker>> | undefined
  try {
    worker = await createWorker('eng', 1, { langPath: english.langPath, gzip: english.gzip, cacheMethod: 'none' })
    const read = async ([x1, y1, x2, y2]: Region): Promise<Read> => {
      const left = Math.floor(width * x1)
      const top = Math.floor(height * y1)
      const crop = await sharp(image).extract({
        left, top, width: Math.floor(width * x2) - left, height: Math.floor(height * y2) - top,
      }).normalize().png().toBuffer()
      const { data } = await worker!.recognize(crop)
      return { text: data.text.replace(/\s+/g, ' ').trim(), confidence: data.confidence }
    }

    const name = await read([.27, .275, .94, .318])
    const header = await read([.29, .322, .68, .347])
    const className = await read([.50, .322, .68, .347])
    const footerNrp = await read([.55, .935, .87, .97])
    const program = await read([.27, .35, .95, .386])
    const statementDate = await read([.61, .80, .90, .84])
    const nrp = footerNrp.text.match(/\b\d{8,}\b/)?.[0] ?? ''
    const headerPart = header.text.split('/')[0]
    const headerDigits = headerPart.replace(/\D/g, '')
    const nrpMatches = !!nrp && header.text.includes('/') && closeTo(headerDigits, nrp) &&
      (headerDigits === nrp || /[^\d\s]/.test(headerPart))

    const extractedLines = []
    for (const index of rows) {
      const offset = index * .052
      const date = await read([.10, .443 + offset, .26, .498 + offset])
      const course = await read([.26, .443 + offset, .50, .498 + offset])
      const week = await read([.51, .443 + offset, .61, .498 + offset])
      const lecturer = await read([.63, .48 + offset, .78, .50 + offset])
      const reason = await read([.78, .443 + offset, .96, .498 + offset])
      const signed = inkFraction(pixels, width, height, [.64, .451 + offset, .77, .48 + offset]) >= .02
      extractedLines.push({
        class_date: field({ ...date, text: ocrDate(date.text) }, `baris ${index + 1} tanggal`, 65),
        course_name: field({ ...course, text: course.text.replace(/^[|]+\s*/, '') }, `baris ${index + 1} mata kuliah`, 65),
        week_no: field(week, `baris ${index + 1} minggu`, 60),
        lecturer_name: field({ ...lecturer, text: lecturer.text.replace(/[|]+\s*$/, '').trim() }, `baris ${index + 1} dosen`, 60),
        lecturer_signature: { present: signed, confidence: signed ? .9 : 0, location: `baris ${index + 1} tanda tangan dosen` },
        reason: field(reason, `baris ${index + 1} alasan`, 70),
      })
    }
    const studentSigned = inkFraction(pixels, width, height, [.62, .86, .82, .89]) >= .02
    const extraction: Extraction = {
      name: field(name, 'nama', 70),
      nrp: { text: nrp, confidence: nrpMatches && footerNrp.confidence >= 50 ? .9 : Math.min(footerNrp.confidence / 100, .5), location: 'NRP bawah' },
      class_name: field({ ...className, text: className.text.replace(/^[^\p{L}\d]+/u, '') }, 'kelas', 60),
      program: field(program, 'program studi', 60),
      statement_date: field({ ...statementDate, text: ocrDate(statementDate.text) }, 'tanggal pernyataan', 65),
      student_signature: { present: studentSigned, confidence: studentSigned ? .9 : 0, location: 'tanda tangan mahasiswa' },
      lines: extractedLines,
    }
    return extraction
  } catch (error) {
    if (error instanceof ApiError) throw error
    console.error('Form 14 OCR failed', error)
    throw new ApiError(502, 'Gagal membaca scan; coba unggah gambar yang lebih jelas')
  } finally {
    await worker?.terminate()
  }
}
