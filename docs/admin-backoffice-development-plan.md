# Liorvix 管理员后台开发计划

> 执行状态：2026-08-12，当前批次正在落实 P0 管理员读取隔离和 P1 数据量化基础。本文同时作为后台整改的执行清单；完成项必须有代码位置、验证命令和外部环境验收条件。

## 目标

建设一个面向运营、内容审核和产品管理员的后台，统一管理：

- 企业 DNA
- 模拟面试反馈
- 岗位与岗位来源
- 用户与简历处理状态
- 网申记录
- 公司配置和 Logo
- 系统运行质量与关键业务指标

管理员后台不是普通用户页面的简单拼接。所有后台接口必须独立进行权限校验、审计记录和输入验证。

## 当前基础

当前已有后台页面：

- src/app/admin/page.tsx
- src/app/admin/dna-review/page.tsx
- src/app/admin/layout.tsx

当前已有后台接口：

- /api/admin/company-config
- /api/admin/company-logos
- /api/admin/dna-feedback
- /api/admin/dna-feedback/[id]
- /api/admin/job-submissions
- /api/admin/password

当前管理员认证主要通过：

- src/lib/admin-auth.ts
- HttpOnly 管理员 Cookie
- HMAC 签名会话
- 数据库密码配置和部署引导密码

当前主要问题：

- 权限基本是单一管理员，暂未形成角色和权限矩阵。
- 后台页面之间缺少统一导航和布局。
- DNA 编辑缺少独立的新建、发布、版本和回滚流程。
- 缺少管理员操作审计日志。
- 缺少批量操作、筛选、分页和错误状态标准。
- 统计页面还没有统一的数据口径。

## 当前执行批次

### 已完成

- [x] 管理员审计日志表和统一脱敏写入服务：`0021_admin_audit_logs.sql`、`src/lib/admin-audit.ts`。
- [x] 管理员审计查询页：`/api/admin/audit-logs`，支持资源、操作和服务端分页。
- [x] 岗位、配置、企业配置、Logo、网申、简历删除、DNA、反馈审核和密码修改写操作接入审计。
- [x] AI 文本、ASR、TTS 用量事件及学生聚合接口：`0017`–`0019`、`/api/admin/ai-usage/*`。
- [x] 岗位后台列表使用数据库分页和服务端搜索。
- [x] 管理员简历、网申、配置读取接口独立于普通用户接口：`/api/admin/resumes`、`/api/admin/applications`、`/api/admin/configs`。
- [x] 简历和网申后台列表使用服务端分页、状态筛选、安全字段和 exact count；不返回完整简历正文或用户邮箱。

### 当前进行中

