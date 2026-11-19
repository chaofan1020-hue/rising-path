# 下一代自动网申方案（Liorvix Auto Apply v2）

> 目标：把一次网申从「15 分钟、30+ 次点击」压到「30 秒、3 次点击」，并且**越用越快**。
> 本文档是设计与落地计划；配套代码已实现第一层（见第 9 节）。

---

## 1. 结论先行

1. 现在的扩展不是「自动化」，而是「人工逐字段确认的半自动填表器」：一次网申仍有 3 个必点节点 + 1 个必人工节点，多步表单每页都要重来一遍。
2. 加字段、加 AI 提示解决不了问题——瓶颈是**三个结构性缺陷**：词表 26 条正则、控件只支持原生 input/select、完全不支持 iframe/shadow DOM/多步向导。
3. 正确解法是**把「站点长什么样」「这个框问什么」「我该怎么答」拆成三层**，各自独立演进：配方层（服务端热更新）、语义层（零 AI）、答案层（一次答、处处用）。编排层再解决批量与自动翻页。

---

## 2. 现状诊断（代码级证据）

| # | 问题 | 证据 | 用户感知 |
|---|---|---|---|
| 1 | 词表只有 26 条英文正则，顺序敏感、无负向规则 | `extension/content.js:22-56` | "Company name" 被判成全名；中文表单全部失效 |
| 2 | label 提取只认 `labels[0] / aria-label / placeholder / name / id` | `content.js:13-20` | Greenhouse/Lever 的自定义问题（label 在兄弟 div）识别不到 |
| 3 | 服务端只直连 18 个 key | `src/app/api/application/prefill/route.ts:54-148` | 教育 5 个字段（学校/学位/专业/GPA/毕业时间）永远手打 |
| 4 | 教育/经历在 profile 里只是 `{raw: "一段文本"}` | `src/lib/application-profile.ts:78-87, 270-271` | 无法拆成 5 个独立 input |
| 5 | radio / date / multi-select **假成功**（返回 filled:true 但页面没变） | `content.js:141-151` | 以为填好了，提交时才发现必填是空的 |
| 6 | 自定义下拉（react-select / MUI / Workday combobox）完全不可填 | 全文无 option 容器交互 | 现代 ATS 主力控件直接用不了 |
| 7 | iframe / shadow DOM 不支持（无 `all_frames`） | `manifest.json:12-18`、`content.js:60` | Workday / Taleo / iCIMS 扫不到任何字段 |
| 8 | 无多步向导能力：每页都要手动开 popup 点扫描 | `content.js` 无 MutationObserver / 路由监听 | Workday 6 步 = 6 轮重复操作 |
| 9 | **一个 select 匹配失败 → 整次填写回滚**，且学习数据一条不落 | `extension/background.js:133-137` | 填了 30 个字段全部白干 |
| 10 | AI 字段默认不勾选、无"全选" | `popup.js:41-43` | 20 字段里 12 个要手动点 |
| 11 | 忽略学习按语义键全局生效，无 domain 维度 | `prefill/route.ts:232-240` | A 站忽略 state，B 站也不填，且无法撤销 |
| 12 | 用户答过的开放题永不复用（未知语义键静默 no-op） | `application-profile.ts:428-466` | "Why this company?" 每次重打 |
| 13 | 文件上传必须手选 | `prefill/route.ts:212-221`、`content.js:147-149` | 每次投递都要重新上传简历 |
| 14 | 每次扫描扣 8 积分且无幂等键 | `prefill/route.ts:283-289`、`0064:87` | 改一个字段再扫一次 = 再扣 8 积分 |
| 15 | token 1 小时过期后静默 401，SW 休眠后结果丢失 | `content.js:238-254`、`background.js:19-25` | 反复重扫 |
| 16 | `application_fields` / `field_mappings` / `form_templates` / `prefill-metrics` 四条链路**没有消费方** | `src/app/field-mappings/page.tsx:174-177` 已重定向 | 规划时误以为"字段映射学习已有" |

**值得保留的资产**（不要重写）：`ApplicationProfile` 结构、`buildProfileFromResume()` 确定性推导、`apply_prefill_feedback` 原子 RPC + 版本 CAS、`application_profile_jobs` 队列 worker 范式、限流与积分、后台质量看板口径、"只填不提交"的安全边界、`setNativeValue` 的 React 受控组件绕过写法。

---

## 3. 为什么"再堆功能"没用

现有实现把三件事缠在一起：**认出控件**（DOM 层）、**理解问题**（语义层）、**给出答案**（业务层）。
任何一个层面出问题，整条链路就退化成人工。于是每次改版都要改同一个 200 行文件，且无法验证"到底准不准"。

