import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
if (process.env.FORM14_TEST_CONFIRM_DEMO !== '1' || !url || !key) {
  throw new Error('Set FORM14_TEST_CONFIRM_DEMO=1 and a Supabase secret key for the demo project')
}
const db = createClient(url, key, { auth: { persistSession: false } })
function checked({ data, error }) {
  if (error) throw error
  return data
}

const profiles = checked(await db.from('profiles').select('id,role,full_name,program_code'))
const students = profiles.filter(profile => profile.role === 'student' && /demo/i.test(profile.full_name))
if (students.length !== 1 || !profiles.some(profile => profile.role === 'officer' && profile.program_code === students[0].program_code)) {
  throw new Error('Proyek harus memiliki tepat satu mahasiswa Demo dan petugas pada program yang sama')
}
const studentId = students[0].id
const existing = checked(await db.from('attendance').select('class_date,course_name').eq('student_id', studentId))
const wanted = [
  { class_date: '2026-10-07', course_name: 'Fisika Demo' },
  { class_date: '2026-10-08', course_name: 'Bahasa Demo' },
]
const missing = wanted.filter(item => !existing.some(row => row.class_date === item.class_date && row.course_name === item.course_name))
if (missing.length) checked(await db.from('attendance').insert(missing.map(item => ({ ...item, student_id: studentId, week_no: 5, status: 'A' }))))
console.log(JSON.stringify({ added_attendance: missing.length, existing_attendance: existing.length }))
