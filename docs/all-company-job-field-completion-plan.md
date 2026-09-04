# 全公司岗位字段完善计划

更新时间：2026-09-05  
状态：Wells Fargo、Accenture 已完成生产字段回填与严格回归；MongoDB、Okta、Elastic、Duolingo、Roblox 五家 Greenhouse 公司已于 2026-09-05 完成生产回填与验收；BlackRock 已于同日完成官方详情接入与生产回填；按来源族逐批执行，不做全站批量回填

## 1. 目标与边界

目标不是让每个岗位的每一项都“有值”，而是让平台展示的每项字段都有可追溯的官方证据。对当前上游 `collector_feed` 中的全部公司，逐步完善以下字段：

| 字段 | 标准存储 | 可以展示的前提 |
| --- | --- | --- |
| 地点 | `region`、`location_source` | 官方地点字段或官方详情页证据 |
| 工作方式 | `workplace_type` | 明确的 remote / hybrid / onsite 官方信息 |
| 岗位类型 | `employment_category` | 实习、校招、社招或未知，来源可追溯 |
| 经验要求 | `experience_min_years`、`experience_max_years`、`experience_text` | 只接受官网明确的工作经验要求 |
| 薪资 | `salary_range`、`salary_source` | 同时具备币种和金额的官方信息 |
| 截止日期 | `valid_through`、`deadline_source` | 官方字段或详情正文的明确截止日期 |
| 证据 | `field_evidence` | 每个已验证字段带来源 URL、来源层、核验时间和状态 |

以下原则贯穿所有批次：

- `collector_feed` 是进入 Liorvix 的同步通道，不是岗位的真实招聘系统；必须按 `source_url`、官方域名和上游 `company_id` 判定真实来源族。
- 不以标题、发布时间、模型推断或没有金额/币种的文本补全经验、薪资、截止日期。
- 字段解析失败、403、429、超时和官网结构变化，只能让字段进入待复核，不能改变 `is_active` 或 `is_closed`。
- 只补缺失字段；不全量删除重建，不更换现有岗位 ID，不影响收藏、投递和 AI 匹配。
- 每次写入必须以生产环境为目标做显式确认、dry-run、写入后生产库/API/页面三处核验。完整要求以 [`job-company-field-connector-runbook.md`](job-company-field-connector-runbook.md) 为准。

## 2. 当前来源分层

### A. 已完成生产回填的官方 ATS 来源

Greenhouse、Ashby 与 Lever 的以下 31 家已完成生产抽样、全量只补缺失字段的回填，以及数据库、公开 API、岗位页三处验收。Cloudflare 的经验字段生产修复也已完成。它们进入常规观察，不应再次盲目全量回填。

| 来源族 | 已确认公司 | 当前处理方式 |
| --- | --- | --- |
| Greenhouse | Cloudflare、Stripe、Datadog、Coinbase、Asana、Brex、Databricks、Figma、GitLab、Point72、Reddit、Robinhood、Twilio、Discord、TPG、Bridgewater Associates、General Atlantic、MongoDB、Okta、Elastic、Duolingo、Roblox | `src/lib/job-connectors/greenhouse.ts` + 详情页补充 |
| Ashby | OpenAI、Cursor、Notion、Perplexity、Ramp、Vanta、Runway、Linear | `src/lib/job-connectors/ashby.ts` + 详情页补充 |
| Lever | Palantir | `src/lib/job-connectors/lever.ts` + 详情页补充 |
| 通用官方详情 | BlackRock | `job-official-detail.ts` JSON-LD 正文提取 + `backfill-official-job-details.ts` |

Cloudflare 已完成经验字段的生产回填验证，可作为同族连接器的验收样板，但不等同于其他 Greenhouse 公司无需验证。

### B. 生产来源矩阵（2026-09-01）

生产美国服务器已于 2026-09-01 重新运行 `audit:company-source-matrix`。当前 `collector_feed` 有 75 家活跃公司、57,389 条在招岗位；下表是后续实施的唯一排期依据，而不是按公司名称随意处理。

