import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { checkExtraction, classifyReason, extractionSchema, normalizeScanDate } from '../lib/scan.ts'
import { formRowHasInk, lecturerCellHasInk, renderPdf } from '../lib/vision.ts'

const field = (text, confidence = 0.95) => ({ text, confidence, location: 'tabel' })
const mark = (present = true) => ({ present, confidence: 0.95, location: 'kotak tanda tangan' })
const profile = { full_name: 'Demo Mahasiswa', nrp: '123456', class_name: 'Kelas Demo', program_code: 'PENS-A' }
const attendance = [{ id: 'a', class_date: '2026-10-09', course_name: 'Matematika', week_no: 2, status: 'A' }]
const scan = {
  name: field(profile.full_name), nrp: field(profile.nrp), class_name: field(profile.class_name),
  program: field(profile.program_code), statement_date: field('2026-10-09'), student_signature: mark(),
  lines: [{ class_date: field('2026-10-09'), course_name: field('Matematika'), week_no: field('2'),
    lecturer_name: field('Dosen Demo'), lecturer_signature: mark(), reason: field('lupa absen eThol') }],
}

test('scan complete maps the unique A row without typed attendance id', () => {
  const checked = checkExtraction(scan, profile, attendance, null)
  assert.deepEqual(checked.issues, [])
  assert.equal(checked.lines[0].attendance_id, 'a')
  assert.equal(checked.lines[0].reason, 'forgot_ethol')
})

test('Indonesian dates in a scan become valid calendar dates', () => {
  assert.equal(normalizeScanDate('9 Oktober 2026'), '2026-10-09')
  assert.equal(normalizeScanDate('7 Oktober 2026'), '2026-10-07')
  assert.equal(normalizeScanDate('31 Februari 2026'), '31 Februari 2026')
})

test('uncertain fields, missing signatures, non-A and ambiguous rows stop submission', () => {
  const uncertain = structuredClone(scan)
  uncertain.lines[0].lecturer_name.confidence = 0.5
  uncertain.lines[0].lecturer_signature.present = false
  assert.ok(checkExtraction(uncertain, profile, attendance, null).issues.length >= 2)
  assert.ok(checkExtraction(scan, profile, [{ ...attendance[0], status: 'H' }], null).issues.length)
  assert.ok(checkExtraction(scan, profile, [...attendance, { ...attendance[0], id: 'b' }], null).issues.length)
})

test('sick requires uploaded doctor letter and permission needs specific kind', () => {
  const sick = structuredClone(scan)
  sick.lines[0].reason.text = 'sakit'
  assert.ok(checkExtraction(sick, profile, attendance, null).issues.includes('Baris 1: surat dokter belum diunggah'))
  assert.deepEqual(checkExtraction(sick, profile, attendance, 'student/doctor_letter/file.pdf').issues, [])
  assert.equal(classifyReason('izin'), null)
  assert.equal(classifyReason('izin keperluan'), null)
  assert.deepEqual(classifyReason('izin lomba'), { reason: 'permission', permission_kind: 'lomba' })
})

test('duplicate line and mismatched NRP are rejected', () => {
  const duplicate = structuredClone(scan)
  duplicate.nrp.text = '654321'
  duplicate.lines.push(structuredClone(duplicate.lines[0]))
  const issues = checkExtraction(duplicate, profile, attendance, null).issues
  assert.ok(issues.includes('NRP tidak sesuai akun'))
  assert.ok(issues.includes('Baris 2: catatan A dipakai dua kali'))
})

test('Form 14 extraction accepts one to five rows and rejects a sixth', () => {
  assert.equal(extractionSchema.safeParse(scan).success, true)
  assert.equal(extractionSchema.safeParse({ ...scan, lines: Array(5).fill(scan.lines[0]) }).success, true)
  assert.equal(extractionSchema.safeParse({ ...scan, lines: Array(6).fill(scan.lines[0]) }).success, false)
})

test('three reasons in one scan map to H, S, I only with complete evidence', () => {
  const mixed = structuredClone(scan)
  const physics = { ...attendance[0], id: 'b', course_name: 'Fisika' }
  const language = { ...attendance[0], id: 'c', course_name: 'Bahasa' }
  const sick = structuredClone(mixed.lines[0])
  sick.course_name.text = 'Fisika'
  sick.reason.text = 'sakit'
  const permission = structuredClone(mixed.lines[0])
  permission.course_name.text = 'Bahasa'
  permission.reason.text = 'izin lomba kampus'
  mixed.lines.push(sick, permission)
  const checked = checkExtraction(mixed, profile, [attendance[0], physics, language], 'student/doctor_letter/file.pdf')
  assert.deepEqual(checked.issues, [])
  assert.deepEqual(checked.lines.map(row => row.reason), ['forgot_ethol', 'sick', 'permission'])
  assert.equal(checked.lines[2].permission_kind, 'lomba kampus')
})

test('dummy-style incomplete lecturer and missing doctor evidence stay before BAAK', () => {
  const incomplete = structuredClone(scan)
  incomplete.lines[0].lecturer_name.text = ''
  incomplete.lines[0].reason.text = 'sakit'
  const issues = checkExtraction(incomplete, profile, attendance, null).issues
  assert.ok(issues.some(issue => issue.includes('lecturer_name')))
  assert.ok(issues.some(issue => issue.includes('surat dokter')))
})

test('both supplied dummy scans have an empty lecturer cell even if the model claims otherwise', async () => {
  for (const name of ['dummy data.jpg', 'dummy data 1.jpg']) {
    const original = await readFile(new URL(`./fixtures/${name}`, import.meta.url))
    assert.equal(await lecturerCellHasInk(original, 0), false)
    assert.equal(await formRowHasInk(original, 0), true)
    for (let row = 1; row < 5; row++) assert.equal(await formRowHasInk(original, row), false)
  }
})

test('new synthetic scan has visible lecturer marks in its first row', async () => {
  const image = await readFile(new URL('./fixtures/dummy data 2.jpg', import.meta.url))
  assert.equal(await lecturerCellHasInk(image, 0), true)
  assert.equal(await formRowHasInk(image, 0), true)
  for (let row = 1; row < 5; row++) assert.equal(await formRowHasInk(image, row), false)
})

test('the supplied one-page Form 14 PDF renders to a PNG for OCR', async () => {
  const pdf = await readFile(new URL('./fixtures/Surat-Pernyataan-PENS-ATTENDANCE.pdf', import.meta.url))
  const image = await renderPdf(pdf)
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
})
