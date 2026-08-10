begin;

-- 网申状态只保留平台可控的三个：待投递 / 已投递 / 已关闭。
-- 历史状态归一化：面试中视为已投递，录用/拒绝等结果态视为已关闭。
update public.applications
set status = 'submitted'
where status in ('interview');

update public.applications
set status = 'closed'
where status in ('offer', 'rejected', 'resume_rejected', 'interview_rejected');

alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (status in ('pending', 'submitted', 'closed'));

commit;
