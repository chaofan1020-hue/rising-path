# 自动网申优化方案（2026-11）

> 结论先说：**现在这套流程不是"慢"，而是"省下的打字 ≈ 新增的确认成本"**。
> 真正的提速点不在"再加字段"，而在三件事：先填后核、一单一次、复用 ATS 自己的简历解析。

---

## 1. 线上证据（2026-11-18 采集）

### 1.1 使用量

| 指标 | 数值 | 来源 |
|---|---|---|
| 网申记录 | 9 条 / 5 个用户，全部 `pending`，`submitted_at` 全为 0 | `public.applications` |
| 求职档案 | 8 条 / 8 个用户 | `public.application_profiles` |
| 填写反馈（学习数据源） | **0 条** | `public.prefill_feedback` |
| 网申 AI 调用 | 11 次（2026-07） | `public.ai_usage_events` |

→ 学习闭环上线至今**没有产生过一条数据**，所谓"越用越快"从未发生；也没有任何一单被标记为已提交。

### 1.2 岗位库的可达性（决定自动化天花板）

活跃岗位 110,728 条：

| bucket | 数量 | 占比 | 现有配方 |
|---|---|---|---|
| company_direct（自建站） | 50,172 | 45.3% | ❌ |
| workday | 41,666 | 37.6% | ✅（选择器未 dry-run） |
| smartrecruiters | 7,731 | 7.0% | ✅ |
| greenhouse | 7,466 | 6.7% | ✅ |
| ashby | 3,156 | 2.9% | ✅ |
| lever | 286 | 0.3% | ✅ |
| linkedin | 248 | 0.2% | 不做 DOM 注入 |
| successfactors | 3 | 0.0% | ✅（样本太少） |

自建站里的大头：`amazon.jobs` 16,884（15.2%）、Oracle Cloud 8,367（`jpmc` 6,117 + `eeho` 2,250）、`jobs.apple.com` 3,506、`careers.ibm.com` 2,850、`google.com` 2,162、`apply.careers.microsoft.com` 1,616、`apply.deloitte.com` 1,499、`metacareers.com` 1,202、`accenture.com` 1,057。

- 现有 8 个配方覆盖 **54.5%** 岗位；
- 补 Amazon / Oracle Cloud / Apple / Microsoft / IBM / Google / Deloitte / Accenture / Meta 这 9 个站，可到 **~90%**。

**关键含义**：45% 的岗位落在"每家一个站"的自建 ATS 上，靠通用启发式永远填不全，必须按站做配方；而 15% 的 Amazon 一类又是多步 + 自定义下拉的重灾区。

### 1.3 分发

- 线上只配置了 Edge 商店（`NEXT_PUBLIC_EXTENSION_EDGE_STORE_URL`），Chrome 没有；
- `public/` 里没有任何 zip/crx，站内没有"下载扩展"通道，`/extension` 页在没有商店地址时，按钮文案是"查看安装说明"，实际链接指向**隐私政策**；
- 也就是说：Chrome 用户（绝大多数）目前**根本没有安装入口**。

---

## 2. 一次 Workday 网申的交互预算（估算）

| 阶段 | 现在 | 目标（首次） | 目标（同站第 2 单） |
|---|---|---|---|
| 选岗位 + 选简历 + 打开官网 | 3 | 1 | 0 |
| 注册/登录雇主账号 | ~12 | ~12 | 0 |
| 上传简历 | 3（点按钮→文件对话框→选文件） | 0 | 0 |
| 触发 ATS 自带简历解析 | 2（自己找按钮） | 0 | 0 |
| 每页：开 popup + 扫描 | 2 × 6 页 = 12 | 0 | 0 |
| 每页：逐字段勾选接受 | 8~20 × 6 页 | 0 | 0 |
| 手动补空 + 改错 | 10~15 | 3~5 | 2~3 |
| 每页：点"下一步" | 6 | 0 | 0 |
| 提交 | 2 | 2（保留人工） | 2 |
| **合计** | **≈ 45~60 次交互** | **≈ 18** | **≈ 5** |

工具现在实际只替代了其中 8~12 次打字，却新增了 20+ 次勾选——**净收益接近零**，这正是"没比手动快多少"的来源。

三个结构性原因：

1. **识别层**：`extension/content.js:22-56` 只有 26 条英文正则；label 只取 `labels[0]/aria-label/placeholder/name/id`；服务端只认 17 个 key（`prefill/route.ts:54-148`）。Greenhouse/Lever 的自定义问题、教育 5 个字段、EEO、筛选题全部落到手打。
2. **交互层**：popup 默认**只勾选高置信度非 AI 字段**（`popup.js:41-43`），AI 结果默认不勾；而且只要有一个 select 找不到选项，`background.js:134-137` 直接 `throw`，整单判定失败、学习数据不落库。
3. **编排层**：没有任何自动翻页、没有文件上传、没有自动重扫（`content.js` 无 MutationObserver / 路由监听）；Workday 6 步就是 6 轮人工。