- [ ] 将管理员读取接口在 staging/生产 Supabase 环境验证，重点检查 `service_role`、RLS、关联查询字段和 `0021` 迁移。
- [x] 管理员仪表盘 analytics 已迁移为数据库聚合：`0022_admin_analytics_aggregates.sql`、`/api/admin/analytics`；旧 `/api/analytics` 已退役，避免继续全表读取。
- [x] AI 用量事件已接入版本化模型价格和预计成本：`0023_ai_model_prices.sql`、`/api/admin/ai-prices`；事件保存价格快照，按币种聚合，未定价调用不计入金额。
- [x] 已按官方定价填入当前 provider 基线：`0024_seed_ai_model_prices.sql`；Cartesia 价格明确标注为套餐等价估算，等待实际合同/PAYG 账单后替换。
- [x] 已补充实时 ASR 价格并修正 Cartesia 基线：`0025_correct_audio_price_baselines.sql`；`qwen3-asr-flash-realtime` 按国际/新加坡官方价计费，Cartesia 仅保留内部套餐折算估算。
- [x] 建立共享管理员壳层和响应式导航：`src/components/admin-shell.tsx`；`/admin` 与 `/admin/dna-review` 统一认证、导航和页面结构。
- [x] 建立角色权限基础和统一权限函数：`0026_admin_roles_and_dna_versions.sql`、`src/lib/admin-permissions.ts`；共享密码暂以 `legacy_super_admin` 兼容映射。
- [x] DNA 发布生成不可变版本快照，并增加版本历史和回滚 API：`/api/admin/dna/versions`；回滚和发布写入审计日志。
- [x] 其他管理员 API 已迁移到细粒度权限函数；密码登录、会话检查和退出仍保留独立安全流程。
- [x] 管理员 Supabase Auth 账号绑定和角色管理：`/api/admin/auth`、`/api/admin/accounts`、`/admin/accounts`；共享密码保留为迁移期兼容入口。
- [x] 后台前端按权限收敛：`/api/admin/auth` 返回权限快照，导航、Tab、DNA 审核和管理员账号页按 permission key 显示；无权直达 URL 自动回退或显示无权状态，不再发起必然 `403` 的请求。
- [x] 学生 AI 用量详情：`/api/admin/students/[id]`、`/admin/students/[id]` 汇总单个学生的 Token、ASR/TTS 时长、价格快照成本、业务计数、功能拆分与最近调用摘要；不返回简历正文和面试对话。
- [x] 管理员路径下的简历删除和网申更新改为高权限操作：通用用户 API 检测到管理员会话时要求 `admin.config.write`，用户管理员列表默认只读并链接到学生详情。
- [x] 阻断管理员误用普通用户全量接口：管理员访问 `/api/resume`、`/api/applications` 返回 `403`，必须使用脱敏分页管理员接口；岗位创建、编辑、删除和批量操作要求 `admin.jobs.write`。
- [x] 岗位运营权限扫尾：岗位同步、Techmap 同步、岗位描述抓取/生成、结构化处理、赞助商批量判断、岗位审核队列、岗位表格导入和管理端外链抓取统一要求 `admin.jobs.write`；管理员共享密码修改要求 `admin.config.write`。
- [x] 网申字段映射质量看板：`0027_application_prefill_quality_aggregates.sql`、`/api/admin/prefill-quality`、后台“网申质量”页按聚合口径展示确认率、修改率、忽略量、趋势、字段高纠错榜和共享模板高纠错榜；不返回填写内容或用户身份。
- [x] 服务健康看板：`0028_admin_service_health_aggregates.sql`、`/api/admin/service-health`、后台“服务健康”页按已记录 AI 调用和岗位同步状态展示供应商成功率、平均耗时、失败热点与同步滞后；页面刷新不产生第三方探测调用。
- [x] 服务健康告警摘要：在页面顶部汇总供应商异常/告警、岗位同步滞后与当前同步中状态，便于运营快速识别需处理事项；告警只基于已有聚合数据。
- [x] 岗位运营审计补齐：投稿审核/删除、赞助判断、岗位描述抓取/生成、结构化处理和 Techmap 同步均记录操作结果或失败；投稿审核拒绝未知 action，正式岗位写入失败会返回失败而非静默标记已批准。
- [x] AI 用量导出权限与审计：新增 `admin.usage.export`，仅超级管理员与共享密码兼容管理员可下载按当前筛选条件的脱敏 CSV；导出不包含简历、面试、提示词、音频、邮箱或错误正文，并记录筛选条件与导出条数。
- [x] 岗位投稿审核工作台：`/api/admin/job-submissions` 提供脱敏分页列表，后台“投稿审核”支持按状态/岗位/公司筛选、批准/拒绝确认与删除；查看需要 `admin.jobs.read`，写操作需要 `admin.jobs.write`，批准调用 `0030` 原子事务。
- [x] 岗位 Feed 运营状态：岗位页显示数据源配置、最近增量/完整对账成功时间、连续失败和最近错误；同步状态支持手动刷新，完整对账要求二次确认；`/api/jobs/sync-feed` 对 `maxPages` 做 1–1000 整数校验。
- [x] 岗位只读权限收口：没有 `admin.jobs.write` 的管理员只能查询和打开岗位外链，新增、编辑、删除、导入、批量选择、同步和完整对账入口均不显示。
- [x] 学生运营目录：`0034_admin_student_directory.sql`、`/api/admin/students`、`/admin/students` 提供服务端分页、昵称/ID 搜索，以及简历、网申、面试、AI 调用和 Token 的脱敏运营汇总；仅 `admin.users.read` 可访问，并链接到既有学生成本详情。

