import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

const connectionString = process.env.DATABASE_URL
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!connectionString || !projectUrl) throw new Error('DATABASE_URL dan NEXT_PUBLIC_SUPABASE_URL diperlukan')
const projectRef = new URL(projectUrl).hostname.split('.')[0]
const databaseUrl = new URL(connectionString)
if (!databaseUrl.hostname.includes(projectRef) && !databaseUrl.username.includes(projectRef)) {
  throw new Error('DATABASE_URL tidak mengarah ke proyek Supabase yang sama')
}

const db = new Client({ connectionString })
try {
  await db.connect()
  const current = await db.query("select to_regclass('public.knowledge_documents') is not null as knowledge_exists, to_regprocedure('public.search_knowledge(text,integer)') is not null as search_exists")
  const { knowledge_exists, search_exists } = current.rows[0]
  if (search_exists) {
    console.log(JSON.stringify({ migrated: false, schema: 'current' }))
  } else {
    const file = knowledge_exists ? '005_rag_upgrade.sql' : '004_rag_knowledge.sql'
    const sql = await readFile(new URL(file, import.meta.url), 'utf8')
    await db.query(sql)
    const verified = await db.query("select to_regprocedure('public.search_knowledge(text,integer)') is not null as search_exists")
    if (!verified.rows[0].search_exists) throw new Error('Fungsi pencarian belum tersedia setelah migrasi')
    console.log(JSON.stringify({ migrated: true, file }))
  }
} finally {
  await db.end()
}
