# 阶段二开发计划：简历上传与求职画像

## 1. 文档目的

阶段二的目标不是再增加一个简历展示卡片，而是建立一个可靠的“简历 -> 结构化画像 -> 用户确认 -> 后续功能使用”的基础闭环。

本阶段先解决数据可信度、处理状态、用户确认和版本追溯，再接入岗位匹配、简历评分和简历优化。没有确认的画像只能作为草稿，不能作为后续 AI 功能的最终输入。

本文件是阶段二的执行基线。后续每一项实现都要对应这里的任务编号和验收条件。

## 2. 当前实现审计结论

### 2.1 已经具备的能力

- `src/app/resume/page.tsx` 已提供 PDF、DOCX、TXT 上传、简历列表、删除、重新解析、翻译和分层卡片入口。
- `src/app/api/resume/route.ts` 已按当前认证用户写入 `resumes`，上传后启动后台解析。
- `src/lib/resume-parser.ts` 已支持 PDF 文本层、DOCX 和 TXT 的文本提取，并调用 LLM 提取基础信息和 `ResumeProfile`。
- `src/lib/user-segmentation.ts` 已实现求职阶段、院校层级、专业匹配、地区和经历质量推导。
- `src/components/segmentation-card.tsx` 已支持展示分层理由、手动覆盖和确认。
- `resumes` 已有 `profile`、`segmentation`、`segmentation_overrides` 和 `segmentation_confirmed` JSON/布尔字段。
- `0002_remove_access_codes_add_auth.sql` 已建立 `user_id` 和基于 `auth.uid()` 的 RLS 基础。

### 2.2 P0 问题：必须在阶段二解决

| 编号 | 问题 | 证据位置 | 风险 |
|---|---|---|---|
| P0-1 | 没有真实的处理状态机。上传后只写入 `正在解析简历内容...`，后台结束后再覆盖文本；数据库无法区分上传、文本解析、画像提取、分层、完成和失败。 | `src/app/api/resume/route.ts` | 前端无法可靠判断是否完成，失败会被伪装成普通文本结果。 |
| P0-2 | 前端上传进度是每 200ms 增加 10 的模拟进度，上传请求结束即显示 100%，解析却可能还在运行。 | `src/app/resume/page.tsx` | 用户会认为系统已完成，随后看到空白或旧数据。 |
| P0-3 | 上传后固定等待 3 秒刷新，不符合实际解析耗时，也不能在刷新后继续恢复处理状态。 | `src/app/resume/page.tsx` | 慢请求、LLM 超时和刷新场景下状态不一致。 |
| P0-4 | `parseResumeFile` 同一次流程内先调用基础字段解析，再调用完整画像解析；另外还有 `extract-fields` 接口和页面手动提取按钮，形成两条结果来源。 | `src/lib/resume-parser.ts`, `src/app/api/resume/extract-fields/route.ts` | `parsed_fields` 与 `profile` 可能不一致，重复消耗 AI，用户不知道该相信哪一个。 |
| P0-5 | 重新解析直接覆盖 `profile` 和 `segmentation`，没有使旧确认失效，也没有保存旧版本。 | `src/app/api/resume/reparse/route.ts` | 后续评分或优化无法知道使用的是哪一份画像，用户手动修正可能被覆盖。 |
| P0-6 | 当前 PATCH 接口只处理少数分层覆盖字段，并且只要提交 overrides 就把 `segmentation_confirmed` 设为 true。 | `src/app/api/resume/[id]/route.ts` | 用户可能没有看过完整画像就被标记为已确认。 |
| P0-7 | 页面类型仍保留旧的 `ParsedFields`，`profile` 只声明教育和技能，实际后端画像还包含实习、全职、项目、证书、语言、意向和 meta。 | `src/app/resume/page.tsx` | 类型不能保护真实数据，前端后续扩展容易出现运行时字段错误。 |
| P0-8 | 页面只要存在一份简历就显示 AI Match 和 Optimize 入口，未要求解析成功或画像确认。 | `src/app/resume/page.tsx` | 后续功能可能使用半成品画像，用户会看到没有依据的结果。 |
| P0-9 | 画像字段没有证据片段、提取/推断来源和置信度。 | `src/lib/resume-parser.ts` | 用户无法判断 AI 是从原文读到的，还是自行推断的。 |
| P0-10 | 空文本、扫描型 PDF、无效 JSON、LLM 超时和画像失败没有独立的可恢复错误状态。 | `src/lib/resume-parser.ts`, `src/app/api/resume/route.ts` | 用户不知道下一步是重新上传、重新解析还是修改简历。 |
| P0-11 | 上传接口把原始文件 Base64 放在 `user_info` JSONB 中；GET 虽然会脱敏，但数据库仍会膨胀且不适合生产存储。 | `src/app/api/resume/route.ts`, `src/lib/resume-parser.ts` | 隐私、数据库体积、备份和大文件处理风险。 |
| P0-12 | 后续 AI 接口读取 `resumes` 后没有统一的“画像已确认”服务端门禁。 | `src/app/api/ai/match/route.ts`, `src/app/api/ai/optimize/route.ts` | 仅靠前端隐藏按钮不能阻止直接调用 API。 |

