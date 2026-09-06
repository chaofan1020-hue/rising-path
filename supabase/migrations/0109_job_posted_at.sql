begin;

-- 官网发布时间（feed date_posted / 官方详情 datePosted），只做记录，不参与生命周期
alter table public.jobs
  add column if not exists posted_at timestamptz;

create index if not exists jobs_active_posted_at_idx
  on public.jobs (posted_at desc)
  where is_active = true and posted_at is not null;

notify pgrst, 'reload schema';
commit;