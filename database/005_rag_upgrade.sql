-- Apply only if the earlier vector-based 004_rag_knowledge.sql was already run.
-- Existing unapproved rows remain inactive and cannot be served to users.
begin;

alter table public.knowledge_documents
  add column if not exists document_key text,
  add column if not exists version_no integer,
  add column if not exists source_url text,
  add column if not exists approved_by text,
  add column if not exists effective_at date,
  add column if not exists expires_at date,
  add column if not exists active boolean not null default false,
  add column if not exists search_vector tsvector generated always as (to_tsvector('indonesian', content)) stored;

create unique index if not exists knowledge_documents_version_chunk_idx
  on public.knowledge_documents(document_key, version_no, chunk_index);
create index if not exists knowledge_documents_search_idx
  on public.knowledge_documents using gin(search_vector);

alter table public.knowledge_documents add constraint knowledge_active_metadata
  check (not active or (document_key is not null and version_no > 0 and source_url ~* '^https?://'
    and approved_by is not null and effective_at is not null
    and (expires_at is null or expires_at >= effective_at)));

drop policy if exists knowledge_read on public.knowledge_documents;
drop policy if exists knowledge_read_active on public.knowledge_documents;
create policy knowledge_read_active on public.knowledge_documents for select to authenticated
  using (active and effective_at <= current_date and (expires_at is null or expires_at >= current_date));

create or replace function public.search_knowledge(p_question text, p_limit integer default 3)
returns table (id uuid, title text, source_url text, version_no integer, chunk_index integer, content text, score real)
language sql stable security invoker set search_path = '' as $$
  with query as (select websearch_to_tsquery('indonesian', left(p_question, 1000)) as q)
  select k.id, k.title, k.source_url, k.version_no, k.chunk_index, k.content,
    ts_rank_cd(k.search_vector, query.q)::real as score
  from public.knowledge_documents k cross join query
  where k.active and k.effective_at <= current_date
    and (k.expires_at is null or k.expires_at >= current_date)
    and k.search_vector @@ query.q
    and not exists (
      select 1 from public.knowledge_documents newer
      where newer.document_key = k.document_key and newer.version_no > k.version_no
        and newer.active and newer.effective_at <= current_date
        and (newer.expires_at is null or newer.expires_at >= current_date)
    )
  order by score desc, k.document_key, k.chunk_index
  limit least(greatest(p_limit, 1), 5);
$$;
grant execute on function public.search_knowledge(text, integer) to authenticated;

commit;
