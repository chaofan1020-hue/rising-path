begin;

alter table public.job_sync_runs
  add column if not exists current_stage varchar(40),
  add column if not exists current_company_name varchar(255),
  add column if not exists current_page integer not null default 0,
  add column if not exists current_cursor text,
  add column if not exists has_more boolean not null default false,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists stop_reason varchar(80);

create index if not exists job_sync_runs_running_heartbeat_idx
  on public.job_sync_runs(status, last_heartbeat_at desc)
  where status = 'running';

comment on column public.job_sync_runs.current_stage is '当前运行阶段：claiming/fetching/writing/finalizing/finished';
comment on column public.job_sync_runs.current_company_name is '当前正在处理的公司；全局 Feed 可为空或表示本页首家公司';
comment on column public.job_sync_runs.last_heartbeat_at is '运行中进度心跳时间，页面据此判断是否仍在推进';

commit;
