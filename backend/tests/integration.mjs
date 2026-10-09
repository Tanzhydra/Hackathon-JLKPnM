// Disposable Supabase project only. This fixture exercises database authorization and review;
// it injects synthetic extraction after scan_start and does not claim OCR accuracy.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const apiUrl = process.env.FORM14_TEST_API_URL ?? 'http://localhost:3000'
if (process.env.FORM14_TEST_CONFIRM_DEMO !== '1' || !url || !key || !secret)
  throw new Error('Set FORM14_TEST_CONFIRM_DEMO=1 and demo Supabase URL, publishable key, secret key')
const admin = createClient(url, secret, { auth: { persistSession: false } })
const anon = createClient(url, key, { auth: { persistSession: false } })
const users = [], studentIds = [], paths = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9WAAAAABJRU5ErkJggg==', 'base64')
const day = '2026-10-09'
const checked = ({ data, error }) => { if (error) throw error; return data }

async function user(role, program, profile = {}) {
  const email = `scan-${randomUUID()}@example.invalid`, password = `Demo-${randomUUID()}!`
  const created = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }))
  users.push(created.user.id)
  if (role === 'student') studentIds.push(created.user.id)
  checked(await admin.from('profiles').insert({ id: created.user.id, role, full_name: `Demo ${role}`,
    nrp: role === 'student' ? '123456' : null, class_name: role === 'student' ? 'Kelas Demo' : null,
    program_code: program, ...profile }))
  const session = checked(await anon.auth.signInWithPassword({ email, password }))
  return { id: created.user.id, token: session.session.access_token,
    db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } } }) }
}

