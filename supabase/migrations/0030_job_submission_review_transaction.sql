begin;

-- Approving a submission creates a public job and changes its review state in
-- one database transaction. Row locking makes a retry safe: only a pending
-- submission can be reviewed.
create or replace function public.review_job_submission(
  p_submission_id integer,
  p_action text,
  p_notes text default null
)
returns table (
  submission_id integer,
  submission_status text,
  job_id integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.job_submissions%rowtype;
  created_job_id integer := null;
  normalized_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if p_submission_id is null or p_submission_id <= 0 then
    raise exception '投稿 ID 无效' using errcode = '22023';
  end if;
  if p_action not in ('approve', 'reject') then
    raise exception '审核动作无效' using errcode = '22023';
  end if;

  select * into submission
  from public.job_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception '岗位投稿不存在' using errcode = 'P0002';
  end if;
  if submission.status <> 'pending' then
    raise exception '该岗位投稿已处理，不能重复审核' using errcode = 'P0001';
  end if;

  if p_action = 'approve' then
    insert into public.jobs (
      title, company, region, direction, job_type, job_url,
      description, salary_range, audience, is_active
    ) values (
      submission.title, submission.company,
      coalesce(nullif(btrim(submission.region), ''), '未标注'),
      coalesce(nullif(btrim(submission.direction), ''), '未标注'),
      submission.job_type, submission.job_url, submission.description,
      submission.salary_range, '留学生', true
    )
    returning id into created_job_id;
  end if;

  update public.job_submissions
  set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      reviewed_at = now(),
      notes = normalized_notes,
      updated_at = now()
  where id = submission.id;

  return query
  select
    submission.id,
    case when p_action = 'approve' then 'approved' else 'rejected' end,
    created_job_id;
end;
$$;

revoke all on function public.review_job_submission(integer, text, text) from public, anon, authenticated;
grant execute on function public.review_job_submission(integer, text, text) to service_role;

commit;