### 下一批验收标准

1. 未带管理员会话访问 `/api/admin/resumes`、`/api/admin/applications`、`/api/admin/configs` 必须返回 `401`。
2. 管理员列表只返回当前页安全字段；服务端响应不得包含 `parsed_content`、`profile`、完整邮箱、面试消息或对象存储密钥。
3. `meta.total` 和 `summary.byStatus` 与数据库真实记录一致，筛选、搜索和分页的口径一致。
4. 删除简历、更新网申后，当前页和总数正确刷新，并产生对应审计记录。
5. `0017`、`0018`、`0019`、`0020`、`0021`、`0022` 在 staging 按顺序执行；远端已有历史时先核对 migration history，不直接重放或改名覆盖。
6. `0023_ai_model_prices.sql` 在 `0022` 后执行；配置模型价格后验证文本 Token、ASR/TTS 音频计费、未定价调用和历史价格快照。
7. `0024_seed_ai_model_prices.sql` 在 `0023` 后执行；验证后台能读取三条价格，下一次 AI 调用写入 `price_snapshot`。
8. `0025_correct_audio_price_baselines.sql` 在 `0024` 后执行；验证实时 ASR 使用 `qwen3-asr-flash-realtime` 时有价格快照，Cartesia 估算来源明确可见。
9. `content_admin` 不显示学生、配置、审计和管理员账号模块；`support_admin` 不显示 DNA、岗位、配置、审计和管理员账号模块；直接访问无权页面不会显示或请求受限数据。
10. 学生详情仅限 `admin.users.read`，显示 Token、ASR/TTS 时长和事件成本快照，不返回简历原文、邮箱、面试消息或第三方凭据。
11. `0027_application_prefill_quality_aggregates.sql` 在 staging/生产执行后，验证“网申质量”页仅返回聚合数据；确认率、修改率的分母均为 `confirmed + edited`，忽略量不混入分母。
12. `0028_admin_service_health_aggregates.sql` 在 staging/生产执行后，验证服务健康页不返回请求文本、错误正文或凭据；AI 状态与 `ai_usage_events`、岗位同步状态与 `job_sync_state` 一致。
13. `0029_admin_usage_export_permission.sql` 在 `0026`、`0027`、`0028` 后执行，验证仅 `super_admin` 与 `legacy_super_admin` 获得 `admin.usage.export`；CSV 导出记录审计日志且不含简历、对话、提示词、音频、邮箱或错误正文。
14. `0030_job_submission_review_transaction.sql` 在 `0029` 后执行，验证批准/拒绝只能处理 `pending` 投稿；批准后岗位和审核状态同时存在，任一写入失败时二者均不变。
15. 岗位页只能由 `admin.jobs.write` 读取或触发 Feed 同步状态；完整对账必须确认，非法 `maxPages` 返回 `400` 且不启动同步任务。

## 迁移执行清单

当前仓库新增迁移：