| 来源族 | 剩余公司与在招岗位量 | 处理状态 | 下一步 |
| --- | --- | --- | --- |
| Phenom | Boston Consulting Group 250、Oliver Wyman 190 | 已识别来源族，需适配器验证 | 先做 BCG 先锋，再处理 Oliver Wyman |
| Oracle HCM | Lazard 41、Jefferies 135、JPMorgan Chase 9,737 | 已识别来源族 | 先以 Lazard 验证列表/详情/ID，再扩展 |
| Workday | Citigroup 及其余待验收公司 | 已识别来源族；Wells Fargo、Accenture 已完成字段回填并进入常规观察 | 按公司独立游标继续处理；新公司先做真实样本和 dry-run |
| Apple 官方 API | Apple 3,449 | 已确认独立官方 API | 单独实现并验收详情补全 |
| 自建/未分类 | Amazon 18,177、Google 2,416、Microsoft 1,369、Deloitte 1,151、Morgan Stanley 1,110、Goldman Sachs 797、Meta 773，以及其余 17 家 | `discovery_required`，共 28,288 条 | 仅做官方源探测和台账；未确认前不回填 |

已完成的 Greenhouse、Ashby 公司不在上表的“剩余”范围内。上游岗位量每天会自然变化，执行时以该公司当次 dry-run 的数量为准。

### 当前可执行队列

这张表是实际推进顺序。每一行的“进入条件”没有达成时，只修当前公司或连接器，不提前启动下一行。

| 顺序 | 公司 / 来源族 | 本轮动作 | 进入下一项的条件 |
| --- | --- | --- | --- |
| 1 | BCG / Phenom | 已完成生产字段回填、20 条公网详情抽样和误关闭保护；记录三次独立同步观察 | 生产库、公开 API、岗位页一致；三个实际同步周期无异常下降 |
| 2 | Oliver Wyman / Phenom | 在 BCG 观察期内只登记官方 URL、ID、分页与 20 条真实样本，不写生产字段 | BCG 的关闭详情策略在实际同步中稳定；Oliver Wyman 单独验收通过 |
| 3 | Lazard、Jefferies / Oracle HCM | 先只读探测，再实现低量先锋连接器与字段回填 | 两家公司分页、详情、稳定 ID 和生命周期保护通过 |
| 4 | Houlihan Lokey 至 Adobe / Workday | 以低岗位量公司建立 Workday 协议层，按公司保存 tenant / host 配置 | 前五家逐家完成抽样与三次稳定同步 |
| 5 | 其余 Workday、Apple | 对高量公司分段回填；Apple 使用独立官方 API | 每家公司先 20 条抽样，禁止直接全量 |
| 6 | 24 家未识别来源 | 只完成官方源探测、台账和优先级排序 | 确认官方源后回归上表对应来源族；未确认的只进入待复核 |

### C. 已确认但需要独立适配的官方来源

| 来源族 | 已知公司 | 已知处理特点 |
| --- | --- | --- |
| 官方 JSON API | Apple | 列表 API + `jobDetails/{id}` 官方详情接口 |
| Phenom | Boston Consulting Group、Oliver Wyman | 列表分页，详情页补正文和缺失结构化字段 |
| Oracle HCM | Lazard | 列表源 + 详情页；个别官方详情可能没有正文 |

### D. 仍在上游、但真实来源族尚未登记的公司

当前北美科技目录中已知还包括 Adobe、Amazon、Discord、Duolingo、Elastic、Google、Intel、Meta、Microsoft、MongoDB、NVIDIA、Okta、Reddit、Robinhood、Roblox、Runway、Twilio 等。上游还包含非科技公司。它们不能仅因上游标记为 `official` 就假定是同一种接口；必须先通过官方招聘 URL 探测后归入下文的来源批次。

可能出现的来源族包括：公司自建 JSON/API、Workday、SmartRecruiters、iCIMS、Taleo、Phenom、Oracle HCM、Greenhouse、Ashby、Lever，以及仅能从官网详情页取得字段的自建站点。

## 3. 先完成的基础台账（批次 0）

### 目标

让每一家上游公司都有一个稳定、可排序、可复查的来源记录。没有完成台账的公司不进入字段回填。

### 要做的工作

