begin;

alter table public.job_sync_runs
  add column if not exists total_candidates integer not null default 0,
  add column if not exists processed_candidates integer not null default 0,
  add column if not exists remaining_candidates integer not null default 0;

comment on column public.job_sync_runs.total_candidates is '当前公司本轮需要处理的岗位总数';
comment on column public.job_sync_runs.processed_candidates is '当前公司本轮已经处理的岗位数';
comment on column public.job_sync_runs.remaining_candidates is '当前公司本轮尚未处理的岗位数';

commit;
