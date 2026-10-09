-- Run after 002_review_checks.sql. Existing submitted versions remain unchanged.
begin;

create table if not exists public.form14_scans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  submission_key text not null,
  revision_request_id uuid references public.form14_requests(id),
  request_id uuid references public.form14_requests(id),
  version_id uuid references public.form14_versions(id),
  form_path text not null,
  doctor_path text,
  status text not null default 'uploaded' check (status in ('uploaded','processing','needs_reupload','ai_failed','ready','submitted')),
  extraction jsonb,
  validated_lines jsonb,
  statement_date date,
  issues jsonb not null default '[]'::jsonb,
  model_version text,
  rule_version text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, submission_key),
  check (status <> 'ready' or (jsonb_typeof(validated_lines) = 'array' and statement_date is not null and extraction is not null))
);
create index if not exists form14_scans_request_idx on public.form14_scans(request_id);

create table if not exists public.form14_scan_events (
  id bigint generated always as identity primary key,
  scan_id uuid not null references public.form14_scans(id),
  actor text not null,
  action text not null,
  reason text,
  model_version text,
  rule_version text,
  created_at timestamptz not null default now()
);

alter table public.form14_scans enable row level security;
alter table public.form14_scan_events enable row level security;
drop policy if exists scan_read on public.form14_scans;
create policy scan_read on public.form14_scans for select to authenticated
  using (student_id = (select auth.uid()) or (request_id is not null and public.is_officer_for(student_id)));
drop policy if exists scan_event_read on public.form14_scan_events;
create policy scan_event_read on public.form14_scan_events for select to authenticated
  using (exists (select 1 from public.form14_scans s where s.id = scan_id and
    (s.student_id = (select auth.uid()) or (s.request_id is not null and public.is_officer_for(s.student_id)))));
grant select on public.form14_scans, public.form14_scan_events to authenticated;

create or replace function public.form14_scan_start(p_key text, p_request uuid, p_form_path text, p_doctor_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); s public.form14_scans%rowtype; r public.form14_requests%rowtype;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.profiles where id=actor and role='student') then raise exception 'STUDENT_REQUIRED'; end if;
  if length(trim(coalesce(p_key,''))) < 8 or
     p_form_path !~ ('^' || actor::text || '/signed_form/[a-zA-Z0-9_-]+[.](pdf|png|jpg)$') or
     (p_doctor_path is not null and p_doctor_path !~ ('^' || actor::text || '/doctor_letter/[a-zA-Z0-9_-]+[.](pdf|png|jpg)$')) then
    raise exception 'INVALID_FORM';
  end if;
  select * into s from public.form14_scans where student_id=actor and submission_key=p_key;
  if found then
    if s.form_path <> p_form_path or s.doctor_path is distinct from p_doctor_path or
       s.revision_request_id is distinct from p_request then raise exception 'INVALID_FORM'; end if;
    return jsonb_build_object('scan_id',s.id,'status',s.status,'request_id',s.request_id,'version_id',s.version_id);
  end if;
  if p_request is not null then
    select * into r from public.form14_requests where id=p_request;
    if not found or r.student_id <> actor or r.status <> 'needs_fix' or exists (
      select 1 from public.form14_lines where version_id=r.current_version_id and state in ('submitted','approved_pending','conflict')
    ) then raise exception 'REVISION_NOT_ALLOWED'; end if;
  elsif exists (
    select 1 from public.form14_requests where student_id=actor and submission_key=p_key
  ) then raise exception 'ALREADY_CLAIMED'; end if;
  if not exists (select 1 from storage.objects where bucket_id='form14-private' and name=p_form_path) then
    raise exception 'FORM_UPLOAD_MISSING'; end if;
  if p_doctor_path is not null and not exists (
    select 1 from storage.objects where bucket_id='form14-private' and name=p_doctor_path
  ) then raise exception 'DOCTOR_UPLOAD_MISSING'; end if;
  insert into public.form14_scans(student_id,submission_key,revision_request_id,form_path,doctor_path)
    values(actor,p_key,p_request,p_form_path,p_doctor_path) returning * into s;
  insert into public.form14_scan_events(scan_id,actor,action,rule_version)
    values(s.id,actor::text,'uploaded','scan-v1');
  return jsonb_build_object('scan_id',s.id,'status',s.status,'request_id',null);
end $$;

create or replace function public.form14_scan_submit(p_scan uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); s public.form14_scans%rowtype; saved jsonb; submitted jsonb;
begin
  select * into s from public.form14_scans where id=p_scan for update;
  if not found or actor is null or s.student_id <> actor then raise exception 'REQUEST_DENIED'; end if;
  if s.status='submitted' then
    return jsonb_build_object('scan_id',s.id,'request_id',s.request_id,'version_id',s.version_id,'status','submitted');
  end if;
  if s.status <> 'ready' or s.extraction is null or s.statement_date is null or
     jsonb_typeof(s.validated_lines) <> 'array' or jsonb_array_length(s.validated_lines) not between 1 and 5 or
     s.issues <> '[]'::jsonb then raise exception 'SCAN_NOT_READY'; end if;
  saved := public.form14_save(s.submission_key,s.revision_request_id,s.statement_date,s.form_path,s.validated_lines);
  submitted := public.form14_submit((saved->>'request_id')::uuid);
  update public.form14_scans set status='submitted',request_id=(saved->>'request_id')::uuid,
    version_id=(saved->>'version_id')::uuid,updated_at=now() where id=s.id;
  insert into public.form14_scan_events(scan_id,actor,action,model_version,rule_version)
    values(s.id,actor::text,'submitted',s.model_version,s.rule_version);
  return jsonb_build_object('scan_id',s.id,'request_id',saved->>'request_id',
    'version_id',saved->>'version_id','status',submitted->>'status');
end $$;

-- Directly supplying typed fields or submitting an unexamined draft is disabled.
revoke execute on function public.form14_save(text,uuid,date,text,jsonb), public.form14_submit(uuid) from public, anon, authenticated;
revoke all on function public.form14_scan_start(text,uuid,text,text), public.form14_scan_submit(uuid) from public, anon;
grant execute on function public.form14_scan_start(text,uuid,text,text), public.form14_scan_submit(uuid) to authenticated;
commit;