async function api(path, token, body) {
  const response = await fetch(new URL(path, apiUrl), { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, value: response.headers.get('content-type')?.includes('application/json')
    ? await response.json() : await response.arrayBuffer() }
}

async function upload(actor, purpose, bytes = png, mime = 'image/png') {
  const ticket = await api('/api/uploads/ticket', actor.token, { purpose, mime_type: mime })
  assert.equal(ticket.status, 201, JSON.stringify(ticket.value))
  checked(await actor.db.storage.from('form14-private').uploadToSignedUrl(ticket.value.path, ticket.value.token, bytes, { contentType: mime }))
  paths.push(ticket.value.path)
  return ticket.value.path
}

async function cleanup() {
  if (studentIds.length) {
    const requests = checked(await admin.from('form14_requests').select('id').in('student_id', studentIds))
    const ids = requests.map(r => r.id)
    const scans = checked(await admin.from('form14_scans').select('id').in('student_id', studentIds)).map(s => s.id)
    if (scans.length) await admin.from('form14_scan_events').delete().in('scan_id', scans)
    await admin.from('form14_scans').delete().in('student_id', studentIds)
    if (ids.length) {
      const versions = checked(await admin.from('form14_versions').select('id').in('request_id', ids)).map(v => v.id)
      await admin.from('form14_audit').delete().in('request_id', ids)
      await admin.from('form14_claims').delete().in('request_id', ids)
      if (versions.length) await admin.from('form14_lines').delete().in('version_id', versions)
      await admin.from('form14_requests').update({ current_version_id: null }).in('id', ids)
      if (versions.length) await admin.from('form14_versions').delete().in('id', versions)
      await admin.from('form14_requests').delete().in('id', ids)
    }
    await admin.from('attendance').delete().in('student_id', studentIds)
  }
  if (paths.length) await admin.storage.from('form14-private').remove(paths)
  if (users.length) await admin.from('profiles').delete().in('id', users)
  for (const id of users) await admin.auth.admin.deleteUser(id)
}

try {
  const student = await user('student', 'PENS-A')
  const other = await user('student', 'PENS-B')
  const officer = await user('officer', 'PENS-A')
  const outsider = await user('officer', 'PENS-B')
  assert.equal((await api('/api/bootstrap', null)).status, 401)
  const attendance = checked(await admin.from('attendance').insert({ student_id: student.id,
    class_date: day, course_name: 'Matematika', week_no: 2, status: 'A' }).select('id').single())
  const formPath = await upload(student, 'signed_form')
  if (process.env.FORM14_TEST_OLLAMA === '1') {
    const dummy = await readFile(new URL('./fixtures/dummy data 1.jpg', import.meta.url))
    const dummyPath = await upload(student, 'signed_form', dummy, 'image/jpeg')
    const checkedScan = await api('/api/scans', student.token, {
      submission_key: `scan-${randomUUID()}`, form_path: dummyPath,
    })
    assert.equal(checkedScan.status, 422, JSON.stringify(checkedScan.value))
    assert.ok(checkedScan.value.issues.some(issue => issue.includes('tanda tangan dosen')))
    assert.ok(checkedScan.value.issues.some(issue => issue.includes('surat dokter')))
    assert.equal((await api('/api/bootstrap', officer.token)).value.requests.length, 0)
  }
  if (process.env.FORM14_TEST_OLLAMA_VALID === '1') {
    const signedStudent = await user('student', 'TEKNOLOGI REKAYASA MULTIMEDIA', {
      full_name: 'Dimas Wahyu Pratama', nrp: '5323600012', class_name: 'TRM A',
    })
    const signedOfficer = await user('officer', 'TEKNOLOGI REKAYASA MULTIMEDIA')
    const signedAttendance = checked(await admin.from('attendance').insert({ student_id: signedStudent.id,
      class_date: '2026-10-07', course_name: 'Pemrograman Web', week_no: 4, status: 'A' }).select('id').single())
    const signedImage = await readFile(new URL('./fixtures/dummy data 2.jpg', import.meta.url))
    const signedPath = await upload(signedStudent, 'signed_form', signedImage, 'image/jpeg')
    const signedScan = await api('/api/scans', signedStudent.token, {
      submission_key: `scan-${randomUUID()}`, form_path: signedPath,
    })
    assert.equal(signedScan.status, 201, JSON.stringify(signedScan.value))
    assert.equal(signedScan.value.status, 'submitted')
    const signedDetail = await api(`/api/form14/${signedScan.value.request_id}`, signedOfficer.token)
    assert.equal(signedDetail.status, 200, JSON.stringify(signedDetail.value))
    assert.equal(signedDetail.value.versions[0].lines.length, 1)
    const signedLine = signedDetail.value.versions[0].lines[0]
    assert.equal(signedLine.reason, 'forgot_ethol')
    const signedApproval = { decision: 'approve', reason: 'Bukti sintetis diperiksa',
      student_signature_checked: true, lecturer_signature_checked: true }
    assert.equal((await api(`/api/form14/lines/${signedLine.id}/decision`, signedOfficer.token, signedApproval)).status, 200)
    assert.equal((await api(`/api/form14/lines/${signedLine.id}/apply`, signedOfficer.token, {})).value.state, 'applied')
    assert.equal(checked(await admin.from('attendance').select('status').eq('id', signedAttendance.id).single()).status, 'H')
    assert.equal((await api(`/api/form14/${signedScan.value.request_id}/result`, signedStudent.token)).status, 200)
  }
  const submissionKey = `scan-${randomUUID()}`
  const start = checked(await student.db.rpc('form14_scan_start', { p_key: submissionKey, p_request: null,
    p_form_path: formPath, p_doctor_path: null }))
  assert.equal(start.status, 'uploaded')
  assert.equal((await api('/api/bootstrap', officer.token)).value.requests.length, 0)
  assert.equal((await api(`/api/scans/${start.scan_id}`, other.token)).status, 404)
  assert.equal((await api(`/api/files?path=${encodeURIComponent(formPath)}`, outsider.token)).status, 403)
  assert.equal((await api('/api/form14', student.token, { submission_key: submissionKey })).status, 410)
  const direct = await student.db.rpc('form14_save', { p_key: submissionKey, p_request: null,
    p_statement_date: day, p_form_path: formPath, p_lines: [] })
  assert.ok(direct.error, 'typed save RPC must be denied')
  const lines = [{ attendance_id: attendance.id, class_date: day, course_name: 'Matematika', week_no: 2,
    lecturer_name: 'Dosen Demo', reason: 'forgot_ethol', doctor_path: null, permission_kind: null }]
  checked(await admin.from('form14_scans').update({ status: 'ready', statement_date: day,
    extraction: { fixture: true }, validated_lines: lines, issues: [], model_version: 'fixture', rule_version: 'scan-v1' })
    .eq('id', start.scan_id))
  const submitted = checked(await student.db.rpc('form14_scan_submit', { p_scan: start.scan_id }))
  assert.equal(submitted.status, 'submitted')
  assert.equal(checked(await student.db.rpc('form14_scan_submit', { p_scan: start.scan_id })).request_id, submitted.request_id)
  assert.equal((await api(`/api/form14/${submitted.request_id}`, other.token)).status, 404)
  const detail = await api(`/api/form14/${submitted.request_id}`, officer.token)
  assert.equal(detail.status, 200, JSON.stringify(detail.value))
  assert.equal(detail.value.scans[0].id, start.scan_id)
  const lineId = detail.value.versions[0].lines[0].id
  const approval = { decision: 'approve', reason: 'Bukti diperiksa', student_signature_checked: true,
    lecturer_signature_checked: true }
  assert.equal((await api(`/api/form14/lines/${lineId}/decision`, outsider.token, approval)).status, 403)
  assert.equal((await api(`/api/form14/lines/${lineId}/decision`, officer.token, approval)).status, 200)
  assert.equal((await api(`/api/form14/lines/${lineId}/apply`, officer.token, {})).value.state, 'applied')
  assert.equal((await api(`/api/form14/lines/${lineId}/apply`, officer.token, {})).value.state, 'applied')
  assert.equal(checked(await admin.from('attendance').select('status').eq('id', attendance.id).single()).status, 'H')
  const pdf = await api(`/api/form14/${submitted.request_id}/result`, student.token)
  assert.equal(pdf.status, 200)
  assert.equal(Buffer.from(pdf.value).subarray(0, 4).toString(), '%PDF')
  console.log('Integration flow passed: scan gate, RLS, idempotency, BAAK review, atomic apply, PDF')
} finally { await cleanup() }
