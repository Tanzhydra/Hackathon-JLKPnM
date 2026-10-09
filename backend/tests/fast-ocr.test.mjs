import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readForm14WithSource } from '../lib/vision.ts'
import { checkExtraction } from '../lib/scan.ts'

const program_code = 'TEKNOLOGI REKAYASA MULTIMEDIA'

test('matching signed Form 14 uses local OCR and preserves the extracted fields', async () => {
  const bytes = await readFile(new URL('./fixtures/dummy data 2.jpg', import.meta.url))
  const profile = { full_name: 'Dimas Wahyu Pratama', nrp: '5323600012', class_name: 'TRM A', program_code }
  const attendance = [{ id: 'attendance-a', class_date: '2026-10-07', course_name: 'Pemrograman Web', week_no: 4, status: 'A' }]
  const result = await readForm14WithSource(Uint8Array.from(bytes).buffer, 'form.jpg')
  assert.equal(result.modelVersion, 'tesseract:eng')
  assert.equal(result.extraction.name.text, profile.full_name)
  assert.equal(result.extraction.nrp.text, profile.nrp)
  assert.equal(result.extraction.class_name.text, profile.class_name)
  assert.equal(result.extraction.lines[0].course_name.text, attendance[0].course_name)
  assert.equal(result.extraction.lines[0].lecturer_signature.present, true)
  assert.deepEqual(checkExtraction(result.extraction, profile, attendance, null).issues, [])
})

test('an incomplete Form 14 returns OCR fields and validation issues without invoking AI', async () => {
  const bytes = await readFile(new URL('./fixtures/dummy data 1.jpg', import.meta.url))
  const profile = { full_name: 'Andika Putra Pratama', nrp: '5323600012', class_name: 'TRM A', program_code }
  const attendance = [{ id: 'attendance-a', class_date: '2026-10-05', course_name: 'Desain Grafis', week_no: 4, status: 'A' }]
  const result = await readForm14WithSource(Uint8Array.from(bytes).buffer, 'form.jpg')
  assert.equal(result.modelVersion, 'tesseract:eng')
  assert.equal(result.extraction.lines[0].lecturer_signature.present, false)
  assert.ok(checkExtraction(result.extraction, profile, attendance, null).issues.length)
})
