-- Apply on a fresh database after 001_form14.sql. For a database that already
-- received the previous 004, apply 005_rag_upgrade.sql instead.
begin;

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  document_key text not null,
  version_no integer not null check (version_no > 0),
  title text not null,
  source_url text not null,
  approved_by text not null,
  effective_at date not null,
  expires_at date,
  active boolean not null default false,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  search_vector tsvector generated always as (to_tsvector('indonesian', content)) stored,
  created_at timestamptz not null default now(),
  unique (document_key, version_no, chunk_index),
  check (expires_at is null or expires_at >= effective_at),
  check (source_url ~* '^https?://')
);

create index knowledge_documents_search_idx on public.knowledge_documents using gin (search_vector);
create index knowledge_documents_active_idx on public.knowledge_documents (document_key, version_no desc) where active;

alter table public.knowledge_documents enable row level security;
create policy knowledge_read_active on public.knowledge_documents for select to authenticated
  using (active and effective_at <= current_date and (expires_at is null or expires_at >= current_date));

create function public.search_knowledge(p_question text, p_limit integer default 3)
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