1. 新建/维护公司来源矩阵，字段至少包括：公司名、上游 `company_id`、在招岗位数、主 `source_url` 域名、官方 careers URL、来源族、外部岗位 ID 字段、详情是否必须、地区范围、时区、负责人、最后核验时间和状态。
2. 将当前管理端的字段质量审计扩展为六项：地点、工作方式、岗位类型、经验、薪资、截止日期，并按 `field_evidence` 的 verified / pending_recheck / rejected_legacy 状态统计。
3. 为每家公司记录“有官方字段的覆盖率”和“官网本身没有该字段的比例”；二者不能混为缺陷。
4. 生成来源探测报告：按公司抽取不超过 20 条真实岗位，识别官方域名、ATS 特征、稳定外部 ID、列表与详情可获得的字段。
5. 上游按公司定向同步仅在 `JOBS_FEED_COMPANY_FILTER_ENABLED=true` 时启用；未开启时只做只读盘点和官方源验证，不能用全量同步替代单家公司测试。

### 交付物与完成标准

- `公司-来源矩阵` 覆盖所有当前活跃上游公司，未知来源也必须明确标为 `discovery_required`。
- 管理端/审计脚本可以按公司查看六类字段的总量、已验证、待复核和历史拒绝数。
- 每家公司都有一个可复跑的源探测记录，且不含 cookie、密钥或验证码绕过信息。
- 本批不回填业务字段，不修改岗位状态。

## 4. 以来源族为单位的实施批次

### 批次 0.5：完成当前 ATS 收尾和可复用扩展

**范围：** 已完成：Palantir、Point72、Reddit、Robinhood、Twilio、Discord、TPG、Bridgewater Associates、General Atlantic、Runway、Linear。

**顺序：**

1. Palantir、Runway、Linear 已各自完成 `--all` 和最终 dry-run 候选数为 0 的生产验收。
2. 后续新增 Greenhouse、Ashby 或 Lever 公司仍沿用相同的公司级验收门槛。

**完成条件：** R1 的 11 家均已完成独立生产验收。任何外部 ID 匹配率异常、官网结构差异或详情失败率异常都只暂停当前公司。

### 批次 1：Phenom 先锋来源族

**范围：** Boston Consulting Group（250 条）和 Oliver Wyman（190 条）。

**执行顺序：** 先只处理 BCG 的公开官方 Phenom 列表和详情；通过后再处理 Oliver Wyman。没有把 Phenom 当作 Greenhouse/Ashby 的变体，列表分页、详情 URL、稳定 ID、字段路径各自单独测试。

**字段策略：**

- 地点、工作方式、岗位类型优先读取结构化列表字段；多地点保留全部官方原值后再做地区归一化。
- 经验优先读取结构化字段，其次官方详情和正文；只识别明确年限，保留原文。
- 薪资仅使用 ATS 的 compensation 字段或详情中的明确范围。
- 截止日期仅使用 ATS 明确字段或详情中的明确标签；不从发布时间或更新时间推导。
- 当详情页缺少与 URL 外部 ID 对应的有效岗位数据，且正文明确显示岗位已招满、关闭或不可申请时，排除该岗位的字段回填并单独报告；有效详情旁的静态过期组件不构成关闭证据。不因这一步直接下架平台现有岗位。
- 必要时使用官网 canonical URL 替代通用 `boards.greenhouse.io` 链接，但不改变幂等外部 ID。

**完成标准：** 每家至少 20 条真实样本；地点和岗位类型准确率不低于 95%；所有显示的薪资、截止日期、经验均有官方 URL 证据；连续 3 个同步周期无异常岗位数下降。

### 批次 2：Oracle HCM 先锋来源族

**范围：** Lazard（41 条）、Jefferies（135 条）、JPMorgan Chase（9,737 条）。

**执行顺序：** Lazard 是低风险先锋，先验证官方列表、详情正文缺失、外部 ID 与分页；Jefferies 次之。两家都通过后，才允许 JPMorgan Chase 进入 20 条样本写入。JPMorgan 的岗位量大，任何一项前置验收不通过都不能执行 `--all`。

**完成标准：** 官网数量/分页能对账；详情不可用的岗位仅标记为待复核；三个公司都不因字段任务改变岗位上下架状态。

### 批次 3：Workday 先锋来源族

**范围：** 19 家已识别 Workday 公司；岗位数量以最新生产来源矩阵为准。