### 2.3 P1 问题：阶段二 MVP 后处理

- 求职画像目前主要是分层结果，不是完整的用户策略画像；缺少工作权限/签证、入职时间、薪资期望、目标职位优先级和优势短板。
- 当前意向只在简历明确写出时提取，没有“用户补充意向”的表单设计。
- 画像字段没有修改前后对比和修改来源。
- 没有统一的共享类型文件，页面和接口各自声明简历结构。
- 解析任务没有任务 ID、重试次数和操作审计。
- 尚未建立真实简历样本集、字段准确率和解析成功率基线。

### 2.4 需要明确保留的现有能力

阶段二不删除以下已有能力，但会统一它们使用的画像来源：

- `user-segmentation.ts` 的分层规则和地区推导。
- `SegmentationCard` 的透明展示和手动纠偏能力。
- 用户认证、`user_id` 过滤和 Supabase RLS。
- 简历删除、重新解析、翻译和简历列表。

## 3. 阶段二目标状态

用户体验目标：

```text
进入简历页
  -> 上传文件
  -> 显示真实处理阶段
  -> 展示解析结果和证据
  -> 用户补充/修改求职意向
  -> 用户确认求职画像
  -> 画像状态变为 ready
  -> 解锁岗位匹配、评分和优化入口
```

系统数据流：

```text
原始文件
  -> 文件校验
  -> 对象存储
  -> 文本提取
  -> 结构化 ResumeProfile
  -> Evidence/Confidence
  -> UserSegmentation
  -> 待确认版本
  -> 用户确认/覆盖
  -> ResumeProfileVersion 快照
  -> 后续 API 使用已确认版本
```

### 3.1 成功定义

阶段二完成时必须满足：

1. 用户可以知道简历当前处于哪个处理阶段，刷新页面后状态不丢失。
2. 解析失败不会生成可被后续功能使用的半成品画像，并提供重试入口。
3. `profile`、`segmentation`、证据和置信度来自同一个解析版本。
4. 用户可以查看和修改关键画像字段，保存后必须再次确认。
5. 重新解析会创建新的草稿版本，并使旧版本不再作为当前版本，旧确认记录仍可追溯。
6. 未确认画像不能通过页面或直接 API 调用进入最终匹配、评分、优化和面试流程。
7. 其他用户不能读取、修改或删除当前用户的简历及画像数据。

## 4. 推荐的数据设计

### 4.1 采用“当前快照 + 历史版本”

第一版不把每个字段拆成独立表。继续使用 `resumes` 保存当前结果，同时增加 `resume_profile_versions` 保存每次解析和确认的不可变快照。这样可以兼容现有代码，又能让后续评分、优化和面试绑定明确版本。

### 4.2 `resumes` 增加的字段

建议新增迁移文件，例如 `supabase/migrations/0005_resume_processing_and_profile_versions.sql`：

