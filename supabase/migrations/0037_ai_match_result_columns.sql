begin;

-- Older production databases may have the profile-version columns but miss
-- the explainability fields introduced for AI job matching.
alter table if exists public.ai_matches
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists key_gaps jsonb not null default '[]'::jsonb;

alter table if exists public.ai_matches
  drop constraint if exists ai_matches_score_breakdown_object_check,
  drop constraint if exists ai_matches_evidence_array_check,
  drop constraint if exists ai_matches_key_gaps_array_check;

alter table if exists public.ai_matches
  add constraint ai_matches_score_breakdown_object_check
    check (jsonb_typeof(score_breakdown) = 'object'),
  add constraint ai_matches_evidence_array_check
    check (jsonb_typeof(evidence) = 'array'),
  add constraint ai_matches_key_gaps_array_check
    check (jsonb_typeof(key_gaps) = 'array');

comment on column public.ai_matches.evidence is
  'Resume and job evidence supporting the match score';
comment on column public.ai_matches.key_gaps is
  'Most important gaps between the resume and the job';

commit;
