# Liorvix（Rising Path）代码审查与修复跟踪

审查日期：2026-08-11  
审查提交：`4c7b134 merge: integrate dev into main`  
审查范围：Next.js App Router、API 路由、Supabase 数据访问、AI/实时能力、迁移文件、关键用户流程。

## 使用说明

- 优先级：P0 表示可能造成直接安全或部署事故；P1 表示会影响核心功能、数据一致性或资源安全；P2 表示长期维护和体验风险；P3 表示工程质量风险。
- 状态：`未处理`、`部分修复`、`已修复（待外部验证）`、`待外部验证`。
- 本文只记录代码仓库内能确认的事实。真实 Supabase 迁移历史、生产密钥、AI 供应商配额和浏览器实时音频仍需在目标环境验证。

## 修复进度

| 优先级 | 问题 | 状态 | 本轮验证 |
| --- | --- | --- | --- |
| P0 | 管理员默认密码与 SHA-256 固定 salt | 已修复（待外部验证） | `test:admin-password`、`ts-check`、`lint:build` 通过 |
| P0 | Supabase migration 编号重复 | 已修复（待外部验证） | 文件名前缀已连续且唯一为 `0001`–`0016` |
| P1 | 未认证 URL 抓取可形成 SSRF | 已修复（待外部验证） | `test:safe-external-fetch`、`ts-check`、`lint:build` 通过 |
| P1 | 上传接口缺少统一大小和类型限制 | 已修复（待外部验证） | 阶段 2 回归、`ts-check`、`lint:build` 通过 |
| P1 | 简历异步处理失败不可见且存在并发竞态 | 部分修复 | 条件抢占、重试互斥和文件校验已通过类型检查；队列持久化待做 |
| P1 | AI Provider 链路分裂 | 未处理 | 需在真实配置下验证 |
| P1 | 面试消息、实时音频和 AI 接口的并发/额度控制不足 | 部分修复 | 纯语音 schema、session ticket、request claim、revision、原子 turn commit、SSE event id 已加入；会话级复用和每日额度待做 |
| P1 | 网申及配置接口的数据隔离边界不完整 | 已修复（待外部验证） | `ts-check`、`lint:build` 通过；待真实 RLS 验证 |
| P1 | Dashboard/analytics 全量或截断统计 | 已修复（待外部验证） | 管理员 analytics 已迁移到受限数据库聚合；`0022` 和 staging 性能验证待完成 |
| P2 | AI 匹配、岗位列表、网申预填和 JSON 解析的长期一致性问题 | 部分修复 | AI 匹配幂等、最新简历预填选择、JSON 提取和岗位分页已加入；网申预填版本绑定待做 |
| P2 | 批量写入、IP 获取、公司名校验和文档品牌漂移 | 部分修复 | 字段映射/预填反馈/面试 turn 已原子化；可信代理 IP 待做 |
| P3 | 关闭 `reactStrictMode` 掩盖副作用 | 未处理 | 需在开发环境开启并清理副作用 |

## P0 问题

### P0-1 管理员密码使用公开默认值和弱哈希

- 位置：`src/lib/admin-auth.ts`、`src/app/api/admin/password/route.ts`
- 问题：旧实现包含固定默认密码 `risingpath2024`，没有数据库密码时任何部署都可使用该密码登录；密码哈希是 SHA-256 加固定 salt，不适合密码存储，且逻辑在两个文件中重复。
- 影响：管理员后台可能被未授权访问；哈希泄露后容易离线破解；两处逻辑可能继续漂移。
- 修复方向：统一使用 Node 内置异步 `scrypt`，每个密码使用随机 salt；删除默认密码回退；没有持久化密码时只接受部署者显式配置的 `ADMIN_BOOTSTRAP_PASSWORD`，首次成功登录后通过修改密码写入数据库；成功验证旧 SHA-256 哈希后自动升级。
- 状态：`已修复（待外部验证）`
- 验证方式：运行 `pnpm run test:admin-password`、`pnpm run ts-check`、`pnpm run lint:build`；在测试环境完成一次引导密码初始化和一次旧哈希升级。
- 剩余风险：仓库无法验证生产环境变量、现有管理员哈希和真实 Supabase 权限；远端若没有 `ADMIN_BOOTSTRAP_PASSWORD` 且数据库无密码，需要先配置环境变量。

### P0-2 migration 文件编号重复