| 字段 | 类型 | 用途 |
|---|---|---|
| `processing_status` | text | `uploaded`、`extracting_text`、`extracting_profile`、`deriving_segmentation`、`needs_confirmation`、`ready`、`failed` |
| `processing_stage` | text | 当前可读阶段名称，供前端展示 |
| `processing_error` | text | 用户可理解的失败原因，不存敏感堆栈 |
| `processing_attempts` | integer | 重试次数，默认 0 |
| `processing_started_at` | timestamptz | 本次处理开始时间 |
| `processing_finished_at` | timestamptz | 成功或失败结束时间 |
| `profile_version` | integer | 当前画像版本号，默认 0 |
| `profile_confirmed_at` | timestamptz | 用户确认时间 |
| `profile_confirmed_by` | uuid | 当前确认用户，引用 `auth.users` |
| `profile_evidence` | jsonb | 画像字段的证据片段 |
| `profile_confidence` | jsonb | 字段级和整体置信度 |

迁移要求：

- 老数据默认 `processing_status = 'needs_confirmation'`，仅当已有有效 `profile` 和 `segmentation` 时如此；没有画像的老数据标记为 `failed` 或 `uploaded`，由迁移后的修复任务重新处理。
- 新增枚举值用 CHECK 约束或服务端白名单校验，避免拼写不同造成前端永远等待。
- `profile_confirmed_by` 必须与 `user_id` 一致；服务端不接受客户端传入的用户 ID。
- 对 `user_id`、`processing_status`、`profile_version` 建索引。

### 4.3 `resume_profile_versions` 建议结构

```text
id                 bigint primary key
resume_id          bigint not null references resumes(id) on delete cascade
user_id            uuid not null references auth.users(id) on delete cascade
version            integer not null
source             text not null              -- initial_parse / reparse / user_edit
profile            jsonb not null
segmentation       jsonb not null
overrides          jsonb not null default '{}'
evidence           jsonb not null default '{}'
confidence         jsonb not null default '{}'
status             text not null               -- draft / confirmed / superseded
confirmed_at       timestamptz
confirmed_by       uuid references auth.users(id)
created_at         timestamptz not null default now()
unique (resume_id, version)
```

RLS：用户只能读写自己 `user_id = auth.uid()` 的版本记录；管理员读取必须走现有服务端管理员鉴权，不向浏览器暴露服务密钥。

### 4.4 统一的 `ResumeProfile` 数据契约

把当前 `user-segmentation.ts` 中的 `ResumeProfile` 作为基础类型，抽到共享类型文件或由该文件统一导出。阶段二新增字段时，保持字段语义稳定：

```text
education[]
internships[]
workExperience[]
projects[]
skills[]
certificates[]
languages[]
intention.roles[]
intention.locations[]
intention.industries[]
intention.workAuthorization
intention.availableFrom
intention.salaryExpectation
meta.pages
meta.resumeLanguage
```

每个新增字段必须区分：

- `explicit`：简历或用户明确填写。
- `inferred`：由规则或 AI 推断。
- `unknown`：没有足够信息。

AI 不得为了填满字段而编造内容。

## 5. 统一处理状态机

### 5.1 状态定义

```text
uploaded
  -> extracting_text
  -> extracting_profile
  -> deriving_segmentation
  -> needs_confirmation
  -> ready
```

任何处理阶段都可以进入：

```text
failed
  -> extracting_text       # 用户点击重试
```

用户编辑已确认画像时：

```text
ready -> needs_confirmation -> ready
```

用户重新解析时：

```text
ready / needs_confirmation -> extracting_text
```

重新解析过程中保留旧的 `resume_profile_versions` 记录，但旧版本标记为 `superseded` 或继续作为历史版本；解析完成后新结果必须是新版本草稿。

### 5.2 状态转移规则

- 只有服务端处理器可以把状态推进到下一阶段。
- 客户端只能发起上传、重试、重新解析和确认动作。
- 处理失败必须写入 `processing_error`，同时将状态设为 `failed`。
- `needs_confirmation` 表示画像有结果但尚未被用户确认，不能当作 `ready`。
- `ready` 必须同时满足：有效 `profile`、有效 `segmentation`、存在当前版本、确认时间和确认用户。
- 所有状态更新要带 `resume_id + user_id` 条件，避免后台任务误更新其他用户记录。

## 6. 接口调整计划

