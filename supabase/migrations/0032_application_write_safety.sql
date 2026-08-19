begin;

-- Replace is deliberately one transaction: a failed insert must never leave
-- a user's field-mapping set empty.
create or replace function public.replace_field_mappings(p_mappings jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  mapping jsonb;
begin
  if jsonb_typeof(p_mappings) <> 'array' or jsonb_array_length(p_mappings) > 200 then
    raise exception 'invalid field mappings';
  end if;

  delete from public.field_mappings where user_id = auth.uid();

  for mapping in select value from jsonb_array_elements(p_mappings)
  loop
    if coalesce(length(trim(mapping->>'company_pattern')), 0) = 0
      or coalesce(length(trim(mapping->>'field_name')), 0) = 0
      or coalesce(length(trim(mapping->>'target_field')), 0) = 0
      or length(mapping->>'company_pattern') > 255
      or length(mapping->>'field_name') > 255
      or length(mapping->>'target_field') > 255 then
      raise exception 'invalid field mapping';
    end if;

    insert into public.field_mappings (user_id, company_pattern, field_name, target_field, is_active, updated_at)
    values (
      auth.uid(),
      trim(mapping->>'company_pattern'),
      trim(mapping->>'field_name'),
      trim(mapping->>'target_field'),
      true,
      now()
    );
  end loop;
end;
$$;

grant execute on function public.replace_field_mappings(jsonb) to authenticated;

-- Apply profile changes and their learning feedback together. A stale client
-- gets NULL and no feedback/profile row is written.
create or replace function public.apply_prefill_feedback(
  p_expected_version integer,
  p_resume_id integer,
  p_profile jsonb,
  p_source jsonb,
  p_feedback jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_version integer;
  next_version integer;
  feedback jsonb;
begin
  if jsonb_typeof(p_profile) <> 'object'
    or jsonb_typeof(p_source) <> 'object'
    or jsonb_typeof(p_feedback) <> 'array'
    or jsonb_array_length(p_feedback) = 0
    or jsonb_array_length(p_feedback) > 50 then
    raise exception 'invalid prefill feedback';
  end if;

  select version into current_version
  from public.application_profiles
  where user_id = auth.uid()
  for update;

  if current_version is null then
    if p_expected_version <> 0 then return null; end if;
    next_version := 1;
    insert into public.application_profiles (user_id, resume_id, profile, source, field_stats, version, updated_at)
    values (auth.uid(), p_resume_id, p_profile, p_source, p_source, next_version, now());
  else
    if current_version <> p_expected_version then return null; end if;
    next_version := current_version + 1;
    update public.application_profiles
      set resume_id = p_resume_id,
          profile = p_profile,
          source = p_source,
          field_stats = p_source,
          version = next_version,
          updated_at = now()
      where user_id = auth.uid();
  end if;

  for feedback in select value from jsonb_array_elements(p_feedback)
  loop
    if coalesce(length(trim(feedback->>'field_key')), 0) = 0
      or coalesce(length(trim(feedback->>'semantic_key')), 0) = 0
      or feedback->>'action' not in ('confirmed', 'edited', 'ignored') then
      raise exception 'invalid feedback item';
    end if;
    insert into public.prefill_feedback (
      user_id, job_id, domain, field_key, semantic_key, suggested_value, final_value, action
    ) values (
      auth.uid(),
      nullif(feedback->>'job_id', '')::integer,
      nullif(feedback->>'domain', ''),
      trim(feedback->>'field_key'),
      trim(feedback->>'semantic_key'),
      coalesce(feedback->>'suggested_value', ''),
      coalesce(feedback->>'final_value', ''),
      feedback->>'action'
    );
  end loop;

  return next_version;
end;
$$;

grant execute on function public.apply_prefill_feedback(integer, integer, jsonb, jsonb, jsonb) to authenticated;

commit;
