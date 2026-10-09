import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

const connectionString = process.env.DATABASE_URL
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!connectionString || !projectUrl) throw new Error('DATABASE_URL dan NEXT_PUBLIC_SUPABASE_URL diperlukan')
const projectRef = new URL(projectUrl).hostname.split('.')[0]
const databaseUrl = new URL(connectionString)
if (!databaseUrl.hostname.includes(projectRef) && !databaseUrl.username.includes(projectRef))
  throw new Error('DATABASE_URL tidak tampak mengarah ke proyek yang sama dengan .env.local')
const client = new Client({ connectionString })
try {
  await client.connect()
  const sql = await readFile(new URL('./003_scan_flow.sql', import.meta.url), 'utf8')
  await client.query(sql)
  const { rows } = await client.query("select to_regclass('public.form14_scans') as scans, to_regclass('public.form14_scan_events') as events")
  if (!rows[0].scans || !rows[0].events) throw new Error('Tabel scan belum tersedia')
  console.log(JSON.stringify({ migrated: true, scans: rows[0].scans, events: rows[0].events }))
} finally { await client.end() }
