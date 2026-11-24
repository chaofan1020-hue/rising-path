# 简历优化页「获取岗位描述」模块 改造计划

> 状态：已实施（P0 + P1 + P2 主体完成，见第九节实施记录）
> 范围：`src/app/optimize/page.tsx`（设置卡片）+ `/api/jobs/search-jd`（缺失）
> 日期：2026-11-24

---

## 一、现状诊断

### P0 · 功能缺陷：这个按钮 100% 失败，已经坏了 3 个多月

**结论：前后端脱节。前端在调的接口，后端在 2026-08-13 就被删了。**

证据链：

| 步骤 | 证据 |
|---|---|
| 1 | `src/app/optimize/page.tsx:907` 调用 `POST /api/jobs/search-jd` |
| 2 | `src/app/api/jobs/` 下**没有** `search-jd` 路由（13 个同级路由里没有它） |
| 3 | `git log --diff-filter=D` → 提交 `56ea31b`（2026-08-13，"feat: upgrade AI interview and platform operations"）删除了 `src/app/api/jobs/search-jd/route.ts`，但没清理前端调用 |
| 4 | 线上实测：`POST https://liorvix.com/api/jobs/search-jd` → `http=405`，**响应体为空** |
| 5 | `page.tsx:916` `await response.json()` 解析空 body → 抛 `SyntaxError` → 落进 `catch` |
| 6 | `page.tsx:927` `alert(t('optimize.alertJdRetry'))` = `"获取岗位描述失败，请稍后重试"` |

第 6 步产出的字符串，和截图中的弹窗**完全一致**。所以截图里那个报错不是偶发网络问题，是**必然失败**。

被删的旧实现（`git show 56ea31b^:.../search-jd/route.ts`，219 行）依赖 `coze-coding-dev-sdk` 的 `SearchClient` 做联网搜索。该 SDK 已从依赖中移除，所以当时是"整块能力下线"，但前端按钮留在了页面上。

**影响面**：所有在优化页点过那个靶心图标的用户，都只看到一个"确定"弹窗，功能等于没有。而且这个按钮还占着「目标公司」输入框右侧的位置，让用户以为"填了公司就能自动找 JD"。

### P0 附带缺陷（同一个函数内）

1. **不判 HTTP 状态**：`page.tsx:918` 只看 `data.success`，不看 `response.ok`。后端若返回 `500 {error}`，会走 `alert` 而不是精确提示；返回非 JSON 则直接崩进 `catch`。
2. **7 处 `alert()`**：原生弹窗阻塞页面、无样式、无语境、移动端丑陋，且无法重试。
3. **死状态 `jdResults`**：`page.tsx:895` 声明、`920` 赋值、`1781` 清空，**从未渲染**。

### P1 · 设计问题：信息架构冗余

当前"优化设置"卡片里平铺了 6 个区块，用户要填的东西被拆成两条互相打架的路径：

```
┌ 选择目标岗位 ────────────────────────────────┐
│  我的收藏 chips（最多 6 个）                  │  ┐
│  已添加岗位 chips（最多 6 个）                │  ├─ 路径 A：点 chip → 自动填 company/position/region/jobId
│  [⌕ 搜索岗位或公司…] + 下拉结果               │  ┘
├ 3 列栅格 ───────────────────────────────────┤
│  [选择简历 ▾]  │ [目标公司____] [◎]  │        │  ┐
│                │ [目标岗位_______]   │ (空)   │  ├─ 路径 B：手打 company/position
├ 操作行 ─────────────────────────────────────┤  ┘
│  [目标地区 ▾]   [✨ 开始优化]   [清除JD]      │
├ 手动输入 JD ────────────────────────────────┤
│  [textarea：粘贴 JD]                        │
├ JD 已设置卡片（条件渲染）───────────────────┤
│  ◎ 已设置岗位描述                            │  ← 把 textarea 里同样的内容再显示一遍
│  {jdContent 前 32 行}                        │
└─────────────────────────────────────────────┘
```

问题清单：