- 位置：`supabase/migrations/0005_*`、`0006_*`、`0007_*`，以及其后的 `0008_*` 至 `0012_*`
- 问题：多个迁移共享同一数字前缀，CLI 或部署脚本可能无法建立稳定的执行顺序，甚至跳过、覆盖或拒绝迁移。
- 影响：新环境建库失败；不同环境的 schema 漂移；后续迁移依赖的列、表或约束可能不存在。
- 修复方向：按依赖关系整理为唯一递增编号：应用档案 `0005`，简历处理 `0006`，申请状态 `0007`，私有简历存储 `0008`，网申填充状态 `0009`，面试简历画像快照 `0010`，原 `0008` 至 `0012` 顺延为 `0011` 至 `0015`。
- 状态：`已修复（待外部验证）`
- 验证方式：检查迁移文件名唯一、按序执行；在临时 Supabase 数据库运行 `supabase db reset` 或等效迁移命令。
- 剩余风险：如果这些迁移已经在共享/生产项目执行过，不能只改文件名；需要先核对远端 migration history，再决定采用重命名、基线迁移或追加修复迁移。

## P1 问题

### P1-1 未认证 URL 抓取存在 SSRF 风险

- 位置：`src/app/api/fetch-url/route.ts`
- 问题：外部输入 URL 曾由服务端直接请求，未认证且对协议、私网地址、重定向和响应大小的限制不足。
- 影响：攻击者可探测内网服务、访问云 metadata 或消耗服务端连接和内存。
- 修复：接口现在只允许管理员会话访问；只接受 HTTPS、无凭据、443 端口；DNS 解析后拒绝 loopback、私网、link-local、保留/文档/多播 IPv4 和 IPv6 地址；将解析结果固定到 HTTPS 连接；每次重定向都会重新验证，最多 3 次；超时为 10 秒，响应上限为 1MB，且只接受文本/JSON/XML 内容。
- 状态：`已修复（待外部验证）`
- 验证方式：`pnpm run test:safe-external-fetch` 已覆盖 localhost、私网、metadata 地址和 IPv6 地址分类；仍需在 staging 覆盖公开 HTTPS、重定向到私网、超大响应和 DNS 重绑定场景。

### P1-2 上传接口缺少统一的大小、类型和资源限制

- 位置：`src/app/api/upload/route.ts`、`src/app/api/resume/route.ts`
- 问题：上传链路曾存在未认证或限制不足的入口，简历文件可能在进入解析器前就占用大量内存或存储。
- 影响：资源耗尽、恶意文件进入解析链路、存储成本持续增长。
- 修复：后台表格上传现在要求管理员会话，限制为 5MB、10,000 行数据和 100 列；简历上传限制为 10MB，收紧 MIME/扩展名匹配，并在写入对象存储前检查 PDF、DOCX/TXT 的基础文件签名。
- 状态：`已修复（待外部验证）`
- 验证方式：阶段 2 回归、`ts-check`、`lint:build` 已通过；仍需补充未认证、伪造 MIME、超大文件、损坏 ZIP/PDF 和对象存储配额的 HTTP 集成测试。

### P1-3 简历异步处理的失败可见性、并发和版本一致性不足

- 位置：`src/app/api/resume/route.ts`、`src/lib/*resume*`、`supabase/migrations/0006_resume_processing_and_profile_versions.sql`
- 问题：上传后使用 `void processResume`，请求与后台任务生命周期脱钩；画像版本更新和分层推导不是完整事务；翻译更新失败可能仍返回成功。
- 影响：用户看到“上传成功”但长期停留在处理中；重复任务覆盖新画像；画像、分层和版本号相互不一致。
- 修复：处理开始前使用 `processing_status` 条件更新抢占任务；重复任务不会再次解析或覆盖版本；自定义 server 增加 15 秒轮询的 uploaded 简历兜底 worker，进程重启后可从私有存储恢复任务；reparse 也复用 10MB、MIME/文件签名校验；翻译 JSON 和数据库更新失败会明确返回错误。
- 状态：`部分修复`
- 验证方式：类型检查、lint、阶段 2 回归已通过；仍需把 `processResume` 从 fire-and-forget 改为持久化任务表/worker，并用事务或数据库函数保证画像版本与主表写入原子性。

### P1-4 AI Provider 选择分裂（已处理）

