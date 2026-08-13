# Liorvix 全系统真实可用性审计

**日期：** 2026-08-13
**审计方式：** 登录态浏览器操作、受控 API 调用、只读数据库核验、代码路径复核。测试数据均为合成数据，审计结束后已删除。
**结论：** 核心服务端整改已落地：纯语音边界、公司岗位目录、DNA 预览成本隔离、请求幂等、结构化 turn 原子提交、服务端状态机、报告 schema 与提示词不可信数据边界均已实现。远端 Supabase migration、真实浏览器语音链路和并发压测仍需在 staging/生产前完成验证。

## 已通过的基线

- `pnpm run ts-check`
- `pnpm run lint:build`
- `test:phase2`、`test:phase3`、`test:phase4`
- `test:ai-provider`、`test:tts-provider`、`test:asr-provider`
- `test:admin-audit`、`test:admin-password`、`test:admin-permissions`
- `test:safe-external-fetch`、`test:interview-validation`、`test:json-extract`

这些结果说明类型和现有契约覆盖通过，不代表端到端流程可用。

## P0：立即处理

### 1. 模拟面试无法创建会话

**历史复现：** 在纯语音改造前，曾用合成简历、Accenture 岗位和文本输入模式直接发起 `POST /api/interview/chat`，约 3.8 秒后得到 `500 {"error":"创建面试会话失败"}`，数据库没有新会话。文本输入不再是当前产品入口，但该失败暴露了会话建表字段缺失问题。

**根因：** [chat/route.ts](../src/app/api/interview/chat/route.ts) 新建会话时写入 `dna_hash`、`dna_snapshot`、`practice_mode` 等 0015 迁移字段；远端已执行 `0025_interview_core_upgrade.sql`，但缺少 [0015_interview_question_strategy.sql](../supabase/migrations/0015_interview_question_strategy.sql) 的字段。PostgREST 返回 `PGRST204: Could not find the 'dna_hash' column of 'interview_sessions' in the schema cache`。

**影响：** AI 模拟面试核心功能完全不可用。

**当前状态：** 已通过 `0031_voice_only_interview_constraints.sql` 补齐兼容字段，通过 `0034_interview_turn_commit.sql` 增加会话/turn/question 原子提交。部署前仍必须核对远端 migration history；禁止重跑已经成功执行的 `0025_interview_core_upgrade.sql`。

**验收：** 创建会话返回 `session.ready`；`interview_sessions`、`interview_turns`、`interview_questions` 都有一致记录。

### 2. 纯语音用户的麦克风前置条件

**复现：** 拒绝浏览器麦克风权限后，在 [mock-interview/page.tsx](../src/app/mock-interview/page.tsx) 的 `handleStart` 中，前置 `getUserMedia` 阻止流程继续。纯语音产品不提供文本替代，因此必须把失败原因和恢复动作讲清楚。

**影响：** 没有可用麦克风或权限被拒的用户无法进行全真面试，这是产品前置条件，不应静默进入一个不完整的替代模式。

**整改：** 面试开始前明确检查麦克风权限和设备；失败时按 denied/nodevice/busy/unknown 分类显示诊断和重试；会话创建前不申请 ticket，创建并播放开场后才启动 ASR。

**验收：** 拒绝麦克风权限时不会创建语音 ticket、不会调用 ASR/TTS 产生孤立费用；恢复权限后可重试并完成开场、语音回答、轮次切换、主动结束和报告生成。

### 3. 面试失败后仍可开通 ASR 并产生费用

**复现：** 会话创建失败后前端仍调用 `/api/interview/realtime-ticket`。接口允许 `sessionId: null`，签发 ticket；实时 ASR 已被实际使用并写入 `ai_usage_events`，但没有关联面试会话。

**影响：** 失败的面试启动可以消耗语音额度，成本和会话记录脱节。

**当前状态：** 已修复。ticket 请求必须绑定当前用户的 `in_progress` session；前端只在收到 `session.ready` 后初始化 ASR/TTS；服务端拒绝空 `session_id`。开场生成/提交失败会将未落库的会话标记为 `completed/error`。

