begin;

alter table public.interview_sessions
  add column if not exists voice_route varchar(40);

alter table public.interview_sessions
  drop constraint if exists interview_sessions_voice_route_check;
alter table public.interview_sessions
  add constraint interview_sessions_voice_route_check
  check (voice_route is null or voice_route in ('domestic_alibaba', 'overseas_cartesia'));

create index if not exists interview_sessions_voice_route_idx
  on public.interview_sessions(voice_route, status)
  where status = 'in_progress';

commit;