| # | 问题 | 说明 |
|---|---|---|
| 1 | **岗位录入双通道** | 上面「选择目标岗位」和下面「目标公司 / 目标岗位」输入框写同一组状态。`selectTargetJob()` 写 `setTargetCompany`，输入框 `onChange` 也写 `setTargetCompany`，还各自 `setTargetJobId(null)`，互相覆盖 |
| 2 | **JD 双重展示** | `textarea`（1804 行）已经显示 `jdContent`，紧接着 `jdContent &&` 卡片（1813 行）**又显示一遍同样的内容**。纯冗余 |
| 3 | **图标按钮语义错位** | 靶心按钮用的是 `company + position` **两个**字段，却只挂在「公司」输入框右边，且只有 `title` tooltip，无文字。用户看不出它是"联网找 JD" |
| 4 | **栅格错位** | `md:grid-cols-3` 里「简历」占 1 列，「公司」「岗位」各 `col-span-2` → 岗位那行右侧空一列；「地区」被踢到第三行，和岗位字段视觉上断开 |
| 5 | **必填/可选无分层** | 简历、岗位是必填，公司、地区是可选/派生，JD 是可选。6 个控件平铺，视觉权重一样 |
| 6 | **无空状态** | 没选岗位时没有任何引导，只有一个搜索框杵在那儿 |
| 7 | **失败即阻塞** | 一个可选步骤失败（JD 抓不到），却用模态弹窗打断整个流程 |

### P1 · 视觉问题

- 卡片内混用 3 种间距（`space-y-3 md:space-y-4`、`mt-3 md:mt-4`、`mb-1.5 md:mb-2`），行距不齐
- 4 处 `rounded-xl` + 1 处 `rounded-2xl` + 多处 `border-zinc-200`，同类容器圆角不一致
- 靶心图标用了 `Target`，同时卡片标题也用 `Target`，同一个图标表两个意思
- 「开始优化」按钮跟「清除JD」并排，次要操作抢主操作视觉位

---

## 二、改造目标

1. **修掉功能缺陷**：手动模式下"补全 JD"变成真的能用；不再返回 405。
2. **消除冗余**：岗位只有一条录入路径；JD 只在一个地方展示。
3. **重建层级**：必填 → 可选，主操作 → 次操作，一眼分得清。
4. **改掉 alert**：所有反馈内联化，错误可重试。
5. **不动后端契约**：`/api/ai/optimize` 的入参（`jobId / targetCompany / targetPosition / targetRegion / jdContent / suggestions`）保持不变，保证历史记录回放不受影响。

---

## 三、关键洞察：这个功能其实大部分是多余的

改之前必须知道一件事——**平台自己就有 JD**。

```
jobs 表：233,514 行
其中有 description 且长度 > 200 字：229,456 行（98.3%）
其中有 requirements：147,723 行
Google 岗位样本：desc_len 3,216 ~ 4,519 字
```

而且**后端早就会自动补 JD**（`src/app/api/ai/optimize/route.ts:114-136`）：

```ts
if (jobId !== null) {
  const { data } = await client.from('jobs')
    .select('id, title, company, region, description, requirements')
    .eq('id', jobId).maybeSingle();
  targetCompany  ||= data.company;
  targetPosition ||= data.title;
  targetRegion   ||= data.region;
  jdContent      ||= [data.description, data.requirements].filter(Boolean).join('\n\n');
}
```

前端也确实传了 `jobId: targetJobId`（`page.tsx:1159`）。

**结论**：只要用户从站内选了岗位，JD 就是自动来的，根本不需要点"获取岗位描述"。那个按钮唯一还有意义的场景是「目标岗位不在站内，用户手打公司和职位」——这是少数派路径。

所以改造方向不是"把联网搜索修好"，而是：**把主路径做成"选岗位 → JD 自动到位"，把联网/手动补全降级成手动模式下的可选辅助。**

这也顺带解决了成本问题：不再每次点按钮都跑一次付费联网搜索。

---

## 四、新设计

### 4.1 状态模型（单一真源）

```ts
type TargetMode = 'job' | 'manual';

// targetJobId 是否存在，唯一决定 mode
targetJobId: number | null;

// 选中的站内岗位（mode==='job' 时唯一真源）
selectedJob: Job | null;   // { id, title, company, region, hasDescription, descriptionLength }

// 手动模式下的用户输入（mode==='manual' 时才可编辑）
manual: { company: string; position: string; region: string };

// JD 显式覆盖：只在用户手改过时才非 null
jdOverride: string | null;
```

派生，不再双写：

```ts
const company  = mode === 'job' ? selectedJob.company  : manual.company;
const position = mode === 'job' ? selectedJob.title    : manual.position;
const region   = mode === 'job' ? selectedJob.region   : manual.region;
const jdContent = jdOverride ?? (mode === 'job' ? selectedJob.description : '');
```

> 这一步直接消灭"问题 1"。当前代码里 `targetCompany` 被 5 个地方写，改完只剩 2 个入口。

### 4.2 线框图

