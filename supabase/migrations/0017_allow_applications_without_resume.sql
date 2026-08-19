begin;

-- 用户可以先添加岗位到网申管理，之后再上传/选择简历，因此 resume_id 允许为空。
alter table public.applications
  alter column resume_id drop not null;

commit;
