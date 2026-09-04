# 岗位字段第一阶段盘点总表

更新时间：2026-09-02 15:58（Asia/Shanghai）  
数据环境：生产 Supabase `weqvdtdjdzmqflhwobec`  相关服务器：`43.172.117.125:/opt/liorvix`

## 1. 盘点结论

本阶段已完成“公司、来源、字段、队列、未完成事项”的生产只读盘点，没有执行岗位写入、字段回填、岗位关闭或来源矩阵写入。

| 当前阶段 | 公司数 | 在招岗位数 | 含义 | 下一步 |
| --- | ---: | ---: | --- | --- |
| `completed_baseline` | 45 | 11,743 | 已完成首轮官方字段回填、证据核对和公司级回归；新增岗位仍需由持续队列处理 | 复核新增岗位和待复核字段，不重复全量扫描 |
| `queue_in_progress` | 1 | 2,152 | Citigroup 已识别为 Workday，当前由官方字段队列继续推进，尚未纳入“全量完成” | 观察游标、候选量和失败情况，完成末端 dry-run |
| `source_identified_pending` | 5 | 14,189 | 已从生产岗位 URL 识别出 Apple、Oracle HCM 或 Phenom 等来源族，但尚未完成公司级官方样本验收 | 每家公司独立确认官方源、稳定 ID、详情和 20 条样本 |
| `discovery_required` | 24 | 30,321 | 只有官方岗位 URL 或来源迹象，尚未形成可验收的来源连接器 | 只做官方源探测和台账，不做字段回填 |
| **合计** | **75** | **58,405** | 当前生产活跃 `collector_feed` 岗位快照 | 以本表作为后续排期基线 |

历史交接单记录的“已完成 45 家”与本次生产矩阵一致。这里额外拆出了 Citigroup 和 5 家待处理公司，避免把“来源已识别”误当成“字段已完成”。

## 2. 六项标准字段总览

以下统计来自生产 `audit-company-source-matrix`。格式为：`verified` 已验证 / `pending_recheck` 待复核 / `rejected_legacy` 历史拒绝 / `unavailable_on_official_source` 当前没有已确认字段证据的剩余记录。

`unavailable_on_official_source` 只有在官方源已确认后才能解释为“官网没有提供”；对 `discovery_required` 公司，它只能表示“当前尚未形成证据”，不能当作官网缺失。

| 字段 | 已验证 | 待复核 | 历史拒绝 | 未形成证据的剩余记录 |
| --- | ---: | ---: | ---: | ---: |
| 地点 `location` | 9,986 | 3,918 | 44,354 | 147 |
| 工作方式 `workplace_type` | 4,225 | 8,603 | 0 | 45,577 |
| 岗位类型 `employment_category` | 16,920 | 2,889 | 0 | 38,596 |
| 经验 `experience` | 15,479 | 1,133 | 0 | 41,793 |
| 薪资 `salary` | 5,082 | 8,772 | 0 | 44,551 |
| 截止日期 `deadline` | 456 | 9,310 | 3,594 | 45,045 |

这些数字不能直接相加为“必须回填的岗位数”：同一岗位可能同时缺多个字段；官网没有公开字段、详情暂时不可访问、历史字段被隔离和真正的解析缺陷必须分别处理。

### 当前未纳入标准覆盖率的工作

- 描述、任职要求和正文可展示性还没有形成公司级完整覆盖率总表；已有内容审计脚本只能作为专项抽样，不能替代全量质量结论。
- 学生相关字段还没有进入标准化模型。上游 500 条样本中，`education_level` 有 225 条、`level` 有 369 条、`employment_type` 有 500 条、`experience` 有 387 条、`valid_through` 有 143 条、工作方式相关字段有 22 条，`recruiting_program` 为 0 条，500 条状态均为 `open`。
- 当前岗位标准分类仍主要依赖标题、`employment_type` 和 `level`；`education_level`、`recruiting_program` 等上游字段没有形成独立的 `student_eligible`、`student_signal` 和证据来源字段。
- 上游样本首尾更新时间为 2026-08-10，说明当前返回页不能单独证明最近几天的新增岗位情况；新鲜度应由主增量同步指标单独监控。