```
╭─ 简历优化设置 ───────────────────────────────────────────────╮
│  针对某个岗位优化简历，AI 会按该岗位的 JD 与目标地区重写内容。 │
│                                                              │
│  ① 目标岗位                                          * 必填  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  ⌕ 搜索岗位 / 公司，或从收藏、已添加中选择…        ▾  │ │   ← 单一入口
│  └────────────────────────────────────────────────────────┘ │
│     展开后分组：我的收藏 · 已添加 · 全库搜索(233,514) · 手动填写 │
│                                                              │
│  ── 选中后，搜索框替换为： ─────────────────────────────────  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  ● Software Engineer                                   │ │
│  │    Google · 美国                     [✓ 已关联 JD]  ✕  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ② 简历                                              * 必填  │
│  ┌─────────────────────────────┐                            │
│  │  聂乾 简历(1).pdf        ▾  │                            │
│  └─────────────────────────────┘                            │
│                                                              │
│  ③ 岗位描述（可选）                                          │
│  ⌄ 已从岗位自动关联 · 3,216 字                  [查看] [手改]│   ← Collapsible，默认收起
│    ┌──────────────────────────────────────────────────────┐ │
│    │ （展开后：只读预览，点"手改"变 textarea）             │ │
│    └──────────────────────────────────────────────────────┘ │
│                                                              │
│  ──────────────────────────────────────────────────────────  │
│  目标地区  [美国 ▾]                        [ ✨ 开始优化 ·2 ]│   ← 操作条独立
│  预计消耗 2 积分                                             │
╰──────────────────────────────────────────────────────────────╯
```

手动模式下 ① 变为：

```
  ① 目标岗位                                          * 必填  │
  ┌────────────────────────────────────────────────────────┐ │
  │  ⌕ 搜索岗位 / 公司，或从收藏、已添加中选择…        ▾  │ │
  └────────────────────────────────────────────────────────┘ │
  ┌ 手动填写 ─────────────────────────────────────────── ┐   │
  │  [公司 ______]  [岗位 ______]  [地区 ▾]              │   │
  │                                [⌕ 尝试从官网补全 JD]  │   │   ← 次要按钮 + 说明文字
  └──────────────────────────────────────────────────────┘   │
```

### 4.3 冗余消除对照

| 现状 | 改后 |
|---|---|
| 收藏 chips + 已添加 chips + 搜索框 + 2 个输入框（4 套） | 1 个 Command 组合框，内部分组（1 套） |
| JD 在 textarea + 卡片显示两遍 | 1 个 Collapsible，收起时只显示"已关联 · N 字" |
| 靶心图标裸按钮 | 手动模式下带文字的「尝试从官网补全 JD」+ 失败内联提示 |
| 7 处 `alert()` | 卡内 `<Alert>`（`role="alert"`）+ 可重试按钮；成功用内联细条 |
| 3 列错位栅格 | 单列纵向流，`max-w` 对齐，操作条独立 |
| 无空状态 | 未选简历/岗位时，操作条禁用并显示原因 |

### 4.4 反馈设计

```tsx
{jdError && (
  <Alert variant="destructive" role="alert" className="mt-2">
    <AlertCircle className="h-4 w-4" />
    <AlertTitle>没能自动补全岗位描述</AlertTitle>
    <AlertDescription>
      可以直接在下方粘贴 JD，或
      <button onClick={retry} className="underline">重试</button>
    </AlertDescription>
  </Alert>
)}
```

要点：**失败不阻塞**。JD 本来就是可选输入，抓不到就让用户手填，不在主流程上弹窗。

---

## 五、实施计划

### P0 · 止血（约 1.5 小时，建议先做）

| 步骤 | 内容 | 验收 |
|---|---|---|
| P0-1 | 新建 `src/app/api/jobs/search-jd/route.ts`，**改为查站内 jobs 表** | `POST` 返回 200 + `{success, jdContent, source, job}` |
| P0-2 | 前端 `handleSearchJD`：先判 `response.ok`，`response.json()` 包 try，错误内联展示 | 点按钮不再弹 alert |
| P0-3 | 把按钮从「公司」输入框右侧移出，放进手动模式的字段区 | 截图位置不再有裸图标 |
| P0-4 | 删除死状态 `jdResults` / `setJdResults` | `tsc` 无新增报错 |
| P0-5 | i18n 补 3 个 key（`optimize.jdFetching` / `jdFetchFailed` / `jdFetchManual`），zh-CN / zh-TW / en 三份 | 三语言无缺 key |