外加两笔"看不见的成本"：

- 只要页面上有识别不到的字段（几乎必然），就会触发一次 AI 兜底，按 `application_prefill` 扣 **8 积分**（`src/lib/credit-prices.ts:22`），并且**没有幂等键**——改一个字符重扫一次再扣 8 分；
- 策略上我们自己在做"全量字段解析"，而 Workday/Greenhouse/Lever 本身就带简历解析（"Autofill with Resume"）。用 17 个 key 去挑战 ATS 自己的 80% 覆盖率，天然打不过。

---

## 3. 三条原则（对应三层改造）

| 原则 | 反例（现状） | 改造后 |
|---|---|---|
| **先填后核** | 用户先逐个勾选，再点"填写" | 扫描即填（高置信 + 非敏感），popup 变成"还有 3 项要你确认"的 diff 列表 |
| **一单一次** | 每一页都要开 popup → 扫描 → 勾选 → 填写 | 一次授权，自动翻页、自动重扫，到提交页停下 |
| **复用 ATS 自己的解析** | 我们逐字段硬填 | CDP 上传简历 → 点站点配方里的 "Autofill with resume" → 只补差集 |

---

## 4. 目标形态

1. **秒填（默认，零权限扩张）**：进入网申页 → 页面右下角浮动条显示"已识别 32 项 / 已填 29 项 / 3 项待确认" → 用户核对后自己提交。
2. **巡航（主力）**：从 AI 选岗或收藏夹一键生成 10–30 单清单 → 逐单打开 → 自动填到提交页 → 用户逐个点提交 → 状态自动回填。
3. **全自动（付费/白名单，默认关）**：单页表单站点（Greenhouse/Lever/Ashby），逐站授权 + 限速 + 每日上限。

**非扩展兜底**：`复制结构化资料`（现在只有一个"复制资料"按钮，可升级为分块粘贴 + 一键填充本地 Agent，复用 `scripts/capture-linkedin-browser-jobs.ts` 的 playwright 持久化 profile 范式）。

---

## 5. 改造清单

### P0（约 1 周，不扩权限，立刻见效）

| # | 改动 | 位置 | 预期 |
|---|---|---|---|
| 1 | **交互反转**：扫描结果直接回填页面（置信 ≥0.85 且非 `sensitive`），popup 改为 diff 列表 + 一键全选；失败逐字段报告，不再整体 throw | `content.js` / `background.js` / `popup.js` | 每单交互 −70% |
| 2 | **接上 90 题引擎**：新增 `POST /api/apply/resolve`（配方 → 语义 → 答案），默认零 AI；`prefill` 保留兼容 | 新路由 + `src/lib/apply/*` | 覆盖 17 → 90 题；零 AI 页 ≥60% |
| 3 | **label 提取升级**：`aria-labelledby` / `closest('label,div,li')` 文本 / `fieldset legend` / 前一兄弟节点 / section 标题 | `content.js` | 识别率 ~40% → ~75% |
| 4 | **控件补齐**：radio 组按 name 聚合、checkbox、date、自定义 combobox（`role=combobox` → 点开 → 选 `li[role=option]` → 回读校验）、shadow DOM 递归 | `content.js` | 现代 ATS 主力控件可用 |
| 5 | **分发**：Chrome 商店上线 + 站内 zip 下载（`/api/extension/download` 或 `public/extension.zip`），修掉"安装说明 → 隐私政策"的假链接 | 站点 + 商店 | 从"只有 Edge"变成全量可装 |
| 6 | **计费**：同一表单指纹（host + 字段指纹 + profileVersion）10 分钟内不重复计费；只对 AI 实际产出的字段计费 | `prefill`/`apply` 路由 | 扫描成本 −50% 以上 |

### P1（约 2 周，需 `debugger` 权限）

| # | 改动 | 预期 |
|---|---|---|
| 7 | **CDP 文件上传** + 配方里的 `autofillFromResume` selector → 触发 ATS 自带解析 | 去掉最大的手动断点，覆盖率直接翻倍 |
| 8 | **多步向导**：MutationObserver + 步骤配方 + "下一步"按钮识别 + 网络空闲判定 + 断点续跑 | Workday 6 步 = 1 次授权 |
| 9 | **sidePanel 替代 popup**：不遮挡页面、随标签页切换刷新、可断点续填 | 少一次开/关 popup |

### P2（约 2–3 周）

| # | 改动 | 预期 |
|---|---|---|
| 10 | **答案库**（`application_answers`）+ `POST /api/apply/feedback`：一次答、处处用；开放题复用；domain 级覆盖 | 第 3 单的字段修改率 <5% |
| 11 | **投递清单 + 队列**（`apply_tasks`）：一键生成清单、逐单巡航、失败重排、提交凭证识别回填状态 | 10 单 ≤ 10 分钟 |
| 12 | **覆盖矩阵**：Amazon / Oracle Cloud / Apple / Microsoft / IBM / Google / Deloitte / Accenture / Meta 配方（每个都要真实页面 dry-run） | 覆盖 54% → ~90% |