## 3. 公司来源与字段状态总表

字段列顺序为：地点 / 工作方式 / 岗位类型 / 经验 / 薪资 / 截止日期。每个值为 `已验证 / 当前在招岗位数`。空字段不表示失败，需结合“阶段”和来源证据判断。

| # | 公司 | 在招 | 来源族 | 阶段 | 字段覆盖：地点 / 工作方式 / 岗位类型 / 经验 / 薪资 / 截止日期 |
| ---: | --- | ---: | --- | --- | --- |
| 1 | Amazon | 20,276 | official_custom_or_unclassified | `discovery_required` | 0/20276 / 569/20276 / 3949/20276 / 3425/20276 / 6/20276 / 357/20276 |
| 2 | JPMorgan Chase | 10,363 | oracle_hcm | `source_identified_pending` | 948/10363 / 46/10363 / 921/10363 / 632/10363 / 4/10363 / 0/10363 |
| 3 | Apple | 3,442 | apple_official_api | `source_identified_pending` | 0/3442 / 1/3442 / 7/3442 / 1/3442 / 0/3442 / 0/3442 |
| 4 | Accenture | 2,396 | workday | `completed_baseline` | 1423/2396 / 434/2396 / 1555/2396 / 1147/2396 / 712/2396 / 0/2396 |
| 5 | Google | 2,345 | official_custom_or_unclassified | `discovery_required` | 0/2345 / 55/2345 / 55/2345 / 508/2345 / 523/2345 / 0/2345 |
| 6 | Citigroup | 2,152 | workday | `queue_in_progress` | 2152/2152 / 57/2152 / 2121/2152 / 1337/2152 / 1371/2152 / 9/2152 |
| 7 | Microsoft | 1,467 | official_custom_or_unclassified | `discovery_required` | 0/1467 / 67/1467 / 75/1467 / 434/1467 / 404/1467 / 0/1467 |
| 8 | Deloitte | 1,163 | official_custom_or_unclassified | `discovery_required` | 1/1163 / 108/1163 / 203/1163 / 298/1163 / 219/1163 / 0/1163 |
| 9 | Morgan Stanley | 1,128 | official_custom_or_unclassified | `discovery_required` | 13/1128 / 0/1128 / 82/1128 / 692/1128 / 0/1128 / 9/1128 |
| 10 | Wells Fargo | 1,067 | workday | `completed_baseline` | 1066/1067 / 63/1067 / 1057/1067 / 1046/1067 / 388/1067 / 0/1067 |
| 11 | NVIDIA | 915 | workday | `completed_baseline` | 915/915 / 17/915 / 915/915 / 577/915 / 0/915 / 0/915 |
| 12 | Meta | 775 | official_custom_or_unclassified | `discovery_required` | 0/775 / 3/775 / 118/775 / 18/775 / 0/775 / 0/775 |
| 13 | Goldman Sachs | 758 | official_custom_or_unclassified | `discovery_required` | 0/758 / 3/758 / 22/758 / 47/758 / 2/758 / 0/758 |
| 14 | OpenAI | 692 | ashby | `completed_baseline` | 85/692 / 478/692 / 692/692 / 424/692 / 0/692 / 0/692 |
| 15 | Databricks | 557 | greenhouse | `completed_baseline` | 62/557 / 58/557 / 214/557 / 458/557 / 0/557 / 0/557 |
| 16 | Bank of America | 485 | workday | `completed_baseline` | 429/485 / 74/485 / 433/485 / 229/485 / 245/485 / 0/485 |
| 17 | Fidelity Investments | 420 | workday | `completed_baseline` | 420/420 / 89/420 / 420/420 / 194/420 / 140/420 / 1/420 |
| 18 | Vanguard | 419 | workday | `completed_baseline` | 419/419 / 111/419 / 419/419 / 303/419 / 5/419 / 0/419 |
| 19 | Stripe | 398 | greenhouse | `completed_baseline` | 74/398 / 81/398 / 129/398 / 381/398 / 3/398 / 0/398 |
| 20 | UBS | 337 | official_custom_or_unclassified | `discovery_required` | 0/337 / 1/337 / 1/337 / 2/337 / 0/337 / 0/337 |
| 21 | Brex | 278 | greenhouse | `completed_baseline` | 48/278 / 48/278 / 173/278 / 242/278 / 0/278 / 0/278 |
| 22 | Palantir | 277 | lever | `completed_baseline` | 4/277 / 277/277 / 275/277 / 2/277 / 0/277 / 0/277 |
| 23 | Datadog | 267 | greenhouse | `completed_baseline` | 22/267 / 67/267 / 131/267 / 196/267 / 0/267 / 0/267 |
| 24 | Cloudflare | 266 | greenhouse | `completed_baseline` | 86/266 / 28/266 / 12/266 / 179/266 / 23/266 / 0/266 |
| 25 | Boston Consulting Group | 253 | phenom | `completed_baseline` | 3/253 / 167/253 / 227/253 / 196/253 / 25/253 / 3/253 |
| 26 | Jane Street | 231 | official_custom_or_unclassified | `discovery_required` | 8/231 / 0/231 / 4/231 / 4/231 / 0/231 / 0/231 |
| 27 | Intel | 226 | workday | `completed_baseline` | 226/226 / 34/226 / 226/226 / 205/226 / 225/226 / 0/226 |
| 28 | Deutsche Bank | 220 | official_custom_or_unclassified | `discovery_required` | 0/220 / 13/220 / 17/220 / 9/220 / 6/220 / 0/220 |
| 29 | State Street | 219 | workday | `completed_baseline` | 219/219 / 5/219 / 219/219 / 156/219 / 130/219 / 0/219 |
| 30 | Roblox | 200 | official_custom_or_unclassified | `discovery_required` | 18/200 / 19/200 / 19/200 / 17/200 / 0/200 / 0/200 |
| 31 | BlackRock | 194 | official_custom_or_unclassified | `discovery_required` | 0/194 / 42/194 / 0/194 / 35/194 / 0/194 / 0/194 |
| 32 | Okta | 193 | official_custom_or_unclassified | `discovery_required` | 28/193 / 16/193 / 4/193 / 23/193 / 0/193 / 0/193 |
| 33 | Oliver Wyman | 190 | phenom | `source_identified_pending` | 0/190 / 3/190 / 6/190 / 0/190 / 0/190 / 0/190 |
| 34 | MongoDB | 182 | official_custom_or_unclassified | `discovery_required` | 24/182 / 15/182 / 3/182 / 21/182 / 0/182 / 0/182 |
| 35 | Ares Management | 173 | workday | `completed_baseline` | 173/173 / 4/173 / 173/173 / 162/173 / 129/173 / 0/173 |
| 36 | Point72 | 171 | greenhouse | `completed_baseline` | 9/171 / 1/171 / 45/171 / 110/171 / 0/171 / 1/171 |
| 37 | Elastic | 161 | official_custom_or_unclassified | `discovery_required` | 38/161 / 2/161 / 12/161 / 14/161 / 0/161 / 0/161 |
| 38 | Millennium Management | 161 | official_custom_or_unclassified | `discovery_required` | 0/161 / 1/161 / 3/161 / 6/161 / 1/161 / 0/161 |
| 39 | Jefferies | 158 | oracle_hcm | `source_identified_pending` | 8/158 / 1/158 / 30/158 / 21/158 / 5/158 / 0/158 |
| 40 | Coinbase | 154 | greenhouse | `completed_baseline` | 29/154 / 150/154 / 87/154 / 151/154 / 0/154 / 0/154 |
| 41 | GitLab | 151 | greenhouse | `completed_baseline` | 33/151 / 151/151 / 110/151 / 16/151 / 0/151 / 0/151 |
| 42 | Reddit | 149 | greenhouse | `completed_baseline` | 23/149 / 110/149 / 149/149 / 144/149 / 0/149 / 0/149 |
| 43 | Barclays | 143 | workday | `completed_baseline` | 142/143 / 3/143 / 142/143 / 27/143 / 0/143 / 43/143 |
| 44 | McKinsey & Company | 143 | official_custom_or_unclassified | `discovery_required` | 0/143 / 1/143 / 1/143 / 0/143 / 0/143 / 0/143 |
| 45 | Blackstone | 139 | workday | `completed_baseline` | 139/139 / 2/139 / 139/139 / 130/139 / 113/139 / 0/139 |
| 46 | Ramp | 137 | ashby | `completed_baseline` | 12/137 / 137/137 / 137/137 / 110/137 / 0/137 / 0/137 |
| 47 | PIMCO | 134 | workday | `completed_baseline` | 134/134 / 1/134 / 133/134 / 94/134 / 66/134 / 6/134 |
| 48 | Figma | 127 | greenhouse | `completed_baseline` | 14/127 / 1/127 / 66/127 / 103/127 / 0/127 / 0/127 |
| 49 | Robinhood | 125 | greenhouse | `completed_baseline` | 15/125 / 5/125 / 67/125 / 91/125 / 0/125 / 11/125 |
| 50 | Cursor | 104 | ashby | `completed_baseline` | 9/104 / 104/104 / 104/104 / 52/104 / 0/104 / 0/104 |
| 51 | Brookfield | 101 | workday | `completed_baseline` | 101/101 / 1/101 / 101/101 / 90/101 / 67/101 / 0/101 |
| 52 | Vanta | 96 | ashby | `completed_baseline` | 18/96 / 92/96 / 96/96 / 74/96 / 0/96 / 0/96 |
| 53 | Perplexity | 88 | ashby | `completed_baseline` | 12/88 / 39/88 / 88/88 / 76/88 / 0/88 / 0/88 |
| 54 | Twilio | 88 | greenhouse | `completed_baseline` | 13/88 / 88/88 / 39/88 / 86/88 / 53/88 / 15/88 |
| 55 | Notion | 83 | ashby | `completed_baseline` | 11/83 / 70/83 / 83/83 / 57/83 / 0/83 / 0/83 |
| 56 | Adobe | 81 | workday | `completed_baseline` | 81/81 / 3/81 / 81/81 / 63/81 / 55/81 / 1/81 |
| 57 | Asana | 79 | greenhouse | `completed_baseline` | 79/79 / 79/79 / 40/79 / 79/79 / 6/79 / 0/79 |
| 58 | KKR | 75 | official_custom_or_unclassified | `discovery_required` | 8/75 / 6/75 / 0/75 / 6/75 / 1/75 / 0/75 |
| 59 | Bain & Company | 73 | official_custom_or_unclassified | `discovery_required` | 0/73 / 7/73 / 11/73 / 11/73 / 5/73 / 0/73 |
| 60 | Duolingo | 71 | official_custom_or_unclassified | `discovery_required` | 17/71 / 1/71 / 0/71 / 3/71 / 0/71 / 0/71 |
| 61 | The Carlyle Group | 63 | workday | `completed_baseline` | 63/63 / 29/63 / 63/63 / 60/63 / 42/63 / 0/63 |
| 62 | Discord | 51 | greenhouse | `completed_baseline` | 4/51 / 8/51 / 33/51 / 50/51 / 50/51 / 0/51 |
| 63 | Evercore | 48 | official_custom_or_unclassified | `discovery_required` | 0/48 / 3/48 / 1/48 / 2/48 / 5/48 / 0/48 |
| 64 | Two Sigma | 47 | official_custom_or_unclassified | `discovery_required` | 0/47 / 1/47 / 0/47 / 1/47 / 0/47 / 0/47 |
| 65 | Runway | 44 | ashby | `completed_baseline` | 3/44 / 44/44 / 44/44 / 34/44 / 0/44 / 0/44 |
| 66 | Rothschild & Co | 40 | official_custom_or_unclassified | `discovery_required` | 19/40 / 1/40 / 19/40 / 13/40 / 0/40 / 0/40 |
| 67 | Lazard | 36 | oracle_hcm | `source_identified_pending` | 3/36 / 3/36 / 0/36 / 1/36 / 0/36 / 0/36 |
| 68 | Citadel | 33 | official_custom_or_unclassified | `discovery_required` | 0/33 / 0/33 / 0/33 / 0/33 / 0/33 / 0/33 |
| 69 | Apollo Global Management | 32 | workday | `completed_baseline` | 32/32 / 0/32 / 32/32 / 29/32 / 13/32 / 0/32 |
| 70 | Bain Capital | 22 | workday | `completed_baseline` | 22/22 / 0/22 / 22/22 / 22/22 / 20/22 / 0/22 |
| 71 | Linear | 22 | ashby | `completed_baseline` | 2/22 / 22/22 / 22/22 / 18/22 / 0/22 / 0/22 |
| 72 | TPG | 17 | greenhouse | `completed_baseline` | 13/17 / 0/17 / 14/17 / 15/17 / 11/17 / 0/17 |
| 73 | Bridgewater Associates | 15 | greenhouse | `completed_baseline` | 5/15 / 5/15 / 15/15 / 11/15 / 5/15 / 0/15 |
| 74 | General Atlantic | 10 | greenhouse | `completed_baseline` | 0/10 / 0/10 / 5/10 / 7/10 / 0/10 / 0/10 |
| 75 | Houlihan Lokey | 9 | workday | `completed_baseline` | 9/9 / 0/9 / 9/9 / 2/9 / 4/9 / 0/9 |