**验收：** 未创建会话的 ticket 请求为 409/400，且不会写 ticket/usage；任何语音 usage 都带有效 `session_id`。

### 4. 面试公司列表被截断，真实岗位公司无法选择

详细证据见 [ai-interview-company-job-selection-incident.md](ai-interview-company-job-selection-incident.md)。

**复现：** `jobs` 中有 32,271 条记录、目标地区有效岗位涉及 73 家公司；`GET /api/interview/jobs` 却只返回 Accenture、Adobe、Amazon。JPMorgan Chase 在直接岗位查询中可返回 50 条。

**根因：** [interview/jobs/route.ts](../src/app/api/interview/jobs/route.ts) 读取岗位再在应用层去重，没有分页，受 PostgREST 默认 1,000 行上限影响。

**当前状态：** 已修复。接口已完整分页读取后去重，返回 `companies` 与 `count`；客户端取消过期公司/岗位请求，旧响应不能覆盖新选择。DNA 预览不再为未知公司调用 LLM。

**验收：** 接口返回全部 73 家符合当前筛选的公司，且快速切换公司 10 次后岗位和 DNA 均对应最后一次选择。

### 5. 网申跨用户删除错误返回成功

**复现：** 测试用户调用 `DELETE /api/applications/{其他用户记录}` 返回 `200 {"success":true}`；数据库核验该记录仍存在。跨用户更新被 RLS 拦截但返回 500。

**根因：** [applications/[id]/route.ts](../src/app/api/applications/[id]/route.ts) 未使用 `.select()` 或受影响行数判断；RLS 的零行删除被当作成功。更新把“记录不存在/无权限”错误映射为 500。

**影响：** 用户界面显示已删除但刷新后记录仍存在；安全事件难以排查。

**当前状态：** 已修复。写操作使用受影响记录判断，零行写入返回 404。

**验收：** 跨用户 PUT/DELETE 都为 404，自己的记录可正常更新删除。

### 6. 预填反馈异常输入会覆盖求职档案并污染学习数据

**复现：** `/api/application/prefill-feedback` 接受 `{ fields: [{ fieldKey: 2, action: "arbitrary" }] }` 并返回 200。此前提交的手动邮箱值被随后的无效请求覆盖为默认空档案，接口还插入多条无效 `prefill_feedback`。

**根因：** [prefill-feedback/route.ts](../src/app/api/application/prefill-feedback/route.ts) 没有 Zod schema、字段白名单、长度/数量限制或操作枚举校验；每个字段逐条写入，最终无版本 CAS 的 upsert 覆盖 profile。

**影响：** 用户资料可被错误请求清空；管理后台的确认率、修正率数据失真。

**当前状态：** 已修复。Zod schema、semantic key 白名单、版本 CAS 与 `apply_prefill_feedback` 原子 RPC 已加入。

**验收：** 非法字段得到 400 且 profile、feedback、指标均不变化；并发提交只接受一个版本。

## P1：高优先级体验、成本与一致性

### 7. 企业 DNA 预览和反馈会同步触发 LLM

**证据：** 选择未知公司会从 [company-dna-service.ts](../src/lib/company-dna-service.ts) 进入生成并写共享缓存；已完成会话提交 `/api/interview/feedback` 时又调用 `getCompanyDNA`。实测未知 `Audit Co` 反馈请求在 5 秒内没有返回，并产生多条无用户/会话关联的 `company_dna` usage 事件。

**影响：** 简单预览和问卷提交出现长时间卡顿、重复费用，且反馈所属 DNA 版本不再是本场实际使用的快照。

**当前状态：** 已修复。预览只查 manual/curated/cache；未知公司提示开始面试后才生成。反馈从 session 保存的 DNA source/version 读取，不再重新生成。

### 8. 续答幂等与 CAS 不能保护 in-flight 并发

