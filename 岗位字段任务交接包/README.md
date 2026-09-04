# Liorvix 岗位字段任务交接包

这是在没有原对话记录的电脑上继续岗位字段补全任务的独立资料包。

## 开始顺序

1. 阅读 `AGENTS.md`。
2. 阅读 `docs/job-field-task-completion-summary.md`，了解 Accenture 完成情况和生产自动队列状态。
3. 阅读 `docs/job-field-task-handoff.md`，按其中的 PowerShell SSH 命令只读核对生产 Supabase project ref。
4. 阅读 `docs/job-company-field-connector-runbook.md`，严格执行官方来源、20 条样本、dry-run、只补字段写入、数据库/API/页面验收和全公司回归流程。
5. 需要完整历史记录时，再阅读 `docs/job-company-field-execution-log.md` 和 `docs/all-company-job-field-completion-plan.md`。
6. 继续执行前先阅读 `docs/job-field-task-inventory-20260902.md`，它是第一阶段生产盘点和未完成事项总表。
7. 第一阶段的执行顺序、交付物和进入第二阶段的条件见 `docs/job-field-phase1-plan-20260902.md`。

## 当前状态

机器可读状态在 `docs/job-field-task-state.json`；第一阶段生产盘点见 `docs/job-field-task-inventory-20260902.md`。目前已完成 45 家公司的首轮字段回填；Citigroup 仍处于队列推进状态，另外 5 家来源已识别但尚未完成公司级验收，24 家仍需官方源探测。

## 使用说明

- 这个包应与完整项目目录一起放到新电脑；脚本依赖项目的 `package.json`、`src` 和 `scripts`。
- 只使用 `pnpm`，不要使用 npm 或 yarn。
- `正式发布服务器密钥.pem` 仅用于 SSH 认证，不要上传、分享或提交 Git。
- 服务器只保存程序和生产数据，交接文档以本地包为准。