完整原始快照见 [`phase1-source-matrix-production-20260902.json`](../../output/phase1-source-matrix-production-20260902.json)。

## 4. 当前未完成工作清单

### P0：必须先完成的盘点和防错工作

| 编号 | 工作 | 当前证据 | 状态 | 处理边界 |
| --- | --- | --- | --- | --- |
| P0-1 | 公司完成状态与来源状态分离 | 历史交接单有 45 家完成记录，但生产来源矩阵只表达来源族；本表首次合并两者 | 已完成盘点，尚未写回系统字段 | 后续可把该状态写入审计报告或台账，不直接改岗位 |
| P0-2 | 描述/任职要求正文质量盘点 | 已完成生产在招岗位首轮全量内容统计；正文异常 148 条，详情页可访问性尚未专项抽样 | 首轮完成，待详情抽样 | 按异常类别和学生信号抽样核验官方详情，不直接回填正文 |
| P0-3 | 学生字段盘点 | 上游 500 条样本有 `education_level` 225、`level` 369、`employment_type` 500、`experience` 387；`recruiting_program` 为 0；当前没有学生资格标准字段 | 首轮完成，待字段定义 | 先确定字段定义、信号优先级和证据等级，再改解析/数据库，不用模型猜测 |
| P0-4 | 已完成公司的剩余 `pending_recheck` 分类 | 45 家历史完成公司中 32 家仍有待复核记录；已按字段和“有值/无值/历史拒绝/无证据”拆分 | 首轮完成，待官方证据复核 | 优先处理有值但待复核记录；官网无字段不能按解析失败处理 |
| P0-5 | 生产来源矩阵持续刷新方式 | 当前矩阵 dry-run 读取生产库，但 `SOURCE_MATRIX_WRITE_ENABLED` 未在本阶段使用 | 已完成只读快照 | 是否写回台账另行审批，避免盘点阶段引起状态变化 |