### 6.1 `POST /api/resume`

保留现有上传入口，但返回真正的处理记录：

```json
{
  "resume": {
    "id": 123,
    "processing_status": "uploaded",
    "processing_stage": "queued",
    "profile_version": 0
  }
}
```

要求：

- 服务端校验文件名、扩展名、MIME、大小和空文件。
- 生产环境将文件写入 S3 兼容存储，`file_key` 只保存对象键；不再把 Base64 作为长期数据库字段。
- 创建记录后立即设置处理状态，再启动后台任务。
- 后台任务必须有明确的每阶段状态更新和失败捕获。

### 6.2 `GET /api/resume`

返回前端需要的状态和画像摘要，不返回原始文件 Base64。建议只返回脱敏后的 `user_info`、`profile`、`segmentation`、证据、置信度和处理时间。

### 6.3 `POST /api/resume/reparse`

统一为唯一的重新解析入口：

- 读取 `file_key` 对应的原始文件。
- 创建新的处理批次或递增版本。
- 解析开始时清除旧草稿状态，但不删除历史确认版本。
- 完成后写入新的 `profile`、`segmentation`、evidence 和 confidence。
- 重新解析成功后必须将 `segmentation_confirmed = false`，状态为 `needs_confirmation`。

### 6.4 `POST /api/resume/retry`

失败状态使用单独重试动作，或者由 `reparse` 兼容处理。不能让前端通过修改数据库状态来重试。

### 6.5 `PATCH /api/resume/[id]`

统一处理画像修改和确认。建议请求结构：

```json
{
  "profile": {
    "intention": {
      "roles": ["Product Manager"],
      "locations": ["Singapore"]
    }
  },
  "segmentationOverrides": {
    "careerStage": "senior",
    "regions": ["sg"]
  },
  "confirm": true
}
```

要求：

- 所有字段使用 Zod 或等效运行时 schema 校验。
- `confirm: true` 时必须校验最低完整度，例如教育或经历至少有一项、地区或岗位至少有一项。
- 用户修改任何画像字段后，若没有同时确认，状态保持 `needs_confirmation`。
- 保存时生成新版本快照，保存修改来源为 `user_edit`。
- 返回当前生效画像、版本和状态。

### 6.6 删除 `extract-fields` 的重复职责

阶段二完成后，页面不再提供“提取结构化字段”按钮。旧接口暂时保留兼容，但必须：

- 标记为 deprecated。
- 不再写入独立的 `parsed_fields` 结果，或迁移为调用统一处理流水线。
- 禁止它产生与 `profile` 不一致的第二份权威数据。

## 7. 前端流程设计

### 7.1 首次入驻流程

登录后若当前用户没有 `ready` 简历，进入简历工作台并突出下一步：

1. 上传简历。
2. 等待解析状态完成。
3. 查看完整画像。
4. 补充缺失求职意向。
5. 确认画像。
6. 看到三个可执行入口：找岗位、优化简历、练习面试。

### 7.2 处理进度展示

进度条只表示阶段进度，不伪造网络百分比。页面显示：

- 当前阶段名称。
- 当前阶段说明。
- 最近更新时间。
- 失败原因。
- 重试按钮。

客户端在 `uploaded` 到 `needs_confirmation`/`failed` 之间每 2 秒轮询 `GET /api/resume`，页面卸载时清理定时器，刷新后根据数据库状态恢复。

### 7.3 画像确认页

不继续把所有内容塞进现有分层卡片。建议拆成三个清晰区域：

```text
事实信息：教育、经历、项目、技能、语言
求职意向：岗位、行业、地区、入职时间、工作权限
系统判断：求职阶段、院校层级、专业匹配、优势短板、地区策略
```

每个系统判断展示：

- 结果。
- 一句话原因。
- 证据片段。
- 来源标签（简历原文 / AI 推断 / 用户修改）。
- 置信度。
- 编辑入口。

### 7.4 后续入口门禁

前端只在 `processing_status === 'ready'` 时展示最终匹配、评分和优化按钮；其他状态展示当前需要完成的动作。

同时后端必须复核：