| 文件 | 用途 | 执行前提 |
| --- | --- | --- |
| `0017_ai_usage_events.sql` | AI/音频调用明细与 usage 来源 | 基础业务表已存在 |
| `0018_ai_usage_admin_aggregates.sql` | 管理员用量汇总函数 | `0017` 已执行 |
| `0019_audio_ai_usage_metrics.sql` | ASR/TTS 时长、字节、计费单位汇总 | `0017`、`0018` 已执行 |
| `0020_job_feed_reconciliation.sql` | 岗位 Feed 对账字段和约束 | 当前岗位表结构与代码一致 |
| `0021_admin_audit_logs.sql` | 管理员审计日志表、索引和 service role 权限 | service role 仅服务端使用 |
| `0022_admin_analytics_aggregates.sql` | 管理员仪表盘的有界数据库聚合与索引 | `profiles`、简历、网申、AI 匹配和岗位表已存在；在 `0021` 后执行 |
| `0023_ai_model_prices.sql` | 版本化模型价格、事件价格快照和按币种成本聚合 | `0019`、`0022` 已执行；在 `0022` 后执行 |
| `0024_seed_ai_model_prices.sql` | 当前 Alibaba 文本/ASR 与 Cartesia TTS 价格基线 | `0023` 已执行；价格变更应新增价格记录，不覆盖历史快照 |
| `0025_correct_audio_price_baselines.sql` | 实时 ASR 价格和 Cartesia 估算基线修正 | `0024` 已执行；停用旧估算但保留历史价格快照 |
| `0025_interview_core_upgrade.sql` | 面试核心表和实时面试结构升级 | 与价格修正同编号，部署工具必须按文件名确认执行状态 |
| `0026_admin_roles_and_dna_versions.sql` | 管理员角色权限、DNA 版本快照、发布和回滚函数 | `company_dna`、`auth.users` 已存在；在两个 `0025` 迁移均确认后执行 |
| `0027_application_prefill_quality_aggregates.sql` | 网申预填质量聚合、趋势和映射/模板纠错榜 | `0005`、`0008` 已执行；在现有 `0026` 之后执行 |
| `0028_admin_service_health_aggregates.sql` | AI 调用和岗位同步的服务健康聚合 | `0017`、`0020` 已执行；在 `0027` 后执行 |
| `0029_admin_usage_export_permission.sql` | AI 用量导出权限种子 | `0026` 已执行；在 `0028` 后执行 |
| `0030_job_submission_review_transaction.sql` | 岗位投稿批准/拒绝的原子事务 | `job_submissions`、`jobs` 已存在；在 `0029` 后执行 |
| `0031_voice_only_interview_constraints.sql` | 语音面试输入约束与会话字段补齐 | 面试核心表已存在；在 `0030` 后执行 |
| `0032_application_write_safety.sql` | 网申资料/反馈并发写入与字段映射原子替换 | 网申资料、反馈和映射表已存在；在 `0031` 后执行 |
| `0033_interview_request_claim.sql` | 面试请求互斥领取，防止并发重复生成 | `interview_sessions` 已存在；在 `0032` 后执行 |
| `0034_admin_student_directory.sql` | 管理员学生目录的脱敏聚合、搜索和分页 | `profiles`、简历、网申、面试、AI 用量表已存在；在 `0033` 后执行 |

## 仪表盘统计口径

- 新增：目标表的 `created_at` 落在选定 UTC 半开区间 `[from, to)`。
- 活跃学生：该区间内至少创建过一条简历、网申或 AI 选岗记录的用户。
- 活跃学生平均操作：区间内上述三类记录总数除以活跃学生数；无活跃学生时为 `0`。
- 岗位库存与岗位地区/方向分布：当前 `is_active = true` 的全部岗位，不随时间范围变化。
- 网申状态分布：区间内创建的网申按状态统计；历史 `interview` 统一计入 `submitted`。
- 趋势：截至 `to` 的 7 个 UTC 自然日，当天为截至查询时刻的部分数据。
- 用户活跃排行：按选定区间内三类操作总数降序，仅返回前 10 名和显示名；不返回邮箱、简历正文或画像 JSON。

迁移完成后必须检查：`select version from supabase_migrations.schema_migrations order by version;`，并用管理员会话实际访问上述接口。`.env.local` 中的 Supabase URL、anon key 和 service role key 只在部署环境配置，不能写入文档或提交。

## 设计原则

1. 最小权限：管理员只能访问完成工作所需的数据和操作。
2. 服务端授权：不能只依赖前端隐藏按钮。
3. 所有写操作可追溯：记录操作者、对象、前后值和结果。
4. 草稿与发布分离：AI 生成内容不能自动成为正式生产配置。
5. 高风险操作二次确认：删除、批量下线、发布 DNA 和修改权限必须确认。
6. 列表接口必须分页：禁止后台一次性读取全量用户、面试和对话。
7. 敏感数据最小化：后台默认不展示完整简历、邮箱和完整面试内容。
8. 先稳定主链路，再增加数据看板和自动化运营。

## 后台信息架构

