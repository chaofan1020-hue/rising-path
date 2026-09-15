begin;

alter table if exists public.ai_matches
  add column if not exists recommendation_type varchar(32),
  add column if not exists confidence integer,
  add column if not exists eligibility jsonb not null default '{}'::jsonb,
  add column if not exists field_quality jsonb not null default '{}'::jsonb;

alter table if exists public.ai_matches
  drop constraint if exists ai_matches_confidence_check,
  drop constraint if exists ai_matches_eligibility_object_check,
  drop constraint if exists ai_matches_field_quality_object_check;

alter table if exists public.ai_matches
  add constraint ai_matches_confidence_check
    check (confidence is null or confidence between 0 and 100),
  add constraint ai_matches_eligibility_object_check
    check (jsonb_typeof(eligibility) = 'object'),
  add constraint ai_matches_field_quality_object_check
    check (jsonb_typeof(field_quality) = 'object');

create index if not exists ai_matches_user_recommendation_idx
  on public.ai_matches(user_id, resume_id, resume_profile_version, recommendation_type, match_score desc);

notify pgrst, 'reload schema';
commit;