### P3

13. 失败现场上报 → 聚类 → 配方补丁（自愈）；14. 本地 Agent（playwright）给不愿装扩展的用户；15. 定向 cover letter 入队。

---

## 6. 度量（北极星与护栏）

| 指标 | 现状 | 目标 |
|---|---|---|
| 每单人工交互次数 | ~45–60 | <15（首次）/ <8（复投） |
| 每单耗时 | 10–20 min | <5 min（首次）/ <1 min（复投） |
| 字段自动填充率 | 估 ~30% | ≥85% |
| 零 AI 页占比 | 0%（无引擎） | ≥60% |
| 单次扫描积分 | 8 | ≤2（无 AI 时 0） |
| 提交状态回填率 | 0%（9 单全 pending） | ≥80% |
| 配方失效率 | 未度量 | <2% |

埋点：`apply_resolution_events`（识别率 / 配方命中 / AI 占比 / 耗时 / 未识别样本）、`apply_tasks`（每单点击数、停留时长、人工介入点）。

---

## 7. 合规与风险

1. **默认不代提交**，用户始终自己点提交；巡航只做到"提交页暂停"。
2. **不代登录、不存密码**；只用用户浏览器里已有的会话。
3. **LinkedIn 等明确禁止自动化的站点**走"结构化复制"，不做 DOM 注入。
4. `debugger` 权限会被商店审核重点检查：必须在商店描述和站内说明写清用途（仅向用户指定的 `input[type=file]` 注入用户自己的简历文件），并做成**按站点开关**。
5. Workday 对异常账号风控最严：全自动只对单页表单站点开放白名单，且限速。

---

## 8. 待拍板

1. 先做 **P0（1 周，无需扩权限，改交互 + 接引擎）**，还是直接上 **P1（CDP 上传 + 自动翻页，需扩权限）**？
2. 是否接受 `debugger` 权限（可以退化为"用户手动选文件 + 自动点 Autofill"，效果差一截）？
3. Chrome 商店是否上（$5 开发者账号 + 1–3 天审核），还是先站内 zip 侧载？
4. 全自动提交要不要做（建议：不做，或仅付费 + 白名单 + 逐站授权）。

---

## 9. 已落地（2026-11-18，本地 Agent 路线）

按「登录一次 → 本地 Agent 夜间巡航 → 只看报告」推进，已完成 M1 的地基：

| 产物 | 位置 | 说明 |
|---|---|---|
| DOM 引擎 | `extension/engine.js` | 扫描/填写/上传/翻页的单一实现；扩展与 Agent 共用。支持 shadow DOM、iframe（按帧）、radio 组、date、`role=combobox` 自定义下拉、逐字段回读校验 |
| 本地 Agent | `agent/` | `cli.ts`（login/doctor/open/run）、`flow.ts`（单岗位全流程）、`browser.ts`（持久化 profile）、`api.ts`（解析与简历下载） |
| 解析接口 | `POST /api/apply/resolve` | 配方直连 → 90 题词库 → 档案推导，默认零 AI；返回逐字段值 + `reason` + `needsReview` |
| 简历字节接口 | `GET /api/apply/resume-file` | 供 Agent 原生 `setInputFiles`，不产生公开 URL |
| 档案结构化 | `src/lib/application-profile.ts` | 教育/经历保留 school/degree/major/gpa/company/role，教育 5 个字段不再手打 |

行为约定（已实现）：

- 默认 `dry-run`：填到提交页停下，不点提交；`--submit` 才提交并抓回执（确认号 + 截图）。
- **高敏字段永不代答**（EEO / 授权签名 / 结婚签证等），只进报告给建议值。
- **必填缺口即停**，不做"静默投错"。
- 先上传简历再扫描：利用 ATS 自家解析器回填，只补差集。

验证：

- `pnpm test:agent`：20 条端到端断言（三步向导演练/真提交、确认号、shadow DOM、自定义下拉、文件上传）全绿；
- `scripts/test-apply-engine.ts`：82 条引擎断言全绿；
- `scripts/test-application-profile.ts` 通过；`next build` 通过。

下一步（M2/M3）：

1. 真实站点 dry-run：Workday / Greenhouse / SmartRecruiters 各挑 3 个岗位，校准配方选择器与"下一步"文案；
2. `apply_tasks` + 报告页：把 `results.json` 回传成网页里的投递报告（现在只在本地文件）；
3. 提交状态回填 `applications`（现在 9 单仍全是 `pending`）；
4. 扩展侧接线 `engine.js`（现在是 Agent 在用），保证装扩展的用户也有秒填体验。