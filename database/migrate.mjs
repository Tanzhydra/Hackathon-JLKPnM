import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

const connectionString = process.env.DATABASE_URL
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!connectionString || !projectUrl) throw new Error('DATABASE_URL dan NEXT_PUBLIC_SUPABASE_URL diperlukan')

const projectRef = new URL(projectUrl).hostname.split('.')[0]
const databaseUrl = new URL(connectionString)
if (!databaseUrl.hostname.includes(projectRef) && !databaseUrl.username.includes(projectRef)) {
  throw new Error('DATABASE_URL tidak tampak mengarah ke proyek yang sama dengan .env.local')
}

const client = new Client({ connectionString })
try {
  await client.connect()
  const before = await client.query(`
    select
      (select count(*)::int from public.profiles) as profiles,
      (select count(*)::int from public.attendance) as attendance,
      (select count(*)::int from public.form14_requests) as requests
  `)
  const sql = await readFile(new URL('./002_review_checks.sql', import.meta.url), 'utf8')
  await client.query(sql)
  const after = await client.query(`
    select count(*)::int as review_columns
    from information_schema.columns
    where table_schema = 'public' and table_name = 'form14_lines'
      and column_name in ('student_signature_checked','lecturer_signature_checked','doctor_letter_checked')
  `)
  if (after.rows[0].review_columns !== 3) throw new Error('Migrasi tidak menghasilkan tiga kolom pemeriksaan')
  console.log(JSON.stringify({ migrated: true, data_before: before.rows[0], review_columns: after.rows[0].review_columns }))
} finally {
  await client.end()
}
