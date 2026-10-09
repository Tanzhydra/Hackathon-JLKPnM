import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const studentEmail = process.env.FORM14_DEMO_STUDENT_EMAIL ?? `form14-student-${randomUUID()}@example.invalid`
const studentPassword = process.env.FORM14_DEMO_STUDENT_PASSWORD ?? `Demo-${randomUUID()}!`
const officerEmail = process.env.FORM14_DEMO_OFFICER_EMAIL ?? `form14-officer-${randomUUID()}@example.invalid`
const officerPassword = process.env.FORM14_DEMO_OFFICER_PASSWORD ?? `Demo-${randomUUID()}!`
if (process.env.FORM14_TEST_CONFIRM_DEMO !== '1' || !url || !key) {
  throw new Error('Set FORM14_TEST_CONFIRM_DEMO=1 and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)')
}
const credentialsFile = new URL('../.demo-accounts.local.json', import.meta.url)
try {
  await access(credentialsFile)
  throw new Error('Akun demo sudah pernah dibuat; periksa backend/.demo-accounts.local.json')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const db = createClient(url, key, { auth: { persistSession: false } })
function checked({ data, error }) {
  if (error) throw error
  return data
}

async function account(email, password, role) {
  const created = checked(await db.auth.admin.createUser({ email, password, email_confirm: true }))
  const id = created.user.id
  checked(await db.from('profiles').insert({
    id, role, full_name: role === 'student' ? 'Mahasiswa Demo' : 'Petugas Demo',
    nrp: role === 'student' ? 'DEMO001' : null,
    class_name: role === 'student' ? 'Kelas Demo' : null,
    program_code: 'DEMO-PENS',
  }))
  return id
}

const studentId = await account(studentEmail, studentPassword, 'student')
await account(officerEmail, officerPassword, 'officer')
checked(await db.from('attendance').insert([
  { student_id: studentId, class_date: '2026-10-06', course_name: 'Matematika Demo', week_no: 2, status: 'A' },
  { student_id: studentId, class_date: '2026-10-07', course_name: 'Fisika Demo', week_no: 2, status: 'A' },
  { student_id: studentId, class_date: '2026-10-08', course_name: 'Bahasa Demo', week_no: 2, status: 'A' },
]))
await writeFile(credentialsFile, JSON.stringify({
  student: { email: studentEmail, password: studentPassword },
  officer: { email: officerEmail, password: officerPassword },
}, null, 2), { flag: 'wx', mode: 0o600 })
console.log('Akun dan tiga catatan A demo berhasil dibuat. Kredensial tersimpan di backend/.demo-accounts.local.json (diabaikan Git).')
