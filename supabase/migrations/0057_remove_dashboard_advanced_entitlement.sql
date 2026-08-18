begin;

delete from public.entitlements
where feature_code = 'dashboard_advanced';

delete from public.usage_ledger
where feature_code = 'dashboard_advanced';

delete from public.credit_packs
where feature_code = 'dashboard_advanced';

commit;