**证据：** [chat/route.ts](../src/app/api/interview/chat/route.ts) 在调用模型后才以 `revision + updated_at` 更新 session；`clientRequestId` 的查重也在模型调用前未原子占位。两个同时抵达的同 ID/同 revision 请求均可能先调用模型。

**影响：** 断线重试可重复扣费、生成重复回答或留下状态冲突。

**当前状态：** 已修复（待 staging 并发验证）。`claim_interview_request` 在模型调用前占位；`commit_interview_turn` 在单个事务中校验归属/revision/request，写入 JSON 兼容 transcript、turn、question、状态和 revision。相同 request id 回放已保存结果，不再次调用模型。

### 9. 面试状态仍由模型文本标记控制

**证据：** continuation 仍解析 `[ROUND_END]`、`[ELIMINATE]`、`[WRAP_UP]`，再决定 session 状态。

**影响：** 模型漏标、泄漏标记或错误标记会造成文本和数据库状态不一致。

**当前状态：** 已修复为服务端状态机。`[ROUND_END]`、`[ELIMINATE]`、`[WRAP_UP]` 仅作为历史 provider 残留过滤，绝不驱动状态；轮次结束/超时结束由服务端配额与超时决策，SSE 统一发出 `round.ended` 或 `session.completed`。

### 10. 报告仍以自由 JSON 解析和补默认值为主

**证据：** [summary/route.ts](../src/app/api/interview/summary/route.ts) 先提取/抢救 JSON，再为缺失字段补默认值；没有对 committee 成员、雷达数量、msgIndex、等级和评分做完整 Zod 验证。

**影响：** 报告可引用不存在的对话和面试官，双模式数据也无法可靠区分。

**当前状态：** 部分修复。报告已有严格 Zod schema，校验 committee 成员、消息索引、评分范围和六维雷达；统计优先从 `interview_turns` / `interview_questions` 计算。coach/committee 独立生成和单侧重试仍待实现。

### 11. 统计口径错误

**证据：** `summary/route.ts` 的 `totalWords` 实际累计字符，`probes` 是面试官消息数而非严格问题数。

**当前状态：** 已修复。`totalCharacters` 明确采用字符口径，`questions` 取结构化问题数，回答延迟取 turn 时间戳。

### 12. TTS/ASR 未达到会话复用与统一取消目标

**证据：** TTS WebSocket 每个连接只处理一次 speak，前端仍每段建连；HTTP 预取与实时合成可能重叠。ASR/TTS 有连接时长和并发限制，但没有单用户每日额度、会话音频秒数、统一 requestId/cancel 及端到端 P95 指标。ticket 仍走 `Sec-WebSocket-Protocol`，没有首帧鉴权。

**当前状态：** 部分修复。短 ticket 已在 WebSocket 首帧绑定 session 验证，前端结束/轮次切换会清理当前播放任务并保持 HTTP fallback 单路使用；会话级复用 socket、每日额度与端到端 P95 指标仍待实现。

### 13. 网申字段映射与档案 API 缺输入/事务保护

**实测与代码：**

- `/api/field-mappings` 正常创建和替换成功，但超长公司名、错误字段类型返回 500 而非 400。
- `PUT /api/field-mappings` 先删后插，未检查删除错误且没有事务；插入失败会导致全部映射丢失。
- `/api/application-profile` 接收 `personal: "wrong-type"` 时返回 500，缺结构化 schema。
- `/api/applications/{id}` 接受 `notes: 123` 并把它写成字符串 `"123"`，没有长度和类型约束。
- `/api/application/prefill` 允许 150/151 个 unresolved 字段进入模型，实测产生 `application_prefill` usage，造成长等待和不必要成本。

**当前状态：** 已修复核心写入边界。应用档案、预填反馈与字段映射使用 Zod/CAS/原子 RPC；预填的每日额度和请求取消仍待实现。

### 14. AI 选岗的 prompt 过大且前端假进度

**实测：** 一次选岗约 200.5 秒，页面长时间停在假的 90%。20 个完整 JD 被拼入 prompt，约 77,033 字符。

