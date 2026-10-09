-- Demo data only. Apply in a fresh Supabase project with Auth and Storage enabled.
create extension if not exists pgcrypto;

create type public.form14_reason as enum ('forgot_ethol', 'sick', 'permission');
create type public.form14_line_state as enum ('draft', 'submitted', 'needs_fix', 'rejected', 'approved_pending', 'applied', 'conflict');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'officer')),
  full_name text not null,
  nrp text,
  class_name text,
  program_code text not null,
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  class_date date not null,
  course_name text not null,
  week_no integer not null check (week_no between 1 and 30),
  status text not null default 'A' check (status in ('A','H','S','I')),
  updated_at timestamptz not null default now()
);

create table public.form14_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  submission_key text not null,
  current_version_id uuid,
  status text not null default 'draft' check (status in ('draft','submitted','needs_fix','rejected','approved_pending','complete','conflict')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, submission_key)
);

create table public.form14_versions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.form14_requests(id) on delete cascade,
  version_no integer not null,
  name_snapshot text not null,
  nrp_snapshot text not null,
  class_snapshot text not null,
  program_snapshot text not null,
  statement_date date not null,
  form_path text not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_id, version_no)
);
alter table public.form14_requests add constraint current_version_fk foreign key (current_version_id) references public.form14_versions(id);

create table public.form14_lines (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.form14_versions(id) on delete cascade,
  line_no integer not null check (line_no between 1 and 5),
  attendance_id uuid not null references public.attendance(id),
  class_date date not null,
  course_name text not null,
  week_no integer not null check (week_no between 1 and 30),
  lecturer_name text not null,
  reason public.form14_reason not null,
  permission_kind text,
  doctor_path text,
  target_status text generated always as (case reason when 'forgot_ethol' then 'H' when 'sick' then 'S' else 'I' end) stored,
  state public.form14_line_state not null default 'draft',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_reason text,
  student_signature_checked boolean not null default false,
  lecturer_signature_checked boolean not null default false,
  doctor_letter_checked boolean not null default false,
  applied_at timestamptz,
  unique (version_id, line_no),
  unique (version_id, attendance_id),
  check (reason <> 'permission' or length(trim(coalesce(permission_kind,''))) >= 3),
  check (reason <> 'sick' or nullif(doctor_path,'') is not null)
);

-- One active request can hold a given A record, including across forms and revisions.
create table public.form14_claims (
  attendance_id uuid primary key references public.attendance(id),
  request_id uuid not null references public.form14_requests(id),
  line_id uuid not null references public.form14_lines(id),
  created_at timestamptz not null default now()
);

create table public.form14_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.form14_requests(id),
  version_id uuid references public.form14_versions(id),
  line_id uuid references public.form14_lines(id),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (line_id, action)
);

create index on public.attendance(student_id, status);
create index on public.form14_requests(student_id, created_at desc);
create index on public.form14_versions(request_id, version_no desc);
create index on public.form14_lines(version_id, state);

create function public.is_officer_for(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles officer
    join public.profiles student on student.id = p_student
    where officer.id = (select auth.uid()) and officer.role = 'officer'
      and officer.program_code = student.program_code
  );
$$;

create function public.can_read_request(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.form14_requests r
    where r.id = p_request and (r.student_id = (select auth.uid()) or public.is_officer_for(r.student_id)));
$$;

alter table public.profiles enable row level security;
alter table public.attendance enable row level security;
alter table public.form14_requests enable row level security;
alter table public.form14_versions enable row level security;
alter table public.form14_lines enable row level security;
alter table public.form14_claims enable row level security;
alter table public.form14_audit enable row level security;

create policy profile_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_officer_for(id));
create policy attendance_read on public.attendance for select to authenticated
  using (student_id = (select auth.uid()) or public.is_officer_for(student_id));
create policy request_read on public.form14_requests for select to authenticated
  using (public.can_read_request(id));
create policy version_read on public.form14_versions for select to authenticated
  using (public.can_read_request(request_id));
create policy line_read on public.form14_lines for select to authenticated
  using (exists (select 1 from public.form14_versions v where v.id = version_id and public.can_read_request(v.request_id)));