### P1：来源与自动队列

| 编号 | 工作 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| P1-1 | Citigroup Workday 全量字段任务 | 官方队列游标约 `64410`，失败 0，尚未有最终末端 dry-run 证据 | `queue_in_progress` |
| P1-2 | JPMorgan Chase Oracle HCM | 10,363 条在招，来源 host 已识别但没有公司级连接器和 20 条官方样本验收 | `source_identified_pending` |
| P1-3 | Apple 官方 API | 3,442 条在招，已记录为 `apple_official_api`，但尚未完成独立适配器和生产验收 | `source_identified_pending` |
| P1-4 | Oliver Wyman Phenom | 190 条在招，来源迹象为 `careers.marsh.com`，尚未完成独立样本和详情验收 | `source_identified_pending` |
| P1-5 | Jefferies Oracle HCM | 158 条在招，来源族已识别，尚未完成连接器和真实样本验收 | `source_identified_pending` |
| P1-6 | Lazard Oracle HCM | 36 条在招，已作为 Oracle HCM 先锋候选，但尚未完成 20 条样本、dry-run 和生产写入 | `source_identified_pending` |
| P1-7 | 注册连接器公司的自动字段队列 | 生产 `JOB_BACKFILL_WRITE_ENABLED=true`，但 `JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED` 未设置；Workday 自动写入已开启，注册连接器自动写入仍需代码路径和实际新岗位样本确认 | 部分确认，待注册连接器验证 |
| P1-8 | Rothschild & Co 来源状态 | 当前矩阵为 `official_custom_or_unclassified / discovery_required`，但生产状态表仍有历史 `official:workday:Rothschild & Co` 记录 | 待做来源复核和孤儿状态审计 |
| P1-9 | 24 家自建/未分类来源探测 | 合计 30,321 条在招岗位，最大缺口集中在 Amazon、Google、Microsoft、Deloitte、Morgan Stanley、Meta、Goldman Sachs | 未开始全量探测；先按岗位量和学生岗位价值排序 |