**执行顺序：** 按风险从低到高处理：Houlihan Lokey、Bain Capital、Apollo、Carlyle、Adobe，随后再按岗位量由低到高扩展其余公司。每家公司使用自己的官方 Workday host、tenant 与站点配置；不能拿一家公司 URL 拼接到另一家公司。

**适配器要求：** 先解决 Workday 的分页、详情请求、稳定 requisition ID、多地点和远程字段；再在单家公司中验证经验、薪资、截止日期只取官方明确字段。适配器通用的是协议层，配置和字段证据必须公司隔离。

**扩展门槛：** 每家公司通过完整生产验收后才进入下一家；当前已完成 16 家 Workday 公司，Wells Fargo 已通过官方来源和 20 条真实样本验收，剩余岗位由独立队列继续处理。

### 批次 4：官方 JSON/API 与公司自建公开 API

**范围：** Apple 已确认；Amazon、Google、Microsoft、Meta、Adobe、NVIDIA、Intel 等只有在批次 0 证实存在稳定官方公开接口后进入本批。

**执行方式：** 每个 API 作为独立适配器，不把不同公司的 JSON 结构强行抽象为同一个解析器；共用的仅限字段清洗、证据格式、标准化、幂等同步和生命周期保护。

**字段策略：**

- 使用官方列表接口取得稳定岗位 ID、状态和结构化地点。
- 对详情接口补充岗位描述、经验、薪资、截止日期及多地点信息。
- 记录列表与详情 payload 的版本/字段可用性；详情请求失败标记为 `detail_unavailable`，不关闭岗位。

**完成标准：** 官方 reported total 与采集结果对账；外部 ID 重复为 0；详情补齐后关键正文完整率不低于 99%，字段仅在有来源时展示。

### 批次 5：其余企业 ATS（SmartRecruiters、iCIMS、Taleo 等）

**范围：** 仅限批次 0 探测后证实使用这些公开 ATS 的公司。

**执行方式：** 一次只扩展一个来源族。先选一家先锋公司实现列表分页、详情抓取、稳定 ID 与关闭状态识别，再接入同类公司配置。

**字段策略：**

- 列表层用于数量、状态、稳定 ID、基础地点；详情层用于经验、薪资、截止日期和正文。
- 使用每家公司自己的官方 host 白名单；不要把供应商页面、搜索结果页或第三方聚合页作为字段证据。
- 将地区过滤放在官方原始地点保留之后，支持一岗多地与远程岗位。

**完成标准：** 每个来源族至少 1 家先锋公司与 20 条真实样本通过，随后每家都完成自己的 20 条抽检；分页提前结束、结构变化、403/429 都能被报告且不会触发全公司下架。

### 批次 6：官网详情页补全型来源

**范围：** 批次 0 确认没有稳定公开 API/ATS 列表字段，但能从公司官方岗位详情页获得可信字段的公司。

**执行方式：** 保持上游岗位的外部 ID 和生命周期，只建立有界的详情补全任务。先对字段缺失岗位运行；详情页成功后才写入缺失字段。

**字段策略：**

- 地点、岗位类型、经验、薪资、截止日期逐字段解析并独立保存证据。
- 网页只出现技能名、福利说明、模糊时间或地区名称时不填入标准字段。
- 对动态渲染、登录、验证码、反爬页面不绕过；记录 `blocked` 或 `detail_unavailable` 并保留原岗位。

**完成标准：** 成功详情页的已展示字段 100% 可回链到原页面；失败原因有统计；失败率超过阈值时暂停该公司而非扩大重试。

### 批次 7：来源不稳定、无官方证据或历史脏数据

**范围：** 无法确认官网来源、仅有第三方链接、字段证据为 `rejected_legacy`、或上游内容与官网不一致的岗位。

**处理方式：**

- 隐藏无官方证据的薪资、截止日期和经验字段，保留岗位本身与审计状态。
- 仅当上游明确关闭或官网持续确认关闭时更新岗位状态；字段异常绝不作为下架理由。
- 建立待复核队列，按岗位量、用户访问量、字段缺失风险和来源稳定性排序，不承诺人工补齐没有官方来源的数据。

**完成标准：** 所有历史异常字段均可说明为何隐藏；没有因字段清洗造成的岗位数量下降。

## 5. 每一家公司的固定执行卡