create policy audit_read on public.form14_audit for select to authenticated
  using (public.can_read_request(request_id));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('form14-private','form14-private',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

create function public.can_read_form14_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select split_part(p_name,'/',1) = (select auth.uid())::text
    or exists (
      select 1 from public.form14_versions v
      join public.form14_requests r on r.id = v.request_id
      where public.is_officer_for(r.student_id)
        and (v.form_path = p_name or exists
          (select 1 from public.form14_lines l where l.version_id = v.id and l.doctor_path = p_name))
    );
$$;
create policy form14_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'form14-private' and split_part(name,'/',1) = (select auth.uid())::text);
create policy form14_read on storage.objects for select to authenticated
  using (bucket_id = 'form14-private' and public.can_read_form14_object(name));

create function public.form14_refresh_status(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select case
    when count(*) = 0 then 'draft'
    when bool_and(l.state = 'applied') then 'complete'
    when bool_or(l.state = 'conflict') then 'conflict'
    when bool_or(l.state = 'needs_fix') then 'needs_fix'
    when bool_or(l.state = 'draft') then 'draft'
    when bool_or(l.state = 'submitted') then 'submitted'
    when bool_or(l.state = 'approved_pending') then 'approved_pending'
    else 'rejected' end into s
  from (
    select distinct on (l.attendance_id) l.state
    from public.form14_lines l join public.form14_versions v on v.id=l.version_id
    where v.request_id=p_request order by l.attendance_id,v.version_no desc
  ) l;
  update public.form14_requests set status = s, updated_at = now() where id = p_request;
end $$;

-- Saves a new draft version. A submitted version is never changed or deleted.
create function public.form14_save(p_key text, p_request uuid, p_statement_date date, p_form_path text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); r public.form14_requests%rowtype; v uuid; prof public.profiles%rowtype;
  item jsonb; n int := 0; aid uuid; att public.attendance%rowtype; why public.form14_reason; prior uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into prof from public.profiles where id = actor and role = 'student';
  if not found then raise exception 'STUDENT_REQUIRED'; end if;
  if length(trim(coalesce(p_key,''))) < 8 or p_statement_date is null or
    p_form_path !~ ('^' || actor::text || '/signed_form/[a-zA-Z0-9_-]+[.](pdf|png|jpg)$') then raise exception 'INVALID_FORM'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 5 then raise exception 'LINE_COUNT'; end if;
  if p_request is null then
    insert into public.form14_requests(student_id,submission_key) values(actor,p_key)
      on conflict (student_id,submission_key) do update set updated_at = public.form14_requests.updated_at
      returning * into r;
  else
    select * into r from public.form14_requests where id = p_request for update;
    if not found or r.student_id <> actor or r.submission_key <> p_key then raise exception 'REQUEST_DENIED'; end if;
  end if;
  if p_request is null and r.current_version_id is not null then
    return jsonb_build_object('request_id',r.id,'version_id',r.current_version_id,
      'version_no',(select version_no from public.form14_versions where id=r.current_version_id),
      'status',r.status);
  end if;
  if r.current_version_id is not null and r.status not in ('draft','needs_fix') then
    raise exception 'REVISION_NOT_ALLOWED';
  end if;
  prior := r.current_version_id;
  if r.status = 'needs_fix' and exists (
    select 1 from public.form14_lines where version_id=prior and state in ('submitted','approved_pending','conflict')
  ) then raise exception 'REVISION_NOT_ALLOWED'; end if;
  insert into public.form14_versions(request_id,version_no,name_snapshot,nrp_snapshot,class_snapshot,program_snapshot,statement_date,form_path)
  values(r.id,coalesce((select max(version_no)+1 from public.form14_versions where request_id=r.id),1),prof.full_name,
    coalesce(prof.nrp,''),coalesce(prof.class_name,''),prof.program_code,p_statement_date,p_form_path) returning id into v;
  for item in select value from jsonb_array_elements(p_lines) loop
    n := n+1;
    begin aid := (item->>'attendance_id')::uuid; why := (item->>'reason')::public.form14_reason;
    exception when others then raise exception 'INVALID_LINE'; end;
    select * into att from public.attendance where id=aid for update;
    if not found or att.student_id <> actor or att.status <> 'A' then raise exception 'ATTENDANCE_UNAVAILABLE'; end if;
    if prior is not null and r.status = 'needs_fix' and not exists (
      select 1 from public.form14_lines where version_id=prior and attendance_id=aid and state='needs_fix'
    ) then raise exception 'REVISION_NOT_ALLOWED'; end if;
    if att.class_date <> (item->>'class_date')::date or att.course_name <> trim(item->>'course_name') or
      att.week_no <> (item->>'week_no')::int or length(trim(coalesce(item->>'lecturer_name',''))) < 2 then
      raise exception 'LINE_MISMATCH'; end if;
    if why = 'permission' and length(trim(coalesce(item->>'permission_kind',''))) < 3 then raise exception 'PERMISSION_KIND_REQUIRED'; end if;
    if why = 'sick' and coalesce(item->>'doctor_path','') !~ ('^' || actor::text || '/doctor_letter/[a-zA-Z0-9_-]+[.](pdf|png|jpg)$') then
      raise exception 'DOCTOR_LETTER_REQUIRED'; end if;
    insert into public.form14_lines(version_id,line_no,attendance_id,class_date,course_name,week_no,lecturer_name,reason,permission_kind,doctor_path)
    values(v,n,aid,att.class_date,att.course_name,att.week_no,trim(item->>'lecturer_name'),why,
      nullif(trim(coalesce(item->>'permission_kind','')),''),nullif(item->>'doctor_path',''));
  end loop;
  if prior is not null and r.status = 'needs_fix' and n <> (
    select count(*) from public.form14_lines where version_id=prior and state='needs_fix'
  ) then raise exception 'LINE_COUNT'; end if;
  update public.form14_requests set current_version_id=v,status='draft',updated_at=now() where id=r.id;
  insert into public.form14_audit(request_id,version_id,actor_id,action,reason)
    values(r.id,v,actor,'draft_saved','Draf disimpan oleh mahasiswa');
  return jsonb_build_object('request_id',r.id,'version_id',v,'version_no',(select version_no from public.form14_versions where id=v));
end $$;

create function public.form14_submit(p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); r public.form14_requests%rowtype; v public.form14_versions%rowtype; l public.form14_lines%rowtype;
begin
  select * into r from public.form14_requests where id=p_request for update;
  if not found or actor is null or r.student_id <> actor then raise exception 'REQUEST_DENIED'; end if;
  select * into v from public.form14_versions where id=r.current_version_id;
  if v.submitted_at is not null then return jsonb_build_object('request_id',r.id,'version_id',v.id,'status',r.status); end if;
  if r.status <> 'draft' or v.name_snapshot='' or v.nrp_snapshot='' or v.class_snapshot='' or v.program_snapshot='' then
    raise exception 'INCOMPLETE_FORM'; end if;
  if not exists (select 1 from storage.objects where bucket_id='form14-private' and name=v.form_path) then raise exception 'FORM_UPLOAD_MISSING'; end if;
  for l in select * from public.form14_lines where version_id=v.id order by line_no loop
    if l.reason='sick' and not exists (select 1 from storage.objects where bucket_id='form14-private' and name=l.doctor_path) then
      raise exception 'DOCTOR_UPLOAD_MISSING'; end if;
    if not exists (select 1 from public.attendance a where a.id=l.attendance_id and a.student_id=actor and a.status='A' for update) then
      raise exception 'ATTENDANCE_UNAVAILABLE'; end if;
    insert into public.form14_claims(attendance_id,request_id,line_id) values(l.attendance_id,r.id,l.id)
      on conflict (attendance_id) do update set line_id=excluded.line_id
      where public.form14_claims.request_id=r.id;
    if not found then raise exception 'ALREADY_CLAIMED'; end if;
  end loop;
  update public.form14_versions set submitted_at=now() where id=v.id;
  update public.form14_lines set state='submitted' where version_id=v.id;
  update public.form14_requests set status='submitted',updated_at=now() where id=r.id;
  insert into public.form14_audit(request_id,version_id,actor_id,action,reason)
    values(r.id,v.id,actor,'submitted','Permohonan diajukan oleh mahasiswa');
  return jsonb_build_object('request_id',r.id,'version_id',v.id,'status','submitted');
end $$;

create function public.form14_decide(
  p_line uuid, p_decision text, p_reason text,
  p_student_signature_checked boolean, p_lecturer_signature_checked boolean, p_doctor_letter_checked boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); l public.form14_lines%rowtype; r public.form14_requests%rowtype; v public.form14_versions%rowtype;
begin
  select * into l from public.form14_lines where id=p_line for update;
  select * into v from public.form14_versions where id=l.version_id;
  select * into r from public.form14_requests where id=v.request_id for update;
  if not found or r.current_version_id <> v.id or not public.is_officer_for(r.student_id) then raise exception 'OFFICER_DENIED'; end if;
  if p_decision not in ('approve','reject','needs_fix') or length(trim(coalesce(p_reason,''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if l.state <> 'submitted' then raise exception 'ALREADY_REVIEWED'; end if;
  if p_decision = 'approve' and (p_student_signature_checked is distinct from true or p_lecturer_signature_checked is distinct from true) then
    raise exception 'SIGNATURE_CHECK_REQUIRED';
  end if;
  if p_decision = 'approve' and l.reason = 'sick' and p_doctor_letter_checked is distinct from true then
    raise exception 'DOCTOR_CHECK_REQUIRED';
  end if;
  update public.form14_lines set state=case p_decision when 'approve' then 'approved_pending' when 'reject' then 'rejected' else 'needs_fix' end::public.form14_line_state,
    reviewed_by=actor,reviewed_at=now(),review_reason=trim(p_reason),
    student_signature_checked=coalesce(p_student_signature_checked,false),
    lecturer_signature_checked=coalesce(p_lecturer_signature_checked,false),
    doctor_letter_checked=coalesce(p_doctor_letter_checked,false) where id=p_line;
  if p_decision <> 'approve' then delete from public.form14_claims where attendance_id=l.attendance_id and line_id=l.id; end if;
  insert into public.form14_audit(request_id,version_id,line_id,actor_id,action,reason)
    values(r.id,v.id,p_line,actor,p_decision,trim(p_reason));
  perform public.form14_refresh_status(r.id);
  return jsonb_build_object('line_id',p_line,'state',(select state from public.form14_lines where id=p_line));
end $$;

-- One line, one transaction. Repeated calls return the stored result without a second audit row.
create function public.form14_apply(p_line uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); l public.form14_lines%rowtype; r public.form14_requests%rowtype; v public.form14_versions%rowtype; actual text;
begin
  select * into l from public.form14_lines where id=p_line for update;
  select * into v from public.form14_versions where id=l.version_id;
  select * into r from public.form14_requests where id=v.request_id for update;
  if not found or not public.is_officer_for(r.student_id) then raise exception 'OFFICER_DENIED'; end if;
  if l.state = 'applied' then return jsonb_build_object('line_id',p_line,'state','applied','status',l.target_status); end if;
  if r.current_version_id <> v.id then raise exception 'OFFICER_DENIED'; end if;
  if l.state <> 'approved_pending' or l.reviewed_by is null or v.submitted_at is null then raise exception 'NOT_APPROVED'; end if;
  update public.attendance set status=l.target_status,updated_at=now()
    where id=l.attendance_id and student_id=r.student_id and status='A'
      and exists (select 1 from public.form14_claims c where c.attendance_id=l.attendance_id and c.line_id=l.id);
  if not found then
    update public.form14_lines set state='conflict' where id=p_line;
    insert into public.form14_audit(request_id,version_id,line_id,actor_id,action,reason)
      values(r.id,v.id,p_line,actor,'conflict','Source status or claim changed') on conflict (line_id,action) do nothing;
    perform public.form14_refresh_status(r.id);
    return jsonb_build_object('line_id',p_line,'state','conflict');
  end if;
  select status into actual from public.attendance where id=l.attendance_id;
  if actual <> l.target_status then raise exception 'READBACK_FAILED'; end if;
  update public.form14_lines set state='applied',applied_at=now() where id=p_line;
  delete from public.form14_claims where attendance_id=l.attendance_id and line_id=l.id;
  insert into public.form14_audit(request_id,version_id,line_id,actor_id,action,reason)
    values(r.id,v.id,p_line,actor,'applied','Presensi diperbarui ke ' || actual) on conflict (line_id,action) do nothing;
  perform public.form14_refresh_status(r.id);
  return jsonb_build_object('line_id',p_line,'state','applied','status',actual);
end $$;

revoke all on function public.is_officer_for(uuid), public.can_read_request(uuid), public.can_read_form14_object(text), public.form14_refresh_status(uuid) from public, anon;
grant execute on function public.is_officer_for(uuid), public.can_read_request(uuid), public.can_read_form14_object(text) to authenticated;
revoke all on function public.form14_save(text,uuid,date,text,jsonb), public.form14_submit(uuid), public.form14_decide(uuid,text,text,boolean,boolean,boolean), public.form14_apply(uuid) from public, anon;
grant execute on function public.form14_save(text,uuid,date,text,jsonb), public.form14_submit(uuid), public.form14_decide(uuid,text,text,boolean,boolean,boolean), public.form14_apply(uuid) to authenticated;