~~~text
/admin
├── 仪表盘
├── 面试质量
│   ├── 真实度反馈
│   ├── 低分案例
│   └── 面试问题质量
├── 企业 DNA
│   ├── 企业列表
│   ├── DNA 编辑
│   ├── 版本历史
│   └── 待审核生成版
├── 岗位运营
│   ├── 岗位列表
│   ├── 岗位审核
│   ├── 岗位来源
│   └── 同步任务
├── 用户与简历
│   ├── 用户概览
│   ├── 简历处理状态
│   └── 用户反馈
├── 网申运营
│   ├── 投递统计
│   └── 字段映射质量
├── 系统配置
│   ├── 公司配置
│   ├── 公司 Logo
│   └── AI/语音服务状态
└── 系统管理
    ├── 管理员与角色
    ├── 审计日志
    └── 系统健康
~~~

## 角色与权限

第一阶段可以只保留三类角色：

| 角色 | 主要职责 | 默认权限 |
|---|---|---|
| super_admin | 系统、安全和权限管理 | 全部权限 |
| content_admin | 企业 DNA、岗位和内容审核 | 内容相关读写 |
| support_admin | 用户问题和面试反馈处理 | 用户和反馈只读/有限编辑 |

权限使用明确的 permission key：

~~~text
admin.dashboard.read
admin.dna.read
admin.dna.write
admin.dna.publish
admin.feedback.read
admin.feedback.review
admin.jobs.read
admin.jobs.write
admin.users.read
admin.usage.export
admin.config.write
admin.audit.read
admin.roles.write
~~~

不要在业务代码中到处判断角色字符串。统一使用服务端权限函数，例如：

~~~ts
requireAdminPermission(request, admin.dna.publish)
~~~

## 认证与安全改造

### 第一阶段：加固现有认证

1. 管理员 Cookie 设置 HttpOnly、Secure、SameSite 和合理过期时间。
2. 登录接口增加 IP 和账号级限流。
3. 登录失败记录审计事件，但不记录密码。
4. 管理员修改密码后撤销已有会话。
5. 管理员会话增加 session id 和撤销状态。
6. 生产环境禁止使用默认引导密码。
7. 管理员 API 统一检查 Origin、CSRF 和请求来源。
8. 对高风险写操作增加二次确认或重新验证密码。

### 第二阶段：迁移到角色体系

建议新增：

~~~text
admin_users
- id
- auth_user_id
- status
- last_login_at
- created_at

admin_roles
- id
- name
- description

admin_user_roles
- admin_user_id
- role_id

admin_permissions
- key
- description

admin_role_permissions
- role_id
- permission_key
~~~

管理员身份应绑定 Supabase Auth 用户，不使用共享管理员账号。

## 审计日志

建议新增 admin_audit_logs：

~~~text
id
admin_user_id
action
resource_type
resource_id
request_id
before_data
after_data
result
ip_hash
user_agent
created_at
~~~

必须记录的操作：

- 登录成功和失败
- 修改密码
- 新建、编辑、发布和回滚 DNA
- 修改岗位
- 修改用户状态
- 查看敏感面试内容
- 批量操作
- 修改系统配置
- 修改管理员角色

审计日志只允许追加，不允许普通管理员修改或删除。

## 核心模块开发计划

### 1. 管理员布局和导航

第一批完成：

- 统一侧边栏和顶部栏
- 当前管理员信息
- 退出登录
- 面包屑和页面标题
- 权限不足页面
- 加载、空状态、错误状态
- 移动端基础适配

后台页面应使用紧凑、可扫描的运营型布局，列表支持搜索、筛选、排序、分页和批量操作。

### 2. 仪表盘

首屏只展示对运营有决策价值的指标：

- 今日/近 7 日新增用户
- 简历解析成功率
- 模拟面试次数
- 面试完成率
- 平均真实度
- 低真实度反馈数量
- 待审核 DNA 数量
- 岗位有效数量
- 网申记录数量
- AI、TTS、ASR 错误率

所有指标必须定义统计口径、时间范围和数据来源，避免不同页面出现不同数字。

### 3. 企业 DNA 管理

这是后台的第一优先级业务模块。

企业列表支持：