任何公司进入一个批次时，都按下面顺序完成，不能跳步：

1. **登记：** 在来源矩阵锁定上游 `company_id`、官网 careers URL、官方 host、来源族、地区范围和外部 ID。
2. **真实样本：** 采集最多 20 条官方真实岗位，覆盖普通岗位、实习/校招、多地点、远程、无经验和字段缺失情况。
3. **解析：** 打印原始字段、清洗后正文、标准化字段和字段证据；先添加脱敏 fixture 与测试。
4. **dry-run：** 输出 received、parsed、normalized、filtered、failed、匹配数、候选更新数和六项字段覆盖率。
5. **小范围写入：** 只补缺失字段，以 `source_system + company + external_job_id` 或稳定官方 URL 幂等匹配，并保持状态不变。
6. **生产验收：** 确认目标 Supabase project ref 后，从生产数据库、公网 API 和实际岗位页面各抽样验证。
7. **观察：** 连续 3 个同步周期稳定后，标记为常规来源；否则停留在灰度状态并记录失败原因。

## 6. 排期与优先级

不按照公司名称机械排序，使用以下优先级：

1. 已确认来源 + 活跃岗位量高 + 字段缺口大。
2. 同一来源族可复用，且先锋公司已通过验收。
3. 用户访问/收藏量高的公司。
4. 来源稳定、官方详情可得、可以可靠对账的公司。
5. 来源不稳定或无官方证据的公司最后处理。

建议节奏是每轮只推进一个来源族，且每个来源族的先锋公司先完成全流程。一个批次结束后，更新来源矩阵和字段覆盖率报告，再选择下一个批次；不要同时对所有公司做回填。

### 实施节奏与交付物

| 执行轮次 | 可开始的范围 | 本轮交付物 | 允许进入下一轮的条件 |
| --- | --- | --- | --- |
| R1 | 批次 0.5 | 已完成 11 家可复用 ATS 的公司级验收记录，包括 Runway、Linear | 已达到；下一轮进入 Phenom 先锋公司 BCG |
| R2 | 批次 1 | Phenom 连接器、fixture、两家公司执行记录 | BCG 与 Oliver Wyman 的解析/分页/详情均稳定 |
| R3 | 批次 2 | Oracle HCM 连接器、Lazard/Jefferies 验收记录 | 低量先锋通过后才允许处理 JPMorgan Chase |
| R4 | 批次 3 的前十五家 | Workday 连接器、十五家公司配置和验收记录 | 已完成；已进入常规队列观察 |
| R5 | 剩余 Workday、Apple | 高量 Workday 的分段回填记录；Apple 独立适配器 | 每个公司均遵守 20 条样本后才 `--all` |
| R6 | 自建/未分类 24 家 | 来源探测台账、官方 host 与外部 ID 结论 | 仅已确认官方来源的公司进入相应来源族；其余保持待复核 |

## 7. 全局验收与运行指标

| 指标 | 目标 | 不达标时动作 |
| --- | --- | --- |
| 公司来源台账覆盖 | 100% 活跃上游公司有状态 | 未知标记 `discovery_required`，不进入回填 |
| 地点、岗位类型准确率 | 每家公司抽样不低于 95% | 修解析/归一化规则并重新 dry-run |
| 已展示字段证据 | 100% 有官方 URL 和状态 | 隐藏无证据字段，禁止推断补值 |
| 外部 ID 重复 | 0 | 停止该公司写入，先修幂等键 |
| 岗位数量异常下降 | 0 起因于字段任务 | 停止该公司任务，保留既有岗位 |
| 详情页失败 | 按来源和错误分类可追踪 | 403/429/超时进入待复核，不下架 |
| 生产验收 | 数据库、API、页面三处一致 | 不一致即不标记完成 |

## 8. 本计划完成后的状态

完成不是“每个字段 100% 都有内容”，而是：

- 每一家上游公司都已归入一个已确认来源族或明确待探测状态。
- 所有已展示的地点、工作方式、岗位类型、经验、薪资和截止日期都有官方证据。
- 官网没有提供的字段保持不展示，且用户不会看到历史脏数据或模型猜测。
- 公司级字段缺口、来源健康和待复核原因可审计，任一来源变化只影响该公司/来源族，不影响全站岗位生命周期。
