begin;

-- `duration_ms` remains the backwards-compatible total duration. The explicit
-- columns below make it possible to chart interview first-token latency and
-- fallback/retry behaviour without parsing metadata JSON.
alter table public.ai_usage_events
  add column if not exists ttfb_ms integer,
  add column if not exists total_ms integer,
  add column if not exists phase text,
  add column if not exists fallback boolean not null default false,
  add column if not exists retry_count integer not null default 0;

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_latency_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_latency_check check (
    (ttfb_ms is null or ttfb_ms >= 0)
    and (total_ms is null or total_ms >= 0)
    and retry_count >= 0
  );

create index if not exists ai_usage_events_interview_latency_idx
  on public.ai_usage_events(feature, phase, created_at desc)
  where feature like 'interview_%';

commit;