下一代方案把这层拆开，每层有自己的产物、自己的测试、自己的迭代节奏。

---

## 4. 四层架构

```
┌──────────────────────────────────────────────────────────────┐
│ L4 编排层  Apply Queue / Autopilot                           │
│  投递清单 · 标签页巡航 · 多步翻页 · 提交凭证识别 · 失败重排      │
├──────────────────────────────────────────────────────────────┤
│ L3 答案层  Answer Bank                                        │
│  一次作答 · 跨站复用 · 选项映射 · 日期/布尔格式适配 · 站点覆盖    │
├──────────────────────────────────────────────────────────────┤
│ L2 语义层  Canonical Taxonomy (88 题)                          │
│  配方直连 → 精确 → 短语 → 属性 → 词元；带歧义检测与判定理由       │
├──────────────────────────────────────────────────────────────┤
│ L1 配方层  ATS Recipes (Workday/Greenhouse/iCIMS/…)            │
│  站点识别 · 表单根 · 多步定义 · 重复区块 · 上传控件 · 提交按钮     │
└──────────────────────────────────────────────────────────────┘
        ↑ 全部可服务端下发 / 可灰度 / 可回滚，不必重发扩展
```

### L1 配方层：把「站点知识」从扩展里搬出来

现在站点知识硬编码在 `content.js`。改为服务端下发的声明式 JSON：

```json
{
  "id": "workday",
  "version": 4,
  "match": { "hostPatterns": ["myworkdayjobs\\.com$"], "domSelectors": ["[data-automation-id=\"applicationForm\"]"] },
  "form": { "root": "[data-automation-id=\"applicationForm\"]", "multiStep": true },
  "fields": [
    { "selector": "input[data-automation-id=\"legalNameSection_firstName\"]", "canonicalKey": "first_name" }
  ],
  "steps": [
    { "name": "my-information", "detect": ["[data-automation-id=\"contactInformationSection\"]"],
      "next": ["[data-automation-id=\"bottom-navigation-next-button\"]"] }
  ],
  "uploads": [{ "selector": "[data-automation-id=\"file-upload-drop-zone\"] input[type=file]", "kind": "resume" }]
}
```

价值：
- 站点改版 → 服务端当天修配方，**不用重发扩展、不用过 Chrome 审核**；
- 命中配方后字段置信度 0.99，**完全不走 AI**，速度和成本都降一个数量级；
- `status: draft|stable|degraded` + `version` 支持灰度与回滚；
- 失败时扩展上报现场（DOM 摘要 + 失败的 selector），后台聚类 → 自动生成配方修复任务。

### L2 语义层：88 个标准问题（已实现）

`src/lib/apply/taxonomy.ts` 定义了覆盖真实网申的 88 个 canonical key，分 14 组：身份、联系、地址、链接、工作授权、教育、经历、技能、筛选题、可用性、薪资、EEO、开放题、授权签名。

每个问题带：中英双语标签、归一化别名短语、排除词（防"Emergency Contact First Name"误填）、标准选项与各 ATS 选项同义词、是否高敏（必须逐次人工确认）。

识别器 `src/lib/apply/resolver.ts` 五级打分：配方 0.99 → 精确 0.97 → 短语 0.86+长度加成 → 属性(name/id) 0.78 → 词元重合 0.45；叠加控件类型、选项列表重合、section 上下文加成与排除词惩罚；**每一项都产出 reasons，可回放归因**。

这套词表的意义：**同一个问题在不同站点上被问 30 次，用户只需要回答 1 次**。

### L3 答案层：一次作答，处处复用

`src/lib/apply/answers.ts` 解决三件事：

1. **选项落地**：语义值 `decline` → Greenhouse 的 "Decline to Self Identify" / Workday 的 "I don't wish to answer"；`yes` → "Yes"/"是"/"Y"。
2. **格式适配**：日期 ISO ↔ `<input type=date>`（yyyy-mm-dd）↔ 文本（MM/YYYY）；电话去非数字；数字去单位。
3. **从档案推导**：答案库没有时，从简历档案计算——学位（"Master of Science" → `master`）、是否需要 Sponsor（F-1 OPT → `yes`）、是否国际学生、学校/专业/公司/职位、技能拼接。

落库设计（新增表，迁移见第 7 节）：

| 字段 | 说明 |
|---|---|
| `(user_id, canonical_key)` 唯一 | 一个问题一份标准答案 |
| `value` / `raw_value` | 语义值 / 用户原文 |
| `source` | user / profile / ai |
| `confidence` + 时间衰减 | 沿用现有 `decayedConfidence` 规则 |
| `domain_override` | 同一问题在某个站点上的特殊答案 |
| `usage_count` / `last_used_at` | 用于排序与"最常用答案"推荐 |

