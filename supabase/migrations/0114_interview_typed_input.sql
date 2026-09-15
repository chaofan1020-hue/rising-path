begin;

-- A microphone is optional in the client. Keep the normalized interview turn
-- contract aligned with the typed-answer fallback used when audio devices are
-- missing or browser permissions are blocked.
alter table public.interview_turns
  drop constraint if exists interview_turns_input_source_check;
alter table public.interview_turns
  add constraint interview_turns_input_source_check
  check (input_source is null or input_source in ('asr', 'asr_fallback', 'typed', 'system'));

-- The context-memory version of commit_interview_turn contains the same
-- source checks inside PL/pgSQL. Rebuild its current definition in place so
-- existing sessions and the rolling deployment remain compatible.
do $$
declare
  function_sql text;
begin
  select pg_get_functiondef(p.oid)
    into function_sql
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'commit_interview_turn'
    and p.pronargs = 11;

  if function_sql is null then
    raise exception 'context-memory commit_interview_turn function is missing';
  end if;

  function_sql := replace(
    function_sql,
    $source$not in ('asr', 'asr_fallback', 'system')$source$,
    $source$not in ('asr', 'asr_fallback', 'typed', 'system')$source$
  );
  function_sql := replace(
    function_sql,
    $source$not in ('asr', 'asr_fallback')$source$,
    $source$not in ('asr', 'asr_fallback', 'typed')$source$
  );
  function_sql := replace(function_sql, 'candidate turn must come from ASR', 'candidate turn has an invalid input source');
  execute function_sql;
end;
$$;

commit;