### P2：性能和服务架构

| 编号 | 工作 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| P2-1 | 主增量同步周期 | `JOBS_SYNC_INTERVAL_MINUTES` 未设置，代码回退到 10 分钟 | 未实施 |
| P2-2 | Web 与后台 worker 拆分 | 当前网站、主同步、官方详情和复核 worker 共用一个 Node 进程 | 未实施 |
| P2-3 | 官方详情调度优化 | 每 6 秒触发一次，但公司完成后冷却 10 分钟；Workday 请求间隔仍为 1,200ms | 未实施 |
| P2-4 | 岗位列表 API | 列表仍携带 description，并使用 offset 和 Node 二次筛选 | 未实施 |
| P2-5 | 服务重启控制 | 最近检查到 2 小时内有 12 次正常停止/启动，未见 OOM，但重启会中断内存中的 worker | 待确认发布流程和拆分方案 |
| P2-6 | root 运行和旧 timer | 生产服务仍以 root 运行，旧岗位 timer 当前未启用 | 待架构改造时一并处理 |

## 5. 第一阶段完成标准与后续入口

本阶段完成标准已满足：

- 所有 75 家当前活跃上游公司都有一条盘点记录。
- 45 家历史完成公司与 30 家未完成公司已明确分开。
- 6 项标准字段有生产覆盖快照，并区分已验证、待复核、历史拒绝和未形成证据。
- 上游学生相关字段已确认存在，但其是否已进入标准化和展示流程被列为独立未完成事项。
- 生产队列、失败队列、服务状态和环境 project ref 已核对。
- 没有执行生产写入或改变岗位生命周期。