**学习闭环**：用户改一个值 → 只更新答案库那一条（不是整份 profile）→ 下次同类问题直接命中。开放题（Why this company?）第一次答完就永久可复用，且可按岗位生成变体。

### L4 编排层：从"填一页"到"投一批"

- **投递清单**：从 AI 选岗结果 / 收藏夹一键生成 10–30 个岗位的清单；
- **巡航**：逐个打开标签 → 识别配方 → 扫描 → 解析答案 → 填写 → 自动"下一步" → 到提交页 **停下等人工确认**；
- **提交凭证识别**：监听 URL 跳转 / 成功页文案 / 确认号 → 自动把 applications 状态从 `filling` 推到 `submitted`，并抓提交时间与该次填写快照；
- **失败重排**：失败任务记录原因（配方未命中 / 选项缺失 / 需要人工），进入待办卡片而不是静默失败；
- **批量队列**：复用 `application_profile_jobs` 的 claim/retry/stale 回收骨架，新增 `apply_tasks`。

---

## 5. 五个"质变"技术点

| 技术点 | 做法 | 为什么是质变 |
|---|---|---|
| **CDP 文件上传** | `chrome.debugger` + `DOM.setFileInputFiles`，把简历 PDF 直接塞进 `input[type=file]` | 目前"文件必须手选"是最大断点；做到后一次投递从 4 步降到 1 步 |
| **iframe / shadow DOM 穿透** | `all_frames: true` + 递归 open shadowRoot + 按 frameId 回填 | Workday/Taleo/iCIMS 从"不支持"变成"可用" |
| **自定义下拉真实交互** | 不 set value，而是 click 触发 → 等待 listbox → 键盘/点击选中 → 校验回读 | 现代 ATS 主力控件从"填不了"变成"填得准" |
| **多步向导状态机** | MutationObserver + 步骤定义 + 网络空闲判定 + 断点续跑 | Workday 6 步从 6 轮人工变成 1 次授权 |
| **失败现场回传自愈** | 失败时上报 DOM 摘要与 selector，后台聚类生成配方补丁 | 站点改版从"用户报障 + 等发版"变成"当天修好" |

另外两个工程必改：
- **幂等键**：同一表单重复扫描不重复扣积分（`idempotencyKey = hash(host + formFingerprint + profileVersion)`）；
- **逐字段报告代替全或无**：部分失败也落定成功的字段，并保留学习数据。

---

## 6. 三种产品形态（对用户可见）

| 模式 | 交互 | 适用 | 风险 |
|---|---|---|---|
| **秒填**（默认） | 打开官网 → 侧边栏自动识别并填写 → 用户检查 → **自己点提交** | 全部用户，全部站点 | 无 |
| **巡航**（主力） | 选 10 个岗位 → 一键 → 自动翻页填到提交页 → 用户逐个点提交 | Workday 类多步表单 | 低 |
| **全自动**（付费档） | 白名单站点 + 显式授权 + 限速 → 自动提交并回填状态 | Greenhouse/Lever/Ashby 等单页表单 | 中（账号风控 / ToS） |

**非扩展兜底**（对不能/不愿装扩展的用户）：
1. 本地 Agent：项目已有 `playwright-core` + 持久化 profile 的采集脚本范式（`scripts/capture-linkedin-browser-jobs.ts`），可复用为「本地投递 Agent」，能上传文件、能处理 iframe、能夜间批量；
2. 复制档案：现有 `auto-apply-assistant.tsx` 的降级路径保留并升级为「结构化粘贴」。

---

## 7. 数据模型（新增，迁移未执行）

```sql
-- 答案库：一个问题一份标准答案
create table public.application_answers (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_key text not null,
  value text not null,
  raw_value text,
  source text not null default 'user',      -- user / profile / ai
  confidence numeric not null default 1.0,
  domain_override text,
  usage_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, canonical_key, domain_override)
);

-- 批量投递任务
create table public.apply_tasks (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id integer references public.jobs(id) on delete set null,
  resume_id integer references public.resumes(id) on delete set null,
  application_id bigint references public.applications(id) on delete set null,
  mode text not null default 'quickfill',   -- quickfill / cruise / auto
  status text not null default 'pending',   -- pending/running/needs_review/submitted/failed/skipped
  ats_type text,
  domain text,
  step_index integer not null default 0,
  attempts integer not null default 0,
  last_error text,
  snapshot jsonb not null default '{}'::jsonb,  -- 本次填写快照
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- 站点配方（平台级 + 用户级覆盖）
create table public.ats_recipes (
  id bigserial primary key,
  ats_type text not null,
  version integer not null default 1,
  status text not null default 'draft',
  recipe jsonb not null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (ats_type, version, user_id)
);

-- 每次解析的可观测记录（用于配方命中率与 badcase 归因）
create table public.apply_resolution_events (
  id bigserial primary key,
  user_id uuid,
  domain text,
  ats_type text,
  field_count integer,
  resolved_count integer,
  recipe_hit_count integer,
  ai_count integer,
  duration_ms integer,
  unresolved_sample jsonb,
  created_at timestamptz not null default now()
);
```