- 位置：AI 匹配、简历优化、网申预填相关 API 与 `docs/ai-provider-architecture.md`
- 问题：历史版本中部分文本链路走 Alibaba，网申预填走另一套 Provider，配置、错误语义和超时策略不完全一致。
- 影响：同一用户在不同功能得到不同能力、延迟、JSON 可靠性和额度行为；切换供应商时容易漏改。
- 修复方向：建立统一 Provider 接口、模型配置、超时/重试/结构化输出契约和可观测字段；功能只依赖抽象接口。
- 状态：`已修复`
- 验证方式：模拟成功、超时、限流、无效 JSON、Provider 不可用和 fallback。

### P1-5 面试输入、AI 接口和实时音频缺少完整的并发、额度和生命周期控制

- 位置：`src/app/api/interview/chat/route.ts`、ASR/TTS WebSocket、AI API 路由
- 问题：面试输入缺少严格长度和枚举校验；AI 接口缺少用户级限流；实时连接缺少连接时长、并发和额度限制；Bearer token 放在 WebSocket subprotocol 中。
- 影响：单个用户或恶意客户端可放大 LLM、ASR、TTS 成本；长连接泄漏资源；token 可能出现在代理或日志中。
- 修复：面试 chat 使用严格纯语音 Zod schema，限制回答/JD/公司名/轮次数并加入用户级限流；`clientRequestId + revision` 先通过 `claim_interview_request` 原子占位，`commit_interview_turn` 在单个事务内写兼容消息、turn、question、状态、revision 和 claim 清理。ASR/TTS 使用短期 session ticket 并在 WebSocket 首帧校验 session；TTS WebSocket 支持会话复用的 `speak/cancel + requestId`。
- 状态：`部分修复`
- 验证方式：`test:interview-validation`、类型检查和 lint 已通过；仍需在 staging 验证 migration、并发续答回放、过期 ticket、浏览器实时 ASR/TTS 与连接压测。

### P1-6 网申创建和配置读取的隔离边界不完整

- 位置：`src/app/api/applications/route.ts`、`src/app/api/configs/route.ts`
- 问题：网申创建曾未验证传入的 `resume_id` 属于当前用户；`/api/configs?type=xxx` 曾允许非管理员绕过公共类型白名单。
- 影响：可能关联他人简历；可读取不应公开的非密码配置。
- 修复：创建网申时先按当前用户验证 `resume_id`，并校验岗位 ID、备注长度和时间格式；非管理员无论是否携带 `type`，都只能读取 `region`、`direction`、`audience`、`job_type` 四类配置。
- 状态：`已修复（待外部验证）`
- 验证方式：`ts-check`、`lint:build` 已通过；仍需使用两个真实用户验证跨用户 resume/application/config 请求均被拒绝。

### P1-7 Dashboard 和 analytics 统计不准确或不可扩展

- 位置：Dashboard 统计页面、analytics API
- 问题：简历总数统计使用了错误的来源；其他统计存在 200/50 条上限；analytics 全量拉取多张表并在 Node.js 中聚合。
- 影响：用户看到错误数量；数据量增长后响应变慢、内存升高，甚至超时。
- 修复：Dashboard 的简历、面试、网申总数改为 Supabase exact count；本周投递只拉取本周明细，避免 200 条截断导致周统计错误。管理员后台进一步新增 `0022_admin_analytics_aggregates.sql` 和 `/api/admin/analytics`，将聚合下沉到 PostgreSQL，并只返回固定大小 JSON：总量/区间新增量、有效岗位分布、区间网申状态、7 日 UTC 趋势和前 10 活跃学生。旧 `/api/analytics` 已退役，不再把全表加载到 Node.js；简历学校/学历等半结构化画像图已移除，待画像字段规范化后以独立聚合重新引入。
- 状态：`已修复（待外部验证）`
- 验证方式：类型检查、lint、构建和 staging 数据库函数调用；需用超过原截断阈值的数据验证结果、执行计划和响应时间。

## P2 问题

### P2-1 AI 匹配记录重复插入

- 位置：`src/app/api/ai/match/route.ts`
- 问题：同一用户、简历、岗位和画像版本的重复请求可能重复写入 `ai_matches`。
- 影响：历史记录膨胀、列表重复、统计失真。
- 修复：新增 `0016_ai_match_idempotency.sql`，清理已有同版本重复项并建立唯一索引；API 改为按 `user_id + resume_id + job_id + resume_profile_version` upsert。
- 状态：`已修复（待外部验证）`
- 验证方式：类型检查、lint 和阶段 3 合同测试通过；需在 staging 执行迁移并并发请求同一岗位验证唯一键。