- AI Match：要求用户拥有该简历且状态为 `ready`。
- AI Optimize：要求用户拥有该简历且状态为 `ready`，目标岗位不能为空。
- Mock Interview：要求使用的简历存在有效确认版本；历史会话可以读取当时绑定的版本。

## 8. 分步开发进程

### Step 0：基线和样本准备

目标：先建立可以重复验证的基础。

任务：

- 确认 `pnpm run ts-check`、`pnpm run lint:build` 和 `pnpm run build` 的当前结果并记录。
- 准备至少 6 份脱敏样本：英文 PDF、有文本的中文 PDF、DOCX、TXT、扫描型 PDF、字段不完整简历。
- 记录每份样本的预期教育、经历、语言、地区和目标岗位字段。
- 确认 `.env` 不进入 Git，确认临时目录 `.next-r3f-check/` 不参与改动。

验收：基线命令结果已记录，样本能被本地测试重复使用。

### Step 1：统一类型和解析契约

目标：消除页面、解析器和接口之间的结构漂移。

任务：

- 建立共享 resume types，统一 `ResumeProfile`、`UserSegmentation`、`ResumeProcessingStatus`、evidence 和 confidence 类型。
- 让 `resume-parser.ts` 的规范化函数只输出共享类型。
- 统一空值、日期、月份、数组和枚举的处理。
- 给 LLM JSON 解析增加字段白名单、默认值和非法结构错误。

验收：类型检查通过；同一份 profile 在 API、页面和分层引擎中使用同一份类型；无效 JSON 不会被当作成功结果写入。

### Step 2：数据库迁移和版本快照

目标：让状态、确认和历史可追溯。

任务：

- 添加处理状态、错误、时间、版本、证据和置信度字段。
- 创建 `resume_profile_versions` 表、索引和 RLS。
- 为老数据设置兼容默认值并写迁移说明。
- 设计版本唯一约束和状态转移约束。

验收：迁移可重复执行；新用户和老用户查询都不报错；用户 A 无法读写用户 B 的 resume 或 version；删除简历会级联清理版本快照。

### Step 3：统一后端解析流水线

目标：上传、重新解析和失败重试只走一套流程。

任务：

- 将后台任务拆成文本提取、画像提取、分层推导和保存快照四个步骤。
- 每个步骤更新数据库状态。
- 保证异常统一落到 `failed`，写入用户可理解的错误。
- 处理空文本和扫描 PDF，给出“无法读取文本层”的明确提示。
- 移除或降级 `extract-fields` 重复写入逻辑。
- 评估并接入 S3 文件存储，兼容历史 Base64 数据的过渡读取。

验收：上传、刷新、关闭浏览器后重新打开，都能看到正确状态；正常、失败、超时、重试四条路径可重复通过；同一任务不会并发覆盖新结果。

### Step 4：前端状态机和首次入驻体验

目标：让用户始终知道现在发生了什么。

任务：

- 删除模拟进度和固定 3 秒刷新。
- 增加轮询和状态展示组件。
- 按状态展示上传、处理中、待确认、完成和失败界面。
- 页面刷新后恢复当前简历和任务状态。
- 失败时提供重试；成功时自动进入画像确认区域。

验收：慢解析期间不显示假完成；移动端和桌面端无重叠；网络断开后恢复请求不会重复创建简历；用户不会被带到没有画像的后续页面。

### Step 5：完整画像确认和证据展示

目标：让用户能理解并修正系统判断。

任务：

- 扩展现有 `SegmentationCard` 或拆出画像确认组件。
- 展示教育、经历、项目、技能、语言、意向和系统分层。
- 展示证据、来源和置信度。
- 增加目标职位、地区、行业、工作权限和入职时间的补充表单。
- 保存用户修改，修改后状态回到 `needs_confirmation`。
- 确认后生成版本快照和确认时间。

验收：用户可以修改至少一个事实字段和一个分层字段；修改前后值可在版本记录中追溯；未确认状态不能解锁后续 AI 功能；确认后状态为 `ready`。

### Step 6：后端门禁和下游接入

目标：保证“画像确认后才能使用”不是只靠 UI。

任务：

