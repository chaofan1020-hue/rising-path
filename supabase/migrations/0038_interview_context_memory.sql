begin;

-- Keep a compact, durable interview memory on the session. Full resume source
-- and full turns remain in their existing version/turn tables; this data is
-- the fast, structured context used by the real-time interviewer path.
alter table public.interview_sessions
  add column if not exists context_digest jsonb not null default '{}'::jsonb,
  add column if not exists facts_ledger jsonb not null default '{}'::jsonb,
  add column if not exists context_memory_version integer not null default 1;

alter table public.interview_sessions
  drop constraint if exists interview_sessions_context_digest_check;
alter table public.interview_sessions
  add constraint interview_sessions_context_digest_check
  check (jsonb_typeof(context_digest) = 'object');

alter table public.interview_sessions
  drop constraint if exists interview_sessions_facts_ledger_check;
alter table public.interview_sessions
  add constraint interview_sessions_facts_ledger_check
  check (jsonb_typeof(facts_ledger) = 'object');

alter table public.interview_sessions
  drop constraint if exists interview_sessions_context_memory_version_check;
alter table public.interview_sessions
  add constraint interview_sessions_context_memory_version_check
  check (context_memory_version >= 1 and context_memory_version <= 10);

-- New callers pass a digest and ledger in the same transaction as the legacy
-- JSON transcript and normalized turn/question rows.
create or replace function public.commit_interview_turn(
  p_session_id integer,
  p_expected_revision bigint,
  p_request_id varchar,
  p_messages jsonb,
  p_current_round integer,
  p_status varchar,
  p_ended_reason varchar,
  p_turns jsonb,
  p_questions jsonb,
  p_context_digest jsonb,
  p_facts_ledger jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  session_row public.interview_sessions%rowtype;
  turn_item jsonb;
  question_item jsonb;
  inserted_turn_id bigint;
  next_revision bigint;
  previous_message_count integer;
  message_index integer;
begin
  if jsonb_typeof(p_messages) <> 'array'
    or jsonb_array_length(p_messages) > 200
    or jsonb_typeof(p_turns) <> 'array'
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_turns) > 2
    or jsonb_array_length(p_questions) > 1
    or jsonb_typeof(p_context_digest) <> 'object'
    or jsonb_typeof(p_facts_ledger) <> 'object'
    or length(p_context_digest::text) > 24000
    or length(p_facts_ledger::text) > 18000
    or p_status not in ('in_progress', 'completed')
    or p_current_round < 1 then
    raise exception 'invalid interview turn commit';
  end if;

  select * into session_row
  from public.interview_sessions
  where id = p_session_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'interview session not found';
  end if;
  if p_request_id is null then
    if session_row.revision <> 0
      or session_row.active_request_id is not null
      or jsonb_array_length(session_row.messages) <> 0 then
      raise exception 'opening interview turn already committed';
    end if;
  elsif length(trim(p_request_id)) < 8 then
    raise exception 'invalid interview request id';
  end if;
  if session_row.status <> 'in_progress'
    or session_row.revision <> p_expected_revision
    or session_row.active_request_id is distinct from p_request_id then
    raise exception 'interview session conflict';
  end if;
  if p_current_round > session_row.total_rounds then
    raise exception 'invalid interview round';
  end if;
  if p_current_round < session_row.current_round
    or p_current_round > session_row.current_round + 1 then
    raise exception 'invalid interview state transition';
  end if;
  if p_status = 'completed' and p_ended_reason not in ('manual', 'timeout', 'round_end', 'eliminated', 'wrap_up', 'error') then
    raise exception 'invalid interview completion reason';
  end if;
  if p_status = 'in_progress' and p_ended_reason is not null then
    raise exception 'unexpected interview completion reason';
  end if;

  previous_message_count := jsonb_array_length(session_row.messages);
  if jsonb_array_length(p_messages) <> previous_message_count + jsonb_array_length(p_turns) then
    raise exception 'interview transcript and turns do not match';
  end if;
  for message_index in 0 .. previous_message_count - 1
  loop
    if p_messages->message_index is distinct from session_row.messages->message_index then
      raise exception 'interview transcript history cannot be changed';
    end if;
  end loop;

  for turn_item in select value from jsonb_array_elements(p_turns)
  loop
    if turn_item->>'role' not in ('interviewer', 'candidate')
      or coalesce(length(trim(turn_item->>'content')), 0) = 0
      or coalesce((turn_item->>'turn_index')::integer, -1) < 0
      or coalesce((turn_item->>'round')::integer, 0) < 1
      or (turn_item->>'input_source') not in ('asr', 'asr_fallback', 'system') then
      raise exception 'invalid interview turn';
    end if;
    if (turn_item->>'turn_index')::integer < previous_message_count
      or (turn_item->>'turn_index')::integer >= jsonb_array_length(p_messages)
      or p_messages->((turn_item->>'turn_index')::integer)->>'role' is distinct from turn_item->>'role'
      or p_messages->((turn_item->>'turn_index')::integer)->>'content' is distinct from turn_item->>'content'
      or coalesce((p_messages->((turn_item->>'turn_index')::integer)->>'round')::integer, 1) <> (turn_item->>'round')::integer then
      raise exception 'interview turn does not match transcript';
    end if;
    if turn_item->>'role' = 'candidate' and turn_item->>'input_source' not in ('asr', 'asr_fallback') then
      raise exception 'candidate turn must come from ASR';
    end if;
    if turn_item->>'role' = 'interviewer' and turn_item->>'input_source' <> 'system' then
      raise exception 'interviewer turn source must be system';
    end if;

    insert into public.interview_turns (
      user_id, session_id, turn_index, round, role, content, client_request_id,
      input_source, interviewer_id, question_hash
    ) values (
      auth.uid(), p_session_id, (turn_item->>'turn_index')::integer,
      (turn_item->>'round')::integer, turn_item->>'role', trim(turn_item->>'content'),
      nullif(turn_item->>'client_request_id', ''), turn_item->>'input_source',
      nullif(turn_item->>'interviewer_id', '')::integer, nullif(turn_item->>'question_hash', '')
    ) on conflict (session_id, turn_index) do nothing
    returning id into inserted_turn_id;
  end loop;

  for question_item in select value from jsonb_array_elements(p_questions)
  loop
    if coalesce(length(trim(question_item->>'company_name')), 0) = 0
      or coalesce(length(trim(question_item->>'interview_type')), 0) = 0
      or coalesce(length(trim(question_item->>'question_text')), 0) = 0
      or coalesce(length(trim(question_item->>'question_hash')), 0) <> 64
      or coalesce((question_item->>'turn_index')::integer, -1) < 0 then
      raise exception 'invalid interview question';
    end if;

    select id into inserted_turn_id from public.interview_turns
    where session_id = p_session_id
      and turn_index = (question_item->>'turn_index')::integer
      and role = 'interviewer';
    if inserted_turn_id is null then
      raise exception 'question turn not found';
    end if;

    insert into public.interview_questions (
      user_id, session_id, turn_id, company_name, job_id, interview_type,
      round_role, interviewer_id, dimension, intent_key, scenario_key,
      question_text, question_hash, dna_version, practice_mode
    ) values (
      auth.uid(), p_session_id, inserted_turn_id, trim(question_item->>'company_name'),
      nullif(question_item->>'job_id', '')::integer, trim(question_item->>'interview_type'),
      nullif(question_item->>'round_role', ''), nullif(question_item->>'interviewer_id', '')::integer,
      coalesce(nullif(question_item->>'dimension', ''), 'general'),
      coalesce(nullif(question_item->>'intent_key', ''), 'general'), nullif(question_item->>'scenario_key', ''),
      trim(question_item->>'question_text'), trim(question_item->>'question_hash'),
      nullif(question_item->>'dna_version', '')::integer,
      coalesce(nullif(question_item->>'practice_mode', ''), 'fresh')
    ) on conflict (session_id, question_hash) do nothing;
  end loop;

  next_revision := p_expected_revision + 1;
  update public.interview_sessions
    set messages = p_messages,
        current_round = p_current_round,
        status = p_status,
        ended_reason = case when p_status = 'completed' then p_ended_reason else null end,
        completed_at = case when p_status = 'completed' then now() else null end,
        revision = next_revision,
        last_request_id = p_request_id,
        active_request_id = null,
        active_request_started_at = null,
        context_digest = p_context_digest,
        facts_ledger = p_facts_ledger,
        context_memory_version = 1,
        updated_at = now()
    where id = p_session_id;

  return next_revision;
end;
$$;

-- Keep the deployed pre-memory application compatible during a rolling restart.
create or replace function public.commit_interview_turn(
  p_session_id integer,
  p_expected_revision bigint,
  p_request_id varchar,
  p_messages jsonb,
  p_current_round integer,
  p_status varchar,
  p_ended_reason varchar,
  p_turns jsonb,
  p_questions jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_digest jsonb;
  current_ledger jsonb;
begin
  select context_digest, facts_ledger into current_digest, current_ledger
  from public.interview_sessions
  where id = p_session_id and user_id = auth.uid();

  return public.commit_interview_turn(
    p_session_id, p_expected_revision, p_request_id, p_messages, p_current_round,
    p_status, p_ended_reason, p_turns, p_questions,
    coalesce(current_digest, '{}'::jsonb), coalesce(current_ledger, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.commit_interview_turn(integer, bigint, varchar, jsonb, integer, varchar, varchar, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.commit_interview_turn(integer, bigint, varchar, jsonb, integer, varchar, varchar, jsonb, jsonb) to authenticated;

commit;