- 企业名称和别名搜索
- 来源筛选
- 状态筛选
- 版本号
- 命中次数
- 最近审核时间
- 平均真实度
- 低分率

企业详情支持：

- 基础信息
- 别名
- DNA 摘要
- 完整 DNA JSON
- 适用岗位和地区
- 来源证据
- 置信度
- 当前发布版本
- 历史版本
- 相关反馈案例

DNA 生命周期：

~~~text
generated
  -> pending_review
  -> draft
  -> published
  -> archived
  -> rollback
~~~

发布前必须校验：

- JSON Schema 完整
- 企业名称和别名不冲突
- 至少存在 3 个考察维度
- 每个维度至少存在一个追问点
- 没有超长字段
- 没有明显通用模板内容
- 已填写来源或审核备注

发布动作必须产生新版本，不能直接覆盖旧版本。

### 4. 面试反馈审核

现有 dna-review 页面升级为统一反馈中心。

列表支持：

- 真实度分数筛选
- 公司筛选
- 状态筛选
- DNA 版本筛选
- 时间筛选
- 关键词搜索

详情展示：

- 用户反馈
- 面试类型和岗位
- 公司 DNA 来源和版本
- 面试对话
- 问题重复信息
- 候选人分层摘要
- 当前 DNA 和历史版本

处理动作：

- 标记已处理
- 修改 DNA 草稿
- 发布 DNA 新版本
- 标注问题类型
- 添加审核备注
- 关联后续复查

完整简历和联系方式默认脱敏，只有具备对应权限的管理员可以查看。

### 5. 岗位运营

岗位后台第一阶段只做运营必需能力：

- 岗位列表和搜索
- 地区、方向、受众筛选
- 岗位启用/下线
- 重复岗位识别
- 岗位来源查看
- 岗位描述生成失败重试
- 岗位同步任务状态

批量下线前必须展示影响数量并二次确认。

岗位删除优先使用软删除或停用，不直接删除历史关联数据。

### 6. 用户与简历

后台默认展示用户概览，不直接开放所有敏感内容。

支持：

- 用户搜索
- 注册时间和最近活跃时间
- 简历数量
- 最近一次面试时间
- 简历解析状态
- 画像确认状态
- 账号异常标记

第一阶段不建议在后台直接修改用户简历内容。需要修改时记录原因，并保留原始版本。

### 7. 网申运营

支持：

- 投递状态统计
- 岗位投递转化率
- 字段映射命中率
- 字段映射失败列表
- 失败原因分类
- 用户/岗位维度筛选

后台不应读取用户的完整敏感申请内容，只展示完成运营诊断所需的字段摘要。

### 8. 系统配置和服务监控

公司配置和 Logo 统一放入系统配置模块，所有修改必须写审计日志。

服务状态至少包括：

- Supabase 连接
- LLM provider
- TTS provider
- ASR provider
- 对象存储
- 岗位同步服务

展示：

- 最近成功时间
- 最近失败时间
- 错误率
- 最近错误摘要
- 当前 provider

密钥永远不返回前端，也不显示完整值，只显示是否已配置和脱敏标识。

## API 规范

后台 API 建议统一使用：

~~~text
/api/admin/dashboard
/api/admin/dna
/api/admin/dna/[id]
/api/admin/dna/[id]/versions
/api/admin/dna/[id]/publish
/api/admin/dna/[id]/rollback
/api/admin/feedback
/api/admin/feedback/[id]
/api/admin/jobs
/api/admin/users
/api/admin/audit-logs
/api/admin/health
~~~

统一响应格式：