### P2-2 岗位列表缺少数据库分页和完整筛选下推

- 位置：`src/app/api/jobs/route.ts`、岗位页面
- 问题：岗位列表可能全量读取，部分筛选在应用层执行。
- 影响：岗位量增长后首屏和数据库连接占用恶化。
- 修复：岗位接口已使用 offset 分页，搜索、状态、地区、方向和受众筛选下推数据库；管理员岗位列表使用服务端分页并返回 exact count。
- 状态：`已修复（待外部验证）`
- 验证方式：`pnpm run ts-check`、`pnpm run lint:build`、`pnpm run build`；staging 需用超过一页的岗位数据验证筛选、排序、总数和索引表现。
- 剩余风险：岗位页面仍使用 offset，数据频繁插入时跨页可能出现轻微漂移；超大规模数据再升级 cursor 分页。

### P2-2a 管理员后台读取接口复用普通用户 API

- 位置：`src/app/admin/page.tsx`、`src/app/api/admin/resumes/route.ts`、`src/app/api/admin/applications/route.ts`、`src/app/api/admin/configs/route.ts`
- 问题：后台曾直接读取 `/api/resume`、`/api/applications`、`/api/configs`；这些接口混合用户权限、管理员权限和业务返回字段，且列表没有后台专用分页与汇总口径。
- 修复：新增管理员专用 GET 接口，统一管理员会话校验，限制返回字段，支持搜索、状态筛选、服务端分页、exact count 和状态汇总；后台前端已迁移读取链路。
- 状态：`已修复（待外部验证）`
- 验证方式：顺序运行 `pnpm exec next typegen`、`pnpm run ts-check`、`pnpm run lint:build`、`pnpm run build`；staging 验证未授权 401、跨用户数据不泄露、分页总数和关联岗位摘要。
- 剩余风险：管理员仍使用共享会话密码，角色权限矩阵和敏感内容二次授权尚未完成；`0021_admin_audit_logs.sql` 必须在目标 Supabase 执行后审计写入才生效。

### P2-3 网申预填长期读取旧 `application_profiles`

- 位置：网申预填 API、`application_profiles` 迁移与简历画像链路
- 问题：用户修改或确认新画像后，旧档案可能继续用于预填。
- 影响：表单长期填入过期学校、经历、联系方式或求职意向。
- 修复：预填只有在 `application_profiles.resume_id` 对应当前最新简历时才读取；更换简历后会从最新简历画像即时重建，避免继续使用旧档案。
- 状态：`部分修复`
- 剩余风险：数据库仍未保存 `resume_profile_version`，用户在同一份简历上修改画像后仍需后续版本绑定和确认同步。

### P2-4 AI 结构化输出契约未真正下发，JSON 解析存在贪婪正则

- 位置：AI Provider 调用和各 AI API 的 JSON 解析逻辑
- 问题：调用方声明了 schema，但未始终以 provider 支持的结构化格式下发；部分接口用贪婪正则从文本中截取 JSON。
- 影响：模型输出包含额外文本、嵌套对象或多个 JSON 时解析失败，用户只得到笼统错误。
- 修复：新增字符串/转义感知的括号扫描 JSON 提取器，已替换简历解析、翻译、企业 DNA 和网申预填链路；翻译解析或保存失败不再伪装成功。
- 状态：`部分修复`
- 验证方式：`test:json-extract` 已通过；仍需把所有 Provider 的结构化 response schema 做成统一契约，并覆盖截断 JSON。

### P2-5 TTS 重复预取和中断清理不完整

- 位置：TTS HTTP/WebSocket 客户端与面试页面
- 问题：同一语音可能同时走 HTTP 预取和实时 WebSocket；打断、切换轮次或卸载时清理不完整。
- 影响：重复计费、音频重叠、连接泄漏和移动端资源占用。
- 修复：实时 TTS 改为每场会话复用 WebSocket，连续 `speak/cancel` 由 `requestId` 分隔；HTTP MP3 仅在实时连接或合成失败后调用，不再预取；中断、结束、重开与卸载会取消当前 request、停止 PCM source、关闭 socket 和释放 AudioContext。
- 状态：`已修复（待浏览器验证）`

### P2-6 批量删除和字段映射更新不是事务

