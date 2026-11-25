-- Phase 3 / R12: shadow v3 table.  The old public.jobs table stays readable
-- and writable until the cutover; this table is populated by an explicit
-- backfill and then by the shadow feed only.
--
-- Rollback: drop table if exists public.jobs_v3; (old public.jobs untouched)

create table if not exists public.jobs_v3
  (like public.jobs including defaults);

alter table public.jobs_v3
  add column if not exists lane varchar(10),
  add column if not exists closure_evidence jsonb not null default '{}'::jsonb,
  add column if not exists canonical_job_id integer;

-- Keep v3 IDs stable with the existing read path during shadow validation.
create sequence if not exists public.jobs_v3_id_seq;
alter table public.jobs_v3 alter column id set default nextval('public.jobs_v3_id_seq');
alter sequence public.jobs_v3_id_seq owned by public.jobs_v3.id;

alter table public.jobs_v3
  add constraint jobs_v3_pkey primary key (id),
  add constraint jobs_v3_lane_check check (lane in ('ats', 'legacy')),
  add constraint jobs_v3_ats_source_key_check
    check (lane <> 'ats' or source_key is not null);

-- ATS identity is authoritative; legacy identity remains company/external ID
-- because old rows legitimately have no source_key.
create unique index if not exists jobs_v3_ats_identity_uidx
  on public.jobs_v3 (source_key, external_job_id)
  where lane = 'ats' and source_key is not null and external_job_id is not null;

create index if not exists jobs_v3_active_display_idx
  on public.jobs_v3 (display_status) where is_active;
create index if not exists jobs_v3_region_active_idx
  on public.jobs_v3 (region, display_status) where is_active;
create index if not exists jobs_v3_company_active_idx
  on public.jobs_v3 (company) where is_active;
create index if not exists jobs_v3_dedupe_group_idx
  on public.jobs_v3 (dedupe_group_id) where dedupe_group_id is not null;
create index if not exists jobs_v3_ai_match_search_idx
  on public.jobs_v3 using gin (ai_match_search);

alter table public.jobs_v3 enable row level security;
drop policy if exists jobs_v3_public_read on public.jobs_v3;
create policy jobs_v3_public_read on public.jobs_v3
  for select to anon, authenticated using (is_active);
grant select on public.jobs_v3 to anon, authenticated;

comment on table public.jobs_v3 is 'v3 shadow job table; lane=ats|legacy, source_key mandatory for ATS';
comment on column public.jobs_v3.closure_evidence is 'authoritative evidence for a close (feed event, 404, snapshot)';
comment on column public.jobs_v3.canonical_job_id is 'reserved canonical mapping for cross-lane duplicates';