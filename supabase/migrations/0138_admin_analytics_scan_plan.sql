begin;

alter function public.get_admin_analytics(timestamptz, timestamptz)
  set enable_indexscan = off;

alter function public.get_admin_analytics(timestamptz, timestamptz)
  set enable_bitmapscan = off;

commit;