同时要清理的死资产：`application_fields`（无写入）、`field_mappings` + `/api/field-mappings`（无消费方）、`/api/application/prefill-metrics`、`content.js:96-102 findField()`。

---

## 8. 接口契约

```
POST /api/apply/resolve            扫描结果 → 解析结果（配方 + 语义 + 答案）
  req  { url, host, pageText?, resumeId?, jobId?, fields: ScannedField[] }
  resp { recipe, fields:[{fieldKey, canonicalKey, value, source, confidence, needsReview}],
         unresolved:[...], stats, version }
  说明：默认零 AI；只有 unresolved 且 allowAi 时才走模型，并带答案库命中作为少样本。

GET  /api/apply/recipes?host=...    下发站点配方（可带 ETag 缓存）

POST /api/apply/feedback            用户确认/修改 → 写答案库 + 学习（沿用原子 RPC 范式）
  req  { version, domain, updates:[{canonicalKey, suggestedValue, finalValue, action}] }

POST /api/apply/queue               批量投递：入队 / 领取 / 回写状态
GET  /api/apply/queue               投递清单与进度

POST /api/apply/recipe-failure     上报配方失效现场 → 后台聚类
```

---

## 9. 已落地（本次提交）

| 文件 | 内容 | 状态 |
|---|---|---|
| `src/lib/apply/taxonomy.ts` | 88 题标准词库 + 归一化 + 选项同义词 | ✅ |
| `src/lib/apply/resolver.ts` | 五级打分识别器 + 歧义检测 + 摘要统计 | ✅ |
| `src/lib/apply/answers.ts` | 答案库映射、格式适配、档案推导、写回 | ✅ |
| `src/lib/apply/recipes.ts` | 8 个 ATS 配方 + 兜底 + 站点匹配打分 | ✅ 选择器待真实页面 dry-run 校验 |
| `scripts/test-apply-engine.ts` | 82 项断言（标签/属性/陷阱/选项/日期/推导/端到端/配方） | ✅ 全绿 |

---

## 10. 路线图

| 阶段 | 内容 | 工期 | 验收指标 |
|---|---|---|---|
| **P0 打地基** | 配方层 + 语义层 + 答案层接线到现有 prefill（新增 `/api/apply/resolve`）；逐字段报告替代全或无；幂等键；token 刷新与 SW 状态持久化 | 2 周 | 字段识别率 ≥ 85%；单页填写零 AI 调用 ≥ 60%；积分消耗下降 ≥ 50% |
| **P1 真能用** | 侧边栏、shadow DOM/iframe、自定义下拉、radio/date 正确写入、CDP 文件上传、多步自动翻页 | 4 周 | 单次网申点击 ≤ 5；Workday 类 6 步表单可一次跑完；上传自动化率 ≥ 90% |
| **P2 投一批** | 投递清单 + 队列 + 提交凭证识别 + 失败重排 + 结果看板 | 4 周 | 10 个岗位批量投递 ≤ 10 分钟；状态自动回填率 ≥ 80% |
| **P3 护城河** | 跨站学习（domain 维度）、配方自愈闭环、定向简历/cover letter 入队、本地 Agent、转化率反哺选岗 | 6 周 | 第三次投递的字段修改率 < 5%；配方失效率 < 2% |

---

## 11. 合规红线

1. **默认不代提交**：只填、只翻页，最终提交永远由用户点；
2. **全自动需显式授权**：按站点逐个开关、可随时撤销、有限速与每日上限；
3. **不代登录、不存密码**：只使用用户浏览器里已有的会话；
4. **明确禁止自动化的站点**（如 LinkedIn）走"结构化复制"路径，不做 DOM 注入提交；
5. **数据最小化**：字段值本地优先，服务端只存解析结果与用户确认过的答案；
6. **可解释**：每次填写都能回放"为什么填这个值"（reasons + 来源 + 置信度）。

---

## 12. 需要拍板的一件事

**默认「只填不提交」，还是做「全自动提交」？**

我的建议：默认只填不提交 + 巡航自动翻页；全自动作为付费档、站点白名单、用户逐站授权。理由是 Workday 类站点对异常账号的风险控制最严，一旦账号被锁，用户损失远大于省下的几次点击。