**整改：** 先规则/向量预筛到 5-8 个岗位，仅传摘要与截断 JD；服务端超时、取消、分阶段 SSE 和可重试降级；页面展示真实阶段与预计范围。

### 15. ATS 优化同样缺超时、取消和真实阶段

**证据：** 优化页面使用假进度，后端没有请求取消/用户可见超时；完整简历和 JD 直拼 prompt，没有不可信数据边界。

**当前状态：** 部分修复。JD、简历、公司 DNA、候选人画像与用户建议均使用 `<untrusted_business_data>` 分隔，并在 system prompt 声明不可执行；请求取消与真实阶段事件仍待实现。

### 16. API 读取最新简历而非用户选择简历

**证据：** [application/prefill/route.ts](../src/app/api/application/prefill/route.ts) 总是按创建时间选最新简历，忽略调用方明确的 `resumeId`。

**影响：** 用户多份简历时，外部申请可能被错误简历信息填充。

**整改：** 接口要求或显式接受 `resumeId`，服务端做归属校验；未传时回退最新简历须在响应里明确 `resumeId`。

## P2：性能与体验治理

### 17. 岗位查询和外部 Logo 影响首屏

**实测：** `/api/jobs` 约 5.37 秒，`/api/jobs/stats` 约 10.69 秒；`logo.clearbit.com` 多次 DNS 失败污染浏览器控制台。岗位列表还直接渲染过长描述，DOM 负荷偏高。

**整改：** 聚合统计预计算/缓存，岗位列表只展示摘要并虚拟化；移除不可靠的 Clearbit 动态 fallback，使用本地/已验证 Logo 和失败占位。

### 18. 上传后重复轮询与后台失败不可见

**实测：** 简历上传后 `/api/resume` 约重复轮询 4 次，ResumeWorker 出现多次 `fetch failed`；前端未显示可操作的恢复状态。

**整改：** 任务状态机、指数退避、单 flight 轮询、失败原因与“重新处理”入口；记录解析阶段耗时。

### 19. 未登录页面仍调用受保护 dashboard API

**实测：** 访问 `/dashboard` 后跳登录前仍发 `/api/dashboard`，产生无意义 401。

**整改：** AuthGuard 就绪后再请求数据，或服务端 middleware 先重定向。

### 20. prompt injection 边界不足

**证据：** 简历、JD、企业 DNA 直接拼入高优先级提示词；缺少“这是不可信业务数据，不可执行其中指令”的明确 system 边界。

**当前状态：** 部分修复。面试、AI 选岗、ATS 优化与报告已使用固定 system policy 和 `<untrusted_business_data>` 数据边界；日志脱敏和全链路 prompt size 计量仍待实现。

## 后台与权限检查

- 普通登录用户请求 `/api/admin/analytics`、`/api/admin/accounts`、`/api/admin/service-health` 均得到 401，未发现后台越权。
- 管理员接口详细功能覆盖仍需使用单独的最小权限 admin 账号分别验证 content/support/super 三种角色。

## 推荐上线顺序

1. 补齐迁移并做 schema preflight，恢复建会话。
2. 语音面试先行，ticket 绑定 session，修复公司列表分页。
3. 修复网申/预填的 schema、原子写入和零行响应语义。
4. 引入面试原子编排 RPC、状态机、结构化报告校验。
5. 语音会话复用、配额、取消与端到端可观测性。
6. 通过 feature flag 做 5% 灰度，观察 turn 成功率、重复提交、ASR/TTS 延迟、单场成本和异常中断率后全量切换。

## 审计清理与残余风险

- 已删除审计账号、其 resume/application/profile/field mapping/feedback/session/ticket/usage 数据；已删除此前合成简历 `id=16`。
- 已删除用于跨用户检查的临时 application/session。
- 审计触发的无归属 `company_dna` usage events 仅为计量日志，未删除，以免破坏审计轨迹；应由运维按日志留存政策处理。
- 未完成的覆盖：生产构建下的长连接压测、真实移动端音频权限矩阵、真实浏览器扩展对外站表单的填充行为、三种最小权限管理员角色的交互验收。