- 位置：网申、字段映射 API
- 问题：多步删除或更新中途失败会留下半完成状态。
- 影响：用户看到孤立记录或自动填表使用旧映射。
- 修复：`replace_field_mappings`、`apply_prefill_feedback` 与 `commit_interview_turn` 均在数据库事务内提交，避免删后插、资料更新或结构化面试投影留下半完成状态。
- 状态：`已修复（待外部验证）`

### P2-7 公司名校验错误使用岗位标题规则

- 位置：企业 DNA API/服务
- 问题：公司名复用了岗位标题的最少 5 字符校验，`IBM` 等合法公司名会被拒绝。
- 影响：企业 DNA 无法创建或查询，核心面试流程被非业务规则阻断。
- 修复：企业 DNA API 公司名限制为 1–255 字符，审查备注限制 5,000 字，并按用户增加查询限流；`IBM` 等短公司名不再被最少 5 字符规则拒绝。
- 状态：`部分修复`
- 验证方式：类型检查和 lint 已通过；服务内部仍会对别名做应用层全表扫描，需后续用索引/规范化字段替换。

### P2-8 `getClientIp` 信任客户端转发头

- 位置：`src/lib/auth-server.ts`、认证和限流 API
- 问题：直接信任客户端提供的 `x-forwarded-for` 时，攻击者可轮换伪造 IP 绕过限流。
- 影响：登录、OTP、管理员登录等保护被削弱。
- 修复方向：只信任明确配置的反向代理；按可信代理链解析最后一个可信地址，否则使用连接对端地址，并补充 IPv4/IPv6 规范化。
- 状态：`未处理`

### P2-9 文档、品牌和 Provider 信息漂移（已处理）

- 位置：README、设计文档、Provider 文档和界面文案
- 问题：Liorvix、Rising Path、Alibaba 等名称在不同文档和链路中混用。
- 影响：部署、排障和用户沟通容易误导，团队无法确认真实依赖。
- 修复方向：确定产品名、服务边界和 Provider 责任，统一 README、环境变量、日志和 UI 文案。
- 状态：`已修复`

## P3 问题

### P3-1 关闭 React Strict Mode

- 位置：`next.config.ts`
- 问题：`reactStrictMode` 被关闭，会隐藏 effect 重复执行、未清理订阅和资源泄漏。
- 影响：开发环境无法尽早发现长期运行后才出现的体验问题。
- 修复方向：开启 Strict Mode；逐个修复重复请求、WebSocket、AudioContext 和动画资源的清理问题。
- 状态：`未处理`

## 验证记录

- 历史验证：`test:phase2`、`test:phase3`、`test:phase4`、`test:ai-provider`、`test:tts-provider`、`test:asr-provider`、`build` 曾在审查提交上通过。
- `pnpm run ts-check`：本轮通过。
- `pnpm run test:admin-password`：本轮通过，覆盖新 scrypt 哈希、错误密码、无效哈希和旧 SHA-256 哈希识别。
- `pnpm run ts-check`：本轮通过。
- `pnpm run lint:build`：本轮通过。
- `pnpm run test:safe-external-fetch`：本轮通过，覆盖内网、metadata 和 IPv6 地址拒绝规则。
- `pnpm run test:phase2`：本轮通过。
- `pnpm run test:interview-validation`：本轮通过。
- `pnpm run test:json-extract`：本轮通过。
- `pnpm run validate`：本轮通过。
- `pnpm run build`：本轮通过，Next.js 页面/API 构建和自定义 server 打包均成功。
- migration 文件名：本轮检查通过，前缀连续且唯一为 `0001` 至 `0015`；未执行真实数据库迁移。
- `pnpm run validate`：最近一次重跑超过 120 秒，无明确编译错误输出，不能视为通过。本轮已分别通过其中的 `ts-check` 和 `lint:build`。

## 本轮已完成的部署动作

1. 为首次管理员初始化配置一个至少 12 位、仅部署环境持有的 `ADMIN_BOOTSTRAP_PASSWORD`，并确保 `ADMIN_SESSION_SECRET` 是独立的高熵随机值。
2. 用引导密码登录一次管理后台，进入“修改密码”设置正式密码；数据库保存成功后移除 `ADMIN_BOOTSTRAP_PASSWORD` 并重启服务。
3. 在共享/生产 Supabase 项目操作前，导出并核对 migration history。若旧的重复编号已经执行，请不要直接将改名后的文件应用到该环境；应先生成已执行版本的基线/修复方案并在 staging 验证。
