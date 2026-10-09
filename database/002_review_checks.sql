-- Add manual evidence checks and refresh Form 14 RPCs without replacing existing data.
begin;
alter table public.form14_lines add column if not exists student_signature_checked boolean not null default false;
alter table public.form14_lines add column if not exists lecturer_signature_checked boolean not null default false;
alter table public.form14_lines add column if not exists doctor_letter_checked boolean not null default false;
drop function if exists public.form14_decide(uuid,text,text);

create or replace function public.form14_save(p_key text, p_request uuid, p_statement_date date, p_form_path text, p_lines jsonb)
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

create or replace function public.form14_submit(p_request uuid) returns jsonb
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

create or replace function public.form14_decide(
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
create or replace function public.form14_apply(p_line uuid) returns jsonb
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

revoke all on function public.form14_save(text,uuid,date,text,jsonb), public.form14_submit(uuid), public.form14_decide(uuid,text,text,boolean,boolean,boolean), public.form14_apply(uuid) from public, anon;
grant execute on function public.form14_save(text,uuid,date,text,jsonb), public.form14_submit(uuid), public.form14_decide(uuid,text,text,boolean,boolean,boolean), public.form14_apply(uuid) to authenticated;
commit;