**P0-1 新接口设计**（零外部依赖，纯查库）：

```ts
// POST /api/jobs/search-jd  { company, position, region? }
// 1. jobs 表按 company ilike + title ilike 匹配
// 2. 优先取 description 最长的 active 岗位
// 3. 命中 → { success: true, jdContent, source: {kind:'internal', jobId, title, company}, matches: [...] }
// 4. 未命中 → { success: false, error: '站内未找到该岗位的 JD', canManual: true }
```

为什么用站内而不是联网：
- 98.3% 覆盖率，质量比搜索结果稳定（结构化 description + requirements）
- 零成本、零延迟（DB 索引直查，比联网搜索快 2 个数量级）
- 不依赖已下线的 `coze-coding-dev-sdk`
- 能返回真实 `jobId`，直接复用后端已有的自动补 JD 逻辑

### P1 · 信息架构重构（约 1 天）

| 步骤 | 内容 | 验收 |
|---|---|---|
| P1-1 | 抽出 `src/components/optimize/target-job-picker.tsx`（Command 组合框 + 已选卡片 + 手动模式），受控组件 | 组件单测/手测：4 种入口都能正确写回 |
| P1-2 | 抽出 `src/components/optimize/jd-panel.tsx`（Collapsible + 只读预览 + 手改 textarea） | JD 内容全页只出现 1 处 |
| P1-3 | 重构 `page.tsx` 状态为 4.1 的单一真源，删掉 5 处 `setTargetCompany` 双写 | `grep setTargetCompany` 只剩派生入口 |
| P1-4 | 栅格改单列纵向流 + 操作条独立 | 1440 / 768 / 375 三档截图对齐 |
| P1-5 | 7 处 `alert()` 全部替换为内联反馈 | `grep -c 'alert('` = 0 |
| P1-6 | 空状态：未选简历/岗位时禁用主按钮 + 显示原因 | 首次进入页面有引导 |

### P2 · 打磨（约半天）

| 步骤 | 内容 |
|---|---|
| P2-1 | 主按钮显示积分消耗（`actionLabel` 已有能力，保持）+ 禁用原因 tooltip |
| P2-2 | 统一圆角/边框/间距 token（`rounded-xl` + `border-zinc-200` 一套） |
| P2-3 | 骨架屏：`resumesLoading` 时用 `<Skeleton>` 替代空白 |
| P2-4 | 移动端：操作条 sticky 底部，搜索下拉全屏 sheet |
| P2-5 | 历史记录卡片显示"JD 来源"徽标（站内 / 手填） |

---

## 六、风险与回滚

| 风险 | 应对 |
|---|---|
| 重构打断老用户的「手打公司 + 岗位」习惯 | 手动模式保留，只是折叠；已有历史记录 `loadRecord()` 仍能按 `targetCompany/targetPosition` 回填 |
| `loadRecord` 依赖旧状态字段 | P1-3 重构时保留 `targetCompany/targetPosition/targetRegion` 作为**派生只读**，`loadRecord` 改为写入 `manual` 或 `selectedJob` |
| 历史记录里的 `jobId` 可能已下架 | 已选卡片加载时若 job 404，降级为手动模式并提示"该岗位已下架，已转为手动填写" |
| 接口改动影响其他页面 | `search-jd` 只有 optimize 页在用（`git grep` 确认唯一调用点） |

回滚：改动集中在 1 个页面 + 2 个新组件 + 1 个新路由，`git revert` 单个提交即可，无数据库变更。

---

## 七、工作量汇总

| 阶段 | 工作量 | 产出 |
|---|---|---|
| P0 止血 | 1.5 h | 按钮真的能用；不再弹 alert |
| P1 重构 | 1 天 | 单一入口、无重复展示、层级清晰 |
| P2 打磨 | 0.5 天 | 视觉统一、移动端、骨架屏 |
| **合计** | **约 2 天** | |

---

## 八、建议的下一步

1. **先做 P0**——它是线上缺陷，和设计评审无关，可以立刻合。
2. **P1 先看 mockup**（`docs/optimize-redesign-mockup.html`），确认信息架构方向后再动 `page.tsx`。
3. P1-1 / P1-2 抽组件时，顺手把 `mock-interview/page.tsx`（4,424 行单文件）里相同的"目标岗位选择"模式也纳入复用范围——两页现在是各写一套。

---

## 九、实施记录（2026-11-24 完成）