- 抽取 `requireConfirmedResume` 服务端帮助函数。
- 接入 AI Match、AI Optimize 和模拟面试入口。
- 将 `resume_id + profile_version` 写入后续结果快照或会话。
- 旧版本画像只读，不被新操作静默复用。

验收：直接调用后续 API 使用未确认简历返回明确 409/400；已确认简历正常工作；重新解析后旧简历被锁回待确认；历史结果仍能显示使用的版本。

### Step 7：测试、性能和文档收尾

目标：把阶段二变成可以交接和回归的能力。

任务：

- 为解析规范化、分层推导、状态转移和权限增加单元测试。
- 为上传、轮询、失败重试、确认和门禁增加 API 集成测试。
- 用 Playwright 走桌面和手机两种主要流程。
- 记录解析成功率、平均耗时、失败原因和重复任务数量。
- 更新 README、开发路线和排障文档。

验收：`pnpm run validate` 通过；6 份脱敏简历样本均有结果记录；主要用户流程无控制台错误；阶段二验收清单全部勾选。

## 9. 测试与验收矩阵

| 场景 | 预期结果 |
|---|---|
| 未登录上传 | 返回 401，不创建简历记录 |
| 空文件 | 返回 400，显示文件为空 |
| 不支持格式 | 返回 400，不触发 AI |
| 正常 PDF/DOCX/TXT | 状态依次推进，最终进入待确认 |
| 扫描型 PDF | 进入 failed，提示无法读取文本并给出重试/重新上传 |
| LLM 返回非法 JSON | 进入 failed，不写入伪造 profile |
| 处理期间刷新页面 | 恢复数据库中的当前状态，不重复创建任务 |
| 处理失败重试 | 递增 attempts，成功后生成新草稿版本 |
| 修改画像未确认 | 保存修改，状态为 needs_confirmation |
| 用户确认画像 | 生成 confirmed 版本，状态为 ready |
| 重新解析已确认简历 | 旧版本保留，新结果待确认，旧确认不继续生效 |
| 直接调用未确认简历做匹配 | 服务端拒绝，返回明确错误 |
| 用户 A 访问用户 B 的简历 ID | 返回 404 或 RLS 空结果，不泄露记录存在性 |
| 删除简历 | 简历、画像版本和受保护关联按规则删除 |
| 手机端流程 | 上传、查看画像、编辑、确认均不横向溢出、不遮挡 |

## 10. 每个开发小步的固定交付格式

每次实现一个 Step 时，必须同时交付：

1. 改动文件和数据库迁移名称。
2. 本次新增或改变的接口契约。
3. 成功、失败、未登录和越权测试结果。
4. `pnpm run ts-check`、相关 lint/build 结果。
5. 浏览器验证结果和仍存在的风险。
6. 是否可以进入下一个 Step。

一次提交只对应一个明确 Step，避免把数据库、后台解析和视觉调整混在同一提交中。

## 11. 阶段二范围边界

本阶段要完成：

- 稳定上传和解析状态。
- 统一画像结构。
- 证据和置信度。
- 用户画像确认和版本快照。
- 下游 AI 功能门禁。
- 用户隔离和失败重试。

本阶段暂不深入：

- 多份简历之间的智能合并。
- 自动生成完整的新简历排版模板。
- 自动替用户提交外部网申。
- 复杂的管理员画像审核工作台。
- 根据真实投递结果自动训练模型。
- 为了解决业务状态而继续增加 3D 动画。

## 12. 建议推进顺序和完成条件

建议按以下顺序逐步执行：

```text
Step 0 基线
  -> Step 1 类型契约
  -> Step 2 数据库版本
  -> Step 3 后端流水线
  -> Step 4 前端状态机
  -> Step 5 画像确认
  -> Step 6 下游门禁
  -> Step 7 测试和文档
```

在 Step 2 的迁移和数据契约确认之前，不开始大规模改页面；在 Step 3 后端状态可查询之前，不删除前端旧按钮；在 Step 5 画像确认完成之前，不把新的评分结果当作阶段二完成标志。

阶段二的最终完成定义是：一个新用户从上传一份真实简历开始，能够在页面看到可恢复的处理状态，查看有证据的求职画像，修改并确认画像，然后使用同一版本画像进入下一项求职行动；全流程在桌面端和手机端都能重复通过，且无越权和半成品数据泄漏。

