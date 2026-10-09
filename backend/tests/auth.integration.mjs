// Run only against a disposable Supabase project: this creates and deletes an Auth user.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const apiUrl = process.env.FORM14_TEST_API_URL ?? 'http://localhost:3000'
if (process.env.FORM14_TEST_CONFIRM_DEMO !== '1' || !url || !publishableKey || !secretKey) {
  throw new Error('Set FORM14_TEST_CONFIRM_DEMO=1 and disposable Supabase credentials')
}

const browser = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
const checked = ({ data, error }) => { if (error) throw error; return data }
const profile = { full_name: 'Mahasiswa Uji Login', nrp: 'TEST123', class_name: 'Kelas Uji', program_code: 'PENS-TEST' }
const email = `form14-auth-${randomUUID()}@example.invalid`
const password = `Demo-${randomUUID()}!`
let userId

async function api(path, token, body) {
  const response = await fetch(new URL(path, apiUrl), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, value: await response.json() }
}

try {
  const signup = checked(await browser.auth.signUp({ email, password, options: { data: profile } }))
  assert.ok(signup.user?.id, 'Pendaftaran harus membuat pengguna')
  userId = signup.user.id
  if (!signup.session) checked(await admin.auth.admin.updateUserById(userId, { email_confirm: true }))

  const login = checked(await browser.auth.signInWithPassword({ email, password }))
  assert.equal(login.user?.id, userId)
  assert.ok(login.session?.access_token, 'Login harus menghasilkan token sesi')
  const token = login.session.access_token

  assert.equal((await api('/api/bootstrap', token)).status, 404, 'Profil belum dibuat')
  const created = await api('/api/profile', token, profile)
  assert.equal(created.status, 201, JSON.stringify(created.value))
  const bootstrap = await api('/api/bootstrap', token)
  assert.equal(bootstrap.status, 200, JSON.stringify(bootstrap.value))
  assert.equal(bootstrap.value.profile.role, 'student')
  assert.equal(bootstrap.value.profile.nrp, profile.nrp)
  console.log('Register, login, pembuatan profil, dan pemuatan sesi berhasil')
} finally {
  if (userId) {
    checked(await admin.auth.admin.deleteUser(userId))
  }
}
