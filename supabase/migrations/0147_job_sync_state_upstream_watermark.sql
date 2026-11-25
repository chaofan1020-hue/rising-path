-- Phase 2 / R09: persist the upstream feed response watermark separately from
-- the resume cursor. `generated_at` is the server-side response timestamp;
-- it is an observability watermark, not a substitute for the cursor.
alter table public.job_sync_state
  add column if not exists upstream_watermark_at timestamptz;

comment on column public.job_sync_state.upstream_watermark_at is
  'Latest generated_at observed from the upstream feed; observability only, cursor remains the resume source of truth';

notify pgrst, 'reload schema';