## 13. 当前决策

- 现在不直接修改业务代码，先以本计划作为执行依据。
- 第一轮实现优先解决数据状态和解析一致性，不优先做视觉扩展。
- 使用现有 Supabase + RLS，不引入 Docker 或新的数据库服务。
- 采用“`resumes` 当前快照 + `resume_profile_versions` 历史快照”的版本方案。
- 旧 `parsed_fields` 仅作兼容字段，不再作为后续功能的权威画像来源。

## 14. 执行进度（当前批次）

- Step 0 已完成：`pnpm run ts-check`、源码目录 ESLint、`git diff --check` 和生产构建均通过；全量 `lint:build` 仍会扫描已有 `.next-codex-test/` 与 `.next-r3f-check/` 生成文件，因此不能作为源码质量结论。
- Step 1 已完成：新增 `src/lib/resume-types.ts`，解析器、分层引擎、分层卡片和简历页已使用统一类型。
- Step 2 已完成：新增并应用 `supabase/migrations/0005_resume_processing_and_profile_versions.sql`。远程数据库已验证阶段二字段、`resume_profile_versions` 表和用户级 RLS 策略。
- Step 2 补强：新增 `supabase/migrations/0008_resume_confirmation_owner_checks.sql`，在数据库层约束简历确认人和版本确认人必须等于所属用户；当前工作机没有 `psql` 或 Supabase CLI，因此该迁移文件已准备但尚未宣称远程应用，需在 Supabase SQL Editor 或部署迁移流水线执行后再勾选数据库验收。
- Step 3 已完成：上传和重新解析使用统一处理器，处理状态、失败原因、画像证据、置信度和版本草稿会写入数据库；旧 `extract-fields` 接口已降级为只读兼容接口。新增 `0006_private_resume_storage.sql` 和 `src/lib/resume-storage.ts`，原始简历改存 Supabase 私有桶 `risingpath-resumes`，数据库只保存 `file_key`；历史 Base64 记录在首次重新解析时懒迁移并清理旧字段，删除简历时会清理对象。
- Step 4 已完成第一版：简历页移除模拟进度和固定 3 秒刷新，改为按数据库状态轮询，并提供失败重试入口。
- Step 5 已完成第一版：简历详情展示统一画像、置信度和证据；用户编辑画像会创建 `source = user_edit` 的新版本，旧版本保留并标记为 `superseded`；只有明确提交 `confirm: true` 才切换到 `ready`；用户可以编辑岗位、地区、行业、工作权限和入职时间，保存后重新推导分层。
- Step 6 已完成第一版：AI Match 和 Optimize 服务端增加已确认画像门禁。
- Step 6 已推进：AI Match、Optimize 和模拟面试服务端增加已确认画像门禁；新面试会话保存 `resume_id + resume_profile_version`，继续面试读取创建时的版本快照，避免重新解析后静默换标尺。新增 `0007_interview_resume_profile_snapshot.sql`。
- Step 7 已推进：画像服务的超时、无效 JSON、空画像会落到可读的 `processing_error`，前端已展示并提供重试；私有存储桶已在当前 Supabase 创建并验证上传/下载/删除，`0006` 迁移已实际应用并验证 4 条对象级 RLS 策略。Playwright CLI 已可在当前 Windows 环境运行，`/login` 已完成无控制台错误回归；当前仍缺真实 AI 成功响应下的 `needs_confirmation -> ready` 浏览器回归。
- Step 7 当前收尾：画像解析启动前会校验 `COZE_WORKLOAD_IDENTITY_API_KEY` 和 `COZE_INTEGRATION_MODEL_BASE_URL`，缺失配置会立即失败并写入可读错误；画像请求使用 `RESUME_PROFILE_LLM_TIMEOUT_MS`（默认 45 秒）、关闭思考链且不自动重试，避免配置错误导致长时间等待；新增 `pnpm run test:phase2`，已覆盖分层推导、AI 配置快速失败和确认门禁。下一步是补真实 Coze 配置后的成功路径回归，并记录最终验收结果。
