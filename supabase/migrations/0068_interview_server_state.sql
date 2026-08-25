begin;

-- Server-owned timing prevents browser throttling or crafted client requests
-- from deciding when an interview round expires.
alter table public.interview_sessions
  add column if not exists round_started_at timestamptz not null default now(),
  add column if not exists report_generation_status varchar(20) not null default 'idle',
  add column if not exists report_generation_started_at timestamptz,
  add column if not exists report_generation_request_id varchar(80);

update public.interview_sessions
  set round_started_at = coalesce(round_started_at, created_at, now())
  where round_started_at is null;

alter table public.interview_sessions
  drop constraint if exists interview_sessions_report_generation_status_check;
alter table public.interview_sessions
  add constraint interview_sessions_report_generation_status_check
  check (report_generation_status in ('idle', 'generating', 'completed'));

create index if not exists interview_sessions_report_generation_idx
  on public.interview_sessions(user_id, status, report_generation_status)
  where report is null;

commit;
