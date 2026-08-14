# Supabase 数据库迁移运行手册

## 这次反复报错的根因

本机最初同时遇到了几类不同问题，不能用同一种命令处理：

1. `SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 是 REST/Auth API 密钥，只能调用已有的 Supabase API，不能执行 `CREATE TABLE`、`ALTER TABLE`、`CREATE FUNCTION` 等 DDL。
2. `SUPABASE_DB_URL` 是 PostgreSQL 直连串，必须包含数据库密码；只写 host、端口和 `/postgres` 不够。
3. Windows 本机没有原生 Supabase CLI/`psql`，临时 `pnpm dlx supabase` 还可能因为系统架构没有匹配的 CLI 二进制而失败。
4. PowerShell 对嵌套引号和 `$()` 的处理容易破坏 `node -e` 命令，造成看起来像数据库问题的 JavaScript 语法错误。
5. 项目存在两个同编号迁移：`0025_*` 和 `0034_*`。只按编号去重会漏执行，必须按“编号 + 完整文件名”排序。

## 固定执行流程

以后执行管理员、AI 用量、音频用量和统计相关迁移，固定使用项目脚本，不手写临时命令：

```powershell
pnpm install
pnpm run db:migrate:admin:dry-run
pnpm run db:migrate:admin:check
pnpm run db:migrate:admin
pnpm run db:migrate:admin:check
```

脚本会从 `.env.local` 自动读取 `SUPABASE_DB_URL`，不会打印密码。默认范围是 `0017` 及之后的迁移；执行顺序按完整文件名排序，失败立即停止，不会继续执行后续文件。

## 2026-08-14 Dev 功能集成迁移

本地项目以既有 AI Match、面试和岗位同步迁移为主。远端 `dev` 原本使用的 `0017`、`0018`、`0019` 编号会与本地既有迁移冲突，已在本项目重编号为：

- `0050_allow_applications_without_resume.sql`：申请记录可暂不绑定简历。
- `0051_resume_optimizations_original_data.sql`：优化记录保存结构化原简历快照。
- `0052_personality_assessments.sql`：新增求职方向测评表及用户级 RLS。

不要在此项目中再执行远端同功能的 `0017_*`、`0018_*`、`0019_*` 文件。部署前先以 `--dry-run` 核对历史记录，再执行普通迁移；若目标库曾运行过这些远端原编号迁移，先核对迁移历史并进行人工修复，不能直接重复执行。

## 首次接入已有数据库

如果数据库已经通过旧方式成功执行过，但脚本自己的历史表还没有记录，先运行：

```powershell
pnpm run db:migrate:admin -- --baseline
```

基线模式只登记文件，不执行 SQL。只有在已经确认这些迁移确实落库时才能使用；不确定时不要使用，直接运行普通迁移，让幂等迁移自行校正。

## 凭据检查规则

只检查是否存在和是否可连接，不输出完整 key 或密码：

- `SUPABASE_URL`：应是 `https://<project-ref>.supabase.co`。
- `SUPABASE_ANON_KEY`：给浏览器/API 客户端使用，不能执行迁移。
- `SUPABASE_SERVICE_ROLE_KEY`：服务端高权限 API key，也不能执行 DDL。
- `SUPABASE_DB_URL`：必须是 `postgresql://...` 连接串，并包含可用密码。

若缺少 `SUPABASE_DB_URL` 或密码，去 Supabase Dashboard 的 **Connect** 页面复制 PostgreSQL connection string，写入本机 `.env.local`。不要提交 `.env.local`，不要把密码放进文档、日志、截图或聊天消息。

## 执行后的验证

至少验证：

- 关键表存在：`ai_usage_events`、`ai_model_prices`、`admin_audit_logs`、`admin_roles`。
- 关键函数存在：`get_admin_analytics`、`get_ai_usage_student_summary_v4`、`get_admin_prefill_quality`、`get_admin_service_health`、`get_admin_student_directory`。
- `pnpm run ts-check`、`pnpm run lint:build`、`pnpm run test:admin-permissions`、`pnpm run build` 全部通过。
- 管理员页面不再把数据库错误显示成“暂无数据”。

## 不要采用的方式

- 不要用 anon/service-role key 试图执行 SQL DDL。
- 不要把密码拼进命令行参数或临时脚本。
- 不要在 PowerShell 中用复杂的 `node -e` 嵌套引号执行数据库逻辑。
- 不要用 `git checkout` 或重置命令清理包管理器产生的工作区改动。
- 不要只执行最大的迁移编号；同编号的不同文件也必须执行。