~~~json
{
  "data": {},
  "error": null,
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
~~~

错误格式：

~~~json
{
  "data": null,
  "error": {
    "code": "ADMIN_PERMISSION_DENIED",
    "message": "没有执行此操作的权限"
  }
}
~~~

所有列表接口必须支持 page、pageSize、search、sort、order 和 filters，并由服务端限制最大 pageSize。

## 数据隔离和敏感数据

管理员后台可以跨用户查看运营数据，但必须区分：

~~~text
公开运营数据：岗位、企业 DNA 摘要、聚合统计
受限运营数据：用户状态、面试反馈、面试对话
高敏感数据：邮箱、简历原文、网申字段、第三方凭据
~~~

建议权限：

- support_admin：只能看脱敏后的用户和反馈摘要。
- content_admin：可以看与 DNA 和岗位有关的面试内容。
- super_admin：可以处理权限、配置和高敏感数据。

不要在浏览器中使用 Supabase service role key。service role 只允许在服务端受控代码中使用。

## 开发阶段

### P0：安全基线和后台骨架

1. 统一后台布局、导航和错误状态。
2. 梳理现有管理员 API 的权限检查。
3. 加入后台登录限流、会话撤销和退出登录。
4. 禁止生产环境默认引导密码。
5. 建立管理员权限函数。
6. 建立审计日志表和写入工具。
7. 统一分页、筛选和响应格式。

验收标准：

- 未登录用户无法访问任何后台页面和接口。
- 没有权限的管理员无法调用对应写接口。
- 所有后台写操作都产生审计日志。
- 不会返回 service role key 或完整密钥。
- 列表接口不会返回未授权用户的数据。

### P1：企业 DNA 和反馈中心

1. 将现有 DNA 审核页升级为反馈中心。
2. 增加独立企业列表和新建 DNA 页面。
3. 增加 JSON Schema 校验。
4. 增加草稿、发布、版本历史和回滚。
5. 增加低真实度反馈分类。
6. 增加 DNA 版本和面试反馈关联。

验收标准：

- 新企业可以不依赖反馈案例直接创建 DNA。
- 自动生成版不能直接覆盖已发布人工版。
- 发布后产生新版本。
- 已进行中的面试仍使用原 DNA 快照。
- 每次发布都能追溯操作者和修改内容。

### P2：岗位、用户和网申运营

1. 岗位审核、启用、下线和同步任务。
2. 用户和简历状态概览。
3. 网申字段映射质量。
4. 批量操作和操作结果反馈。
5. 敏感数据脱敏和分级权限。

验收标准：

- 岗位停用不会破坏历史面试和投递记录。
- 用户隐私字段按权限展示。
- 批量操作可追溯、可重试、可查看失败项。

### P3：仪表盘和服务质量

1. 建立统一指标查询层。
2. 增加业务趋势图。
3. 增加 AI、TTS、ASR、岗位同步健康状态。
4. 增加异常告警。
5. 增加导出权限和导出审计。

验收标准：

- 仪表盘指标与数据库查询口径一致。
- 服务异常可以定位到 provider、接口和时间段。
- 导出敏感数据必须有权限并产生审计记录。

## 测试计划

### 权限测试

- 未登录访问页面。
- 未登录调用 API。
- 不同角色访问不同模块。
- 普通用户尝试访问后台接口。
- 修改 URL 参数读取其他用户数据。
- 修改请求体中的 user_id。
- 越权发布、回滚和修改权限。

### 数据测试

- 分页总数正确。
- 筛选条件组合正确。
- 空数据和错误状态正确。
- 大 pageSize 被限制。
- 删除或停用不破坏关联数据。
- DNA 版本发布和回滚一致。

### 审计测试

- 登录和退出有日志。
- 新建、编辑、发布、回滚有日志。
- 批量操作记录成功和失败数量。
- 审计日志不能被普通管理员删除。
- 日志中不出现密码、token、API key 和完整敏感内容。

### 安全测试

- Cookie 属性正确。
- CSRF 和 Origin 校验生效。
- 登录和写操作具有限流。
- 生产环境无默认密码。
- 服务端日志不打印密钥。
- API 错误不会暴露数据库结构和内部堆栈。

## 推荐实施顺序

~~~text
管理员认证加固
  -> 权限函数和角色模型
  -> 审计日志
  -> 后台统一布局
  -> DNA 与反馈中心
  -> 岗位运营
  -> 用户与网申运营
  -> 仪表盘和服务监控
~~~

第一版不要同时开发所有后台页面。建议先完成 P0 和 P1，因为企业 DNA、反馈审核、版本发布和审计会直接影响模拟面试质量；岗位、用户、网申和指标看板在权限骨架稳定后再扩展。
