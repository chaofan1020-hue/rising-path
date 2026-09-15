begin;

-- GoTrue sends the Confirm signup template (a link) whenever
-- auth.users.email_confirmed_at is null. Admin login needs the Magic Link / OTP
-- template, so force-confirm the Auth user and clear leftover signup tokens.
create or replace function public.confirm_auth_user_email(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  updated int;
begin
  if p_user_id is null then
    return false;
  end if;

  update auth.users
  set
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    confirmation_token = '',
    confirmation_sent_at = null,
    updated_at = now()
  where id = p_user_id;

  get diagnostics updated = row_count;

  update auth.identities
  set
    identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email_verified', true),
    updated_at = now()
  where user_id = p_user_id;

  return updated > 0;
end;
$$;

revoke all on function public.confirm_auth_user_email(uuid) from public, anon, authenticated;
grant execute on function public.confirm_auth_user_email(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
