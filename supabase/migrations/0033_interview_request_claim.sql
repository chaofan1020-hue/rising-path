begin;

alter table public.interview_sessions
  add column if not exists active_request_id varchar(80),
  add column if not exists active_request_started_at timestamptz;

create or replace function public.claim_interview_request(
  p_session_id integer,
  p_request_id varchar,
  p_revision bigint
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  result text;
begin
  if p_request_id is null or length(trim(p_request_id)) < 8 then
    raise exception 'invalid request id';
  end if;

  update public.interview_sessions
    set active_request_id = p_request_id,
        active_request_started_at = now()
    where id = p_session_id
      and user_id = auth.uid()
      and status = 'in_progress'
      and revision = p_revision
      and (
        active_request_id is null
        or active_request_started_at < now() - interval '2 minutes'
      );

  if found then
    return 'claimed';
  end if;

  if exists (
    select 1 from public.interview_sessions
    where id = p_session_id and user_id = auth.uid() and revision <> p_revision
  ) then
    return 'conflict';
  end if;
  return 'busy';
end;
$$;

grant execute on function public.claim_interview_request(integer, varchar, bigint) to authenticated;

commit;