### 已落地改动

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/app/api/jobs/search-jd/route.ts` | 新增 | 重建被删的接口，改为**只查站内 jobs 表**，零外部依赖 |
| `src/components/optimize/target-job-picker.tsx` | 新增 | 目标岗位选择器：收藏 / 已添加 / 全库搜索 / 手动填写统一入口 |
| `src/components/optimize/jd-panel.tsx` | 新增 | JD 面板：全页唯一展示位，折叠 + 只读预览 + 手改 |
| `src/app/optimize/page.tsx` | 重写表单区 | 状态单一真源、单列纵向流、7 处 `alert()` 归零 |
| `src/lib/language-context.tsx` | 补文案 | 新增 25 个 `optimize.*` key × zh-CN / zh-TW / en |

### 接口设计（相对原计划的调整）

原计划 P0-1 只写了一个「公司 + 岗位」检索模式。实施时发现前端有两条真实路径，于是把接口做成双模式：

```ts
POST /api/jobs/search-jd
  { jobId }                        // 模式 A：选中站内岗位，直接取该岗位 JD
  { company, position, region? }   // 模式 B：手动模式，按公司/岗位检索最接近的 JD
```

模式 A 是主路径：前端选中岗位后自动调用，用户**不需要点任何按钮**。

模式 B 采用三级降级并标注匹配质量：

| 顺序 | 过滤条件 | `matchQuality` | 前端提示 |
|---|---|---|---|
| 1 | `company ilike AND title ilike` | `exact` | 无额外提示 |
| 2 | 仅 `company ilike` | `company` | 「站内没有完全匹配的岗位，已按公司选取最接近的 JD」 |
| 3 | 仅 `title ilike` | `position` | 「…已按岗位名选取最接近的 JD」 |

候选筛选规则：`description + requirements` 合成后长度 ≥ 120 字符、且通过 `isDisplayableJobDescription` 校验，取其中最长的一条。这样避免把采集器残留的 JSON 证据当成 JD。

### 状态模型实际落地

```ts
// 单一真源
selectedJob: { id, title, company, region } | null
manualCompany: string
manualPosition: string

// 派生（只读，下游一律用这三个）
targetJobId  = selectedJob?.id ?? null
targetCompany = selectedJob?.company ?? manualCompany
targetPosition = selectedJob?.title ?? manualPosition
```

`setTargetCompany` / `setTargetPosition` / `setTargetJobId` 这三个双写入口已全部删除。历史记录回填与 URL 参数回填改为「有 `jobId` 就填 `selectedJob`，否则填手动字段」。

### 验收结果

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 error |
| `eslint`（改动文件） | 0 error（仅 1 处既有 warning `generatedResumeData`） |
| `check-i18n-keys` | 766 key，三语齐全 |
| `next build` | ✓ Compiled successfully，`/api/jobs/search-jd` 已进入路由表 |
| `POST /api/jobs/search-jd` 无鉴权 | 返回 **401**（不再是 405 + 空 body） |
| `grep -c alert(` 于 `page.tsx` | **0**（原 7 处） |
| 站内数据可行性 | Google + Software Engineer 精确命中 **425** 条，平均 JD **2,047 字符** |

### 相对原计划的取舍

| 计划项 | 实际做法 | 原因 |
|---|---|---|
| P1-1 用 `Command` 组合框 | 用原生 Input + 下拉结果列表 | `cmdk` 需要完整键盘导航/无障碍改造，本次以收敛信息架构为先，交互沿用已验证的搜索下拉 |
| P0-3「按钮移进手动模式」 | 落地为「从主流程删除 + 手动模式保留带文字按钮」 | 主路径已自动关联 JD，按钮在主流程里没有存在意义 |
| P2-3 骨架屏 | 未做 | `ResumeAvailabilityHint` 已覆盖简历加载态，再加骨架屏收益低 |
| P2-4 移动端 sticky 操作条 | 未做 | 单列布局后操作条已在自然流末尾，sticky 反而遮挡 JD 面板 |
| 历史记录显示「JD 来源」徽标 | 未做 | 记录表未存 `jdOrigin`，需加字段，超出本次范围 |

### 遗留与后续

1. `mock-interview/page.tsx` 里有一套相同的「目标岗位选择」逻辑，可直接复用 `TargetJobPicker`（当前 props 已按通用场景设计）。
2. 「JD 来源」若要进历史记录，需给 `optimized_resumes` 加一列并在 PATCH 时落库。
3. 本次未做：`region` 的手动覆盖与 `selectedJob.region` 的冲突策略——目前手动选地区会直接覆盖，UI 上不区分来源。
