-- Phase 4 / R18: mirror the company relationship on jobs_v3.
--
-- The detail endpoint embeds company_config through the FK declared on
-- public.jobs. Without the same FK on jobs_v3 PostgREST cannot resolve
-- `company_info:company_config(...)`, so the shadow read would break the
-- detail page the moment the read flag is enabled. Keeping the constraint
-- identical to production means a mirrored row can never reference a company
-- config that public.jobs would reject.
alter table public.jobs_v3
  add constraint jobs_v3_company_config_id_fkey
  foreign key (company_config_id) references public.company_config(id)
  on delete set null
  not valid;

alter table public.jobs_v3 validate constraint jobs_v3_company_config_id_fkey;

notify pgrst, 'reload schema';