后续进入第二阶段前，固定先处理 P0-2、P0-3、P0-4，并对 P1-7 的自动队列写入配置做只读确认。任何公司正式回填仍必须遵守 `job-company-field-connector-runbook.md` 的真实样本、dry-run、只补缺失字段和数据库/API/页面三处验收流程。

## 6. 本次盘点记录

- 阅读了公司字段接入运行手册、公司接入运行手册、全公司字段计划、执行日志和岗位字段交接单。
- 生产只读运行了来源矩阵审计、字段覆盖审计、公司来源台账检查和上游 500 条岗位字段抽样。
- 生产队列检查确认官方状态无失败、无有效租约、失败队列为空；主服务为 active。
- 内容专项审计曾因输出量过大被主动停止，未将其未完成输出写入结论，也未据此修改任何岗位。
- 生产来源矩阵报告文件由本次只读审计生成，作为当前快照保存；岗位和数据库没有被写入。

## 7. 2026-09-02 首轮执行结果

本轮使用生产 `.env.production.local`，脚本先校验 Supabase project ref 为 `weqvdtdjdzmqflhwobec`，随后只读扫描 `collector_feed` 的在招岗位，并请求上游 500 条样本。报告文件：`output/phase1-content-student-field-reasons-production-20260902.json`。

### 7.1 内容质量

