begin;

-- 用户可以先添加岗位到网申管理，之后再上传或选择简历。
alter table public.applications
  alter column resume_id drop not null;

commit;
