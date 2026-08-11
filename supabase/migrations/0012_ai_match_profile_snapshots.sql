begin;

-- Stage 3: keep an explainable, versioned snapshot for every AI match.
alter table if exists public.ai_matches
  add column if not exists resume_profile_version integer,
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists key_gaps jsonb not null default '[]'::jsonb;

alter table if exists public.ai_matches
  drop constraint if exists ai_matches_resume_profile_version_check,
  drop constraint if exists ai_matches_score_check,
  drop constraint if exists ai_matches_score_breakdown_object_check,
  drop constraint if exists ai_matches_evidence_array_check,
  drop constraint if exists ai_matches_key_gaps_array_check;

alter table if exists public.ai_matches
  add constraint ai_matches_resume_profile_version_check
    check (resume_profile_version is null or resume_profile_version > 0),
  add constraint ai_matches_score_check
    check (match_score between 0 and 100),
  add constraint ai_matches_score_breakdown_object_check
    check (jsonb_typeof(score_breakdown) = 'object'),
  add constraint ai_matches_evidence_array_check
    check (jsonb_typeof(evidence) = 'array'),
  add constraint ai_matches_key_gaps_array_check
    check (jsonb_typeof(key_gaps) = 'array');

create index if not exists ai_matches_resume_version_idx
  on public.ai_matches(resume_id, resume_profile_version);
create index if not exists ai_matches_job_score_idx
  on public.ai_matches(job_id, match_score desc);

comment on column public.ai_matches.resume_profile_version is
  'Confirmed resume profile version used to produce this match snapshot';
comment on column public.ai_matches.score_breakdown is
  'Validated 0-100 scoring dimensions returned by the matching model';
comment on column public.ai_matches.evidence is
  'Resume/job evidence supporting the match score';
comment on column public.ai_matches.key_gaps is
  'Most important gaps between the resume and the job';

commit;
