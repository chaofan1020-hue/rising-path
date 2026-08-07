begin;

-- job_configs may contain administrator-only values such as the password hash.
-- Public application code reads safe values through the server API instead.
drop policy if exists job_configs_read_active on public.job_configs;
revoke all on table public.job_configs from anon, authenticated;

commit;
