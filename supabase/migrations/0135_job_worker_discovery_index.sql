begin;

-- 0135_job_worker_discovery_index
--
-- The official-details worker rediscovers its company targets by paging
-- through every active collector-feed job (`order by id` + `range`) in batches
-- of 1000. Without a matching index Postgres had to sort the whole filtered
-- set for every page, so a cycle repeatedly hit Supabase's statement timeout
-- (`发现 Workday 公司失败: canceling statement due to statement timeout`).
--
-- A partial, covering index keeps each page an index-only scan.

set local statement_timeout = '300s';
set local lock_timeout = '15s';

create index if not exists jobs_collector_active_id_idx
  on public.jobs (id) include (company, job_url)
  where is_active
    and source_system = 'collector_feed'
    and job_url is not null;

analyze public.jobs;

notify pgrst, 'reload schema';

commit;
