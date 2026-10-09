// Operator-only: node --experimental-transform-types --env-file=.env.local scripts/ingest-knowledge.mjs approved-document.json
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
import { ingestDocument, prepareKnowledgeRows, validateApprovedDocument } from '../lib/rag.ts'

const file = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
if (!file || file.startsWith('--')) {
  throw new Error('Berikan path JSON dokumen resmi yang telah disetujui BAAK')
}

const document = JSON.parse(await readFile(file, 'utf8'))
const count = validateApprovedDocument(document)
if (dryRun) {
  console.log(JSON.stringify({ document_key: document.document_key, version_no: document.version_no, chunks: count, dry_run: true }))
} else {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  let written
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    written = await ingestDocument(db, document)
  } else if (url && process.env.DATABASE_URL) {
    // Operator database credentials allow an atomic ingest when no service-role key is present.
    const projectRef = new URL(url).hostname.split('.')[0]
    const databaseUrl = new URL(process.env.DATABASE_URL)
    if (!databaseUrl.hostname.includes(projectRef) && !databaseUrl.username.includes(projectRef)) {
      throw new Error('DATABASE_URL tidak mengarah ke proyek Supabase yang sama')
    }
    const requireDatabase = createRequire(new URL('../../database/package.json', import.meta.url))
    const { Client } = requireDatabase('pg')
    const db = new Client({ connectionString: process.env.DATABASE_URL })
    await db.connect()
    try {
      await db.query('begin')
      const rows = prepareKnowledgeRows(document)
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index]
        await db.query(`insert into public.knowledge_documents
          (document_key,version_no,title,source_url,approved_by,effective_at,expires_at,active,chunk_index,content)
          values ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)
          on conflict (document_key,version_no,chunk_index) do update set
            title=excluded.title,source_url=excluded.source_url,approved_by=excluded.approved_by,
            effective_at=excluded.effective_at,expires_at=excluded.expires_at,active=true,content=excluded.content`,
          [row.document_key, row.version_no, row.title, row.source_url,
            row.approved_by, row.effective_at, row.expires_at, row.chunk_index, row.content])
      }
      await db.query('delete from public.knowledge_documents where document_key=$1 and version_no=$2 and chunk_index >= $3',
        [document.document_key, document.version_no, rows.length])
      await db.query('update public.knowledge_documents set active=false where document_key=$1 and version_no < $2',
        [document.document_key, document.version_no])
      await db.query('commit')
      written = rows.length
    } catch (error) {
      await db.query('rollback')
      throw error
    } finally {
      await db.end()
    }
  } else {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY atau DATABASE_URL diperlukan untuk ingest')
  }
  console.log(JSON.stringify({ document_key: document.document_key, version_no: document.version_no, chunks: written, status: 'ingested' }))
}
