# Dev 功能集成说明：2026-08-14

## 集成原则

本次以当前项目分支为基线，只移植 `origin/dev` 的新增求职功能。实时面试、AI Match、岗位同步、管理员运维脚本、Alibaba Model Studio 文本/ASR 和 Cartesia TTS 配置继续采用本地实现。

## 已集成功能

### 职业路径、签证与 Networking

- 根据简历画像、地区、求职阶段和签证信息生成职业路径与可执行计划。
- 提供签证时间线、职业路线细化和 Networking 推荐/进度 API。
- 驾驶舱与简历页展示职业路径、行动建议和 Networking 信息。

### 求职方向测评

- 新增 30 道题库，每次从分析、创意、人际、执行和风险偏好五个维度按配额抽取 12 题。
- 根据测评、专业、技能、经历和地区岗位库生成 3 个重点方向及 2 个 Sponsor 友好备选。
- 结果写入 `resumes.profile.personality`，完整记录保存到 `personality_assessments`，并由用户级 RLS 隔离。
- 新增 `/personality` 页面与 `GET/POST /api/personality/assessment`。

### ATS 简历优化审核

- 优化记录保存结构化原始简历快照，旧数据可按关联简历画像回退。
- 优化结果支持逐条接受、拒绝、撤销拒绝和结构化编辑。
- 评分接口兼容原始/优化简历包装格式和直接评分对象，保留本地地区招聘规则和分层上下文。

### 网申档案增强

- 网申档案可选择指定简历并由 AI 生成教育、经历、技能和个人信息。
- 手动保存继续使用版本号乐观锁；AI 填写后会同步返回新版本。
- 预填接口的简历选择顺序为：请求显式指定的简历、已绑定到网申档案的简历、用户最新简历。
- 申请记录可先创建，之后再关联简历。

## 数据库迁移

新增迁移必须按完整文件名排序执行：

1. `0050_allow_applications_without_resume.sql`
2. `0051_resume_optimizations_original_data.sql`
3. `0052_personality_assessments.sql`

执行迁移前先运行：

```powershell
pnpm run db:migrate:admin:dry-run
pnpm run db:migrate:admin:check
```

确认目标库未运行远端原编号的同功能迁移后，再运行 `pnpm run db:migrate:admin`。若已运行，必须先核对迁移历史，禁止重复执行。

## 数据库发布记录

2026-08-14 的目标库预检显示，`0050` 至 `0052` 对应的业务结构已存在，但项目迁移历史未登记这三个文件。经列定义、外键、索引和 RLS 策略核对后，使用 `--baseline` 仅登记了三份迁移，未重复执行 DDL：

- `applications.resume_id` 已允许为空。
- `resume_optimizations.original_data` 已存在且为非空 JSONB。
- `personality_assessments` 已具备预期列、约束、索引及用户 owner RLS 策略。

发布后完整检查结果为 40 份已登记、0 份待执行。其他环境仍必须先执行本说明中的预检流程，不能直接复制基线操作。

## 验证命令

```powershell
pnpm run validate
pnpm run test:career-route
pnpm run test:visa-timeline
pnpm run test:networking
pnpm run test:personality
pnpm run test:application-profile
pnpm run test:phase4
pnpm run test:tts-provider
```

## 上线后检查

- 已登录用户可以完成测评并在简历页、驾驶舱看到结果。
- 测评和网申档案 API 均拒绝跨用户的简历 ID。
- 未选择简历时仍可创建申请记录；选择简历后可正确生成预填档案。
- 优化记录可正常审核、撤销和导出，历史记录不缺少原始内容。
- 驾驶舱的职业路径、签证提示与 Networking 数据在未完成画像时保持降级显示。