本轮实时读取 58,431 条在招岗位、75 家公司：

| 分类 | 数量 | 说明 |
| --- | ---: | --- |
| 正常 description | 58,283 | 清洗后正文长度不少于 160 个字符 |
| 过短 description | 33 | 清洗后 20 至 159 个字符 |
| 极短 description | 73 | 清洗后少于 20 个字符 |
| 缺失 description | 38 | 空值或空白 |
| 证据壳 description | 4 | 只包含采集证据/元数据，不应作为岗位正文展示 |
| 正常 requirements | 4,644 | 清洗后任职要求长度不少于 160 个字符 |
| 过短 requirements | 16,816 | 清洗后 20 至 159 个字符 |
| 极短 requirements | 15,800 | 清洗后少于 20 个字符 |
| 缺失 requirements | 21,171 | 空值或空白 |
| 正常 responsibilities | 168 | 清洗后职责长度不少于 160 个字符 |
| 缺失 responsibilities | 58,263 | 空值或空白 |

`description` 异常内容合计 148 条。`requirements` 和 `responsibilities` 的缺失/过短是独立问题，不能用 description 正常来替代。后续只做官方详情抽样和针对性修复，不因内容异常改变岗位生命周期。同时确认：官方 URL 缺失或无效 0 条、外部岗位 ID 缺失 0 条、在招岗位中被标记为关闭 0 条。

### 7.2 学生岗位信号

当前数据库中能从标题、岗位类型、经验和正文识别到的文本信号数量如下。一个岗位可能同时命中多个信号，这些数字不是岗位去重后的学生岗位总数：

| 信号 | 命中岗位数 |
| --- | ---: |
| Internship / Intern | 1,580 |
| Entry Level | 655 |
| Student | 575 |
| Campus | 335 |
| Analyst Program | 211 |
| Early Career | 113 |
| New Grad | 59 |
| Graduate Program | 35 |
| Co-op | 20 |

上游 500 条样本的结构化字段情况：`education_level` 225、`level` 369、`employment_type` 500、`experience` 387、`valid_through` 143、`remote_type`/`work_arrangement`/`workplace_type` 各 22、`recruiting_program` 0；`status` 500 条均为 `open`，`sync_action` 500 条均为 `upsert`。因此当前只能把这些作为学生岗位候选信号，不能直接宣称“学生可申请”，也不能把标题推导写成官方资格字段。

### 7.3 已完成公司的待复核

45 家历史完成公司中，32 家仍有待复核记录，首轮按字段汇总为：截止日期 968、薪资 909、工作方式 438、地点 132、岗位类型 371、经验 73。待复核记录中同时存在“有值但证据待复核”和“无值但详情/证据待复核”两类，不能直接全量回填；后续优先抽样有值但未验证的记录。

### 7.4 生产运行核验

- Supabase project ref：`weqvdtdjdzmqflhwobec`。
- Web 服务：active；上游岗位接口：HTTP 200，契约版本 `jobs.v1`。
- 公司台账：75 行、75 家活跃公司、无 inactive 行；失败队列为空，连续失败为 0。
- 官方详情配置：批量 100、每轮 3 家、并发 3、请求启动间隔 1,200ms、自动处理开启。
- `JOBS_SYNC_INTERVAL_MINUTES` 未设置，仍使用代码默认 10 分钟。
- `JOBS_HISTORICAL_FIELD_REVIEW_ENABLED=true`，历史复核正在与 Web 进程共存，需在性能阶段确认资源竞争。
- 三个旧的岗位 systemd timer 当前 inactive；后台任务由 Web 进程内 worker 承担。
- 最近两小时观察到多次正常重启；重启会中断内存中的后台任务，但本轮没有看到 OOM 证据。

### 7.5 本轮边界

本轮没有执行 `--write`、字段回填、来源矩阵写入、岗位上下架、游标重置或租约强制释放。之前误运行的本地 `audit:job-fields` 和 `audit:connector-backfill` 使用开发 `.env.local`，不纳入本报告结论。
