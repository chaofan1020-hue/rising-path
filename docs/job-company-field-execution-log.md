# 公司岗位字段执行记录

本记录对应 [`all-company-job-field-completion-plan.md`](all-company-job-field-completion-plan.md)。它记录真实运行结果，不以测试环境或历史快照代替生产验收。

## 2026-09-20：Wave A 工厂第十五家 DoorDash

执行位置：上游采集器 `/opt/global-jobs`。公司 ID `42571797-24cc-4915-b99d-9a127059cd43`，完整源 `68defe69-084f-4572-8388-b3afc3e0563b`。只给现有 `GreenhouseConnector` 增加 `board_tokens` 多看板去重，Airbnb / Lyft 的 `board_token` 路径保留。未改 IBM / Amazon / Workday / Salesforce / Oracle 连接器。未把 Wolt / Deliveroo 并进 DoorDash。美国站只作为 Feed 消费者，主 Feed 游标未重置。

官方源探测（采集器出口，未猜测、未过 WAF）：

- `careers.doordash.com` / `www.doordash.com/careers` / `careersatdoordash.com` HTML 仍是 HTTP 403，不当列表源，也不做验证码/Cookie 绕过。
- 浏览器官网 `https://careersatdoordash.com/job-search` 显示 1–25 of 776，是 CMS listing 行，不是唯一岗位。申请链到 Greenhouse job-board，不是 403 HTML。
- 完整官方列表是公开 Greenhouse API 五块互斥看板，按 job id 去重：`doordashusa` 462、`doordashcanada` 34、`doordashmexico` 23、`doordashaustralia` 32、`doordashindia` 20，合计唯一 ID **571**，跨板重复 0。`doordashglobal` 存在但 n=0。旧探测用的 `doordash` / `doordashus` / `doordashinc` 是错 token。
- 稳定外部 ID 为 Greenhouse job id。申请 URL `https://job-boards.greenhouse.io/{board}/jobs/{id}`。
- Dry-run 571/571，`source_complete=true`，`source_count_basis=complete_official_list`，`source_board_count=5`。20/20 样本有 title、地点、部门、官方 GH URL、正文≥300。截止日期/薪资/workplace/employment 官网列表未给，保持空，未猜测。
- 776 不得当覆盖目标，也不能把 HTML 403 标成 incomplete。

采集器验收（UTC 2026-09-20 08:47:07–08:47:19 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招唯一 ID | 571 / 571 / 571 |
| 看板 | usa 462 / canada 34 / mexico 23 / australia 32 / india 20 |
| 覆盖 / 质量 | `coverage=complete`，`quality=ok`（地点 571、部门 571、正文≥300 为 571/571） |
| 关闭 | 新公司，无历史关岗 |
| 目录公司数 / failed | 90 / 0 |

列表 `content=true` 已带全文，无需 `repair_job_details_task`。IBM 1850/1854、Workday 365/365、Airbnb 168、Lyft 178 仍 complete。连接器备份 `app/connectors.py.backup.before-doordash-20260920T084604Z`；Amazon `default_page_size=100`、IBM `default_page_size=1000` 未改。

下一步：观察 3 个成功周期后标 `regular`。美国站若要补官方字段，需登记 host `boards-api.greenhouse.io` / `job-boards.greenhouse.io` / `careersatdoordash.com`，不得重置主 Feed，也不得绕过 careers HTML 403。Wave A 推荐队列已走完。

## 2026-09-20：Wave A 工厂第十四家 Workday（公司）

执行位置：上游采集器 `/opt/global-jobs`。公司 ID `4ca63e6f-d18a-49e4-bf68-d8de054bb951`，完整源 `1d3a6c86-7cad-489e-982d-aaa5efdd6f9a`。未改 IBM / Amazon / Salesforce / Oracle 连接器。DoorDash 仍停放。美国站只作为 Feed 消费者，主 Feed 游标未重置。复用现有 `WorkdayConnector`，没有新 ATS 类。

官方源探测（采集器出口，未猜测）：

- Greenhouse / Ashby / Lever 均 404，不是完整官方列表。
- 官网 `https://www.workday.com/en-us/company/careers/overview.html` 指向 `workday.wd5.myworkdayjobs.com`。公开职位页跳到 `https://workday.wd5.myworkdayjobs.com/Workday`。
- 完整官方列表是 Workday CXS `https://workday.wd5.myworkdayjobs.com/wday/cxs/workday/Workday/jobs`，`total` 365，低于分区帽 2000，无需 `partition_facets`。
- 稳定外部 ID 为 listing `externalPath`（如 `/job/USAVAReston/...` / JR 号）。样本 20/20 有 title、地点、官方 URL。列表无正文、无部门、无截止日期/薪资。
- `Workday_External` / `wd1` / `wd12` 不是当前对外招聘站。

采集器验收（UTC 2026-09-20 08:06–08:07 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招唯一 ID | 365 / 365 / 365 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial`（列表无正文；已排队 1 批有界 Workday 详情 repair，`company_name=Workday`） |
| 关闭 | 新公司，无历史关岗 |
| 目录公司数 / failed | 89 / 0 |

Repair 批次 80 后，正文≥300 为 80 / 365，未扩散到 Salesforce 或其他 Workday 租户。其余描述走现有 beat，不重开覆盖工单。

下一步：观察 3 个成功周期后标 `regular`。美国站若要补官方字段，需登记 host `workday.wd5.myworkdayjobs.com`，不得重置主 Feed。Wave A 推荐队列只剩 DoorDash（官网 403，继续停放）。

## 2026-09-20：Wave A 工厂第十三家 IBM

执行位置：上游采集器 `/opt/global-jobs`。公司 ID `f3866a73-c3d6-4cf5-85c8-6bc0be0f86db`，完整源 `09d27856-e3af-44da-9214-15e25ba10df8`。未改 Amazon / Salesforce / Oracle / Eightfold 连接器。DoorDash 仍停放。美国站只作为 Feed 消费者，主 Feed 游标未重置。未把 IBM 加入 `DETAIL_PAGE_SOURCES`。

官方源探测（采集器出口，未猜测、未过 WAF）：

- Avature `ibmglobal.avature.net` / `careers.ibm.com` 列表 HTML 是 AWS WAF HTTP 202，不能当列表源，也不做验证码/Cookie 绕过。
- 完整官方列表是 IBM Falcon search：`https://www-api.ibm.com/search/api/v1-1/ibmcom/appid/careers/responseFormat/json`，`appid=careers`，`scope=careers2`。采集器出口 `totalresults=1854`。
- 稳定外部 ID 为 Avature `jobId` / `field_text_01`（如 `129622`）。申请 URL `https://careers.ibm.com/careers/JobDetail?jobId={id}`。
- 地点 `field_keyword_19`，部门 `field_keyword_08`，工作方式 `field_keyword_17`。`dcdate` / `effectivedate` 只映射 `PostedDate`。`expiredate` 是 +4 年占位（2030-…），禁止当截止日期。
- 列表 JSON 只有 teaser（约 240–256 字），详情 HTML 仍 WAF，故不跑 HTML repair。
- Falcon `nr` 上限 1000。`page_size=100` 会在相邻页出现窗口重叠（约 50 个重复 ID）。现网连接器默认/上限改为 1000。

采集器验收（UTC 2026-09-20 07:06–07:07 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招唯一 ID | 1854 / 1850 / 1850 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial`（列表 teaser；详情 WAF，不进 HTML 详情源） |
| 关闭 | 新公司，无历史关岗 |
| 目录公司数 / failed | 88 / 0 |

4 条差额与 Oracle 同口径：publisher 总数按 listing 行计数，翻页窗口会重复 4 个 jobId；唯一 ID 1850 + duplicate 4 即可对账，不重开覆盖工单，也不为赶齐去关岗。Dry-run 20/20 有 title、地点、官方 URL；截止日期/薪资均为 0，未猜测。

下一步：观察 3 个成功周期后标 `regular`。美国站若要补官方字段，需登记 host `www-api.ibm.com` / `careers.ibm.com`，不得重置主 Feed，也不得绕过 WAF。按日限额今天不再开第二家。队列下一手 Workday（公司）。DoorDash 继续停放。

## 2026-09-20：Wave A 工厂第十二家 Oracle

执行位置：上游采集器 `/opt/global-jobs`。公司 ID `0891cdb7-e40c-488f-b487-1009ffe8f7f6`，完整源 `99f5ef06-e1b0-45fc-a4af-cc88432113f9`。未改 Salesforce / Eightfold 连接器。DoorDash 仍停放。美国站只作为 Feed 消费者，主 Feed 游标未重置。

官方源探测（采集器出口与本地一致，未猜测）：

- Greenhouse / Ashby / Lever 不是完整官方列表。旧探测里的 `CX_1` / `CX_1001` 不是当前 Oracle 对外招聘站。
- 官网 `https://careers.oracle.com/` 进入 `/en/sites/jobsearch`，站点号是 `CX_45001`。
- 完整官方列表是 Oracle HCM CE `https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions`，`finder=findReqs;siteNumber=CX_45001`，`TotalJobsCount` 2251。
- 稳定外部 ID 为 listing `Id`（如 `333911`）。详情/申请 URL `.../sites/jobsearch/job/{id}` 返回 200，preview 会 302 到同一路径。
- 样本 20/20 有 title、地点、PostedDate；列表有短描述，完整正文走详情 repair。

采集器验收（UTC 2026-09-20 05:38–05:40 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招唯一 ID | 2251 / 2248 / 2248 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial`（列表短描述；已排队 1 批有界详情 repair） |
| 关闭 | 新公司，无历史关岗 |
| 目录公司数 / failed | 87 / 0 |

3 条差额按现有 Oracle HCM 连接器口径：publisher 总数会把重复 listing 算进去，唯一 ID 2248 + duplicate 即可对账，不重开覆盖工单，也不为赶齐去关岗。

下一步：观察 3 个成功周期后标 `regular`。美国站若要补官方字段，需登记 host `eeho.fa.us2.oraclecloud.com` / `careers.oracle.com`，不得重置主 Feed。按日限额今天不再开第三家。队列下一手 IBM，然后 Workday（公司）。DoorDash 继续停放。

## 2026-09-20：Wave A 工厂第十一家 Salesforce

执行位置：上游采集器 `/opt/global-jobs`。公司 ID `499dcae0-9fa8-4247-9bcf-e58dffb7c8d8`，完整源 `2a7b2348-3a31-425d-8b47-e480a40dabd3`。未改 Amazon / BofA / ServiceNow 连接器。DoorDash 仍停放。美国站只作为 Feed 消费者，主 Feed 游标未重置。

官方源探测（采集器出口与本地一致，未猜测）：

- Greenhouse / Ashby / Lever / SmartRecruiters 无完整官方列表。
- `careers.salesforce.com` 对采集器 403，营销页不能当列表源。
- 完整官方列表是 Workday CXS `https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/jobs`，`total` 1481，与官网 `https://www.salesforce.com/company/careers/jobs/` 的 1481 Results 一致。
- 稳定外部 ID 为 Workday `externalPath` / JR 号（如 `JR358512`）。样本 20/20 有 title、地点、官方 URL。

采集器验收（UTC 2026-09-20 05:24 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招 | 1481 / 1481 / 1481 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial`（列表无正文，已排队 1 批有界 Workday 详情 repair） |
| 关闭 | 新公司，无历史关岗 |
| 目录公司数 / failed | 86 / 0 |

下一步：观察 3 个成功周期后标 `regular`。美国站若要补官方字段，需登记新 host `salesforce.wd12.myworkdayjobs.com`，不得重置主 Feed。队列下一手 Oracle / IBM / Workday（公司）。DoorDash 继续停放。

## 2026-09-20：Qualcomm Eightfold 漏抓修复

执行位置：上游采集器 `/opt/global-jobs`。备份 `app/connectors.py.backup.before-ef-retry-20260920T052359Z`。未重开覆盖工单，不完整快照没有关岗。

根因：2026-09-19 16:05 UTC 起 Qualcomm 连续 incomplete。Eightfold PCS 会 429，空页按 offset 继续会直接跳过该窗，`sort_by=relevance` 又没有 timestamp 第二遍。最新一轮 1983 / 2013，在招仍 2014，未关闭。ServiceNow 646/646、Morgan Stanley Eightfold 1323/1323 仍 complete。

代码：

- Eightfold 列表请求对 429/5xx/空页做有界重试。
- 第一排序抓不齐时，自动补 `timestamp` / `relevance` 另一遍。
- Qualcomm 源配置补 `listing_retry_attempts=5`、`request_delay=0.15`（`connector_config` 是 json 不是 jsonb，合并时要先 `::jsonb`）。

采集器验收（UTC 2026-09-20 05:24–05:27 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招 | 2013 / 2013 / 2013 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial` |
| ServiceNow / Morgan Stanley | 仍 646/646、1323+124 Taleo，complete |
| 目录 / failed | 随后 Salesforce 接入后为 86 / 0 |

下一步：Qualcomm 继续观察满 3 个成功周期。不把美国站地区过滤数当成覆盖。

## 2026-09-18：ServiceNow SmartRecruiters 回归修复

执行位置：上游采集器 `/opt/global-jobs`。未改 Amazon / BofA / Wave A 其它连接器，未重开覆盖工单。DoorDash 仍停放。美国站只作为 Feed 消费者，主 Feed 游标未重置。

根因：2026-09-17 15:30 UTC 的 `discover_financial_sources` 从职业页链出了 `jobs.smartrecruiters.com/ServiceNow` 和 `www.smartrecruiters.com/?utm_source=...`，并把已验证的完整源 `careers.smartrecruiters.com/ServiceNow` 标成“重复详情源”停用。UTM 源没有 company slug，连接器把 query 拼进 `/v1/companies/{company}/postings`，官方计数变成 404 / `unavailable`。

采集器代码（备份 `*.backup.before-sr-slug-20260918T040714Z`）：

- `SmartRecruitersConnector` 只接受 `[A-Za-z][A-Za-z0-9_-]{1,79}` 的 company identifier。
- 发现层丢掉无 token 的 SmartRecruiters 营销 URL，并为 board 写入 `company`。
- 发现任务不再停用 `completeness_source=true` 的源，也不再把“同一 token 的另一个 board host”当成详情页重复。

数据：重新启用完整源 `175eb5a0-cdee-45ac-b751-17a9e5ab09e4`；停用 UTM 源和重复 board。不删岗位。

采集器验收（UTC 2026-09-18 04:10–04:11 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`complete_official_list` |
| 官方 / 发现 / 在招 | 645 / 645 / 645 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial`（列表无正文，走 repair） |
| 关闭 | 完整快照下关闭 29 条不在官方列表中的岗位；总记录仍 679，未删除 |
| 目录公司数 / failed | 85 / 0 |

公网抽样：`https://liorvix.com/api/jobs?company=ServiceNow` 目标地区 272 条，抽样仍 `is_active=true`。

下一步：Morgan Stanley 只按 Eightfold 计覆盖；Taleo/public_feed 实习岗不得因完整源切换被关掉。队列仍是 Salesforce / Oracle / IBM / Workday。DoorDash 继续停放。

## 2026-09-18：Morgan Stanley Eightfold 分页修复

执行位置：上游采集器 `/opt/global-jobs`。备份 `*.backup.before-ms-eightfold-20260918T054425Z`。未改 ServiceNow 连接器，未启动 Salesforce。Taleo 不绕验证码。

根因：Eightfold PCS 每页最多 10 条；按时间戳链式翻页会在窗口滑动时漏行，上一轮 1313 / 1317。本地并发按 `start=0,10,20...` 一次可抓全 1316 / 1316，唯一 ID 与 ATS ID 无碰撞。

代码：

- Eightfold 改为固定 offset 翻页，中空页不提前结束；若仍短于官方总数，再补一轮 `relevance`。
- 完整快照只关闭完整源自己的 `source_type` 岗位，避免 Eightfold 完整后误关 Taleo 实习岗。

采集器验收（UTC 2026-09-18 05:44–05:47 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / Eightfold 在招 | 1316 / 1316 / 1316 |
| 覆盖 / 质量 | `coverage=complete`，`quality=ok` |
| Taleo public_feed | 仍 124 条 OPEN，24 条 CLOSED，未动 |
| Eightfold 关闭 | 完整快照下关闭 48 条不在当前官方列表中的 Eightfold 岗；未删记录 |
| ServiceNow | 仍 645 / 645 complete |
| 目录 / failed | 85 / 0 |

下一步：观察满 3 个成功周期后再标 regular。队列下一手 Salesforce。DoorDash 继续停放。

## 2026-09-18：Morgan Stanley 完整源收口（未完成覆盖）

执行位置：上游采集器。`public_feed` 的 `completeness_source` 改为 false；Eightfold 仍是唯一完整源。124 条 Taleo（`morganstanley.tal.net`）实习/项目岗与 Eightfold 外部 ID 无交集，保持在招，不关闭。

随后一次 crawl（UTC 04:17–04:19）`partial`：Eightfold 报 1317，实际发现 1313，差 4 条，`source coverage not verified; no roles were closed`。在招仍 1488 = Eightfold 1364 + public_feed 124。质量变为 `ok`。

下一步：先查 Eightfold PCS 分页为何少 4 条，禁止为赶覆盖关掉 Taleo。未完成前不开始 Salesforce。

## 2026-09-17：Wave A 工厂第十家 ServiceNow

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `9c0f3615-d867-49ae-9515-52dea998a56e`，来源 `175eb5a0-cdee-45ac-b751-17a9e5ab09e4`。未改 Broadcom / Dell / AMD 连接器，未重开覆盖工单。DoorDash 仍停放。用户要求加速扩公司数量；ServiceNow 是已有 SmartRecruiters 连接器的稳定 ATS。现网 `ref` 实际是字符串 URL，旧代码按 dict 取 `.url` 会崩。已备份 `connectors.py` 后只修 URL/地点映射，canonical URL 使用 `https://jobs.smartrecruiters.com/ServiceNow/{id}`。

官方源探测：Greenhouse / Ashby / Lever 404。完整官方列表是 `https://api.smartrecruiters.com/v1/companies/ServiceNow/postings`，`totalFound` 639。稳定外部 ID 为 posting `id`（如 `744000149976740`）。申请页 `careers.smartrecruiters.com/ServiceNow/{id}` 会 302 回列表，不以申请壳当 canonical。

采集器验收（UTC 2026-09-17 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`complete_official_list` |
| 官方 / 发现 / 在招 | 639 / 639 / 639 |
| 唯一外部 ID | 639 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial` |
| 正文 ≥300 / 地点 / 部门 | 列表无正文 / 639 / 560 |
| 详情已抓 | 列表不含 jobAd 正文，缺描述走质量/repair，不关岗 |
| 目录公司数 / failed | 85 / 0 |

字段口径：地点用 city / region / country 拼接（如 `Austin, Texas, us`），不猜全称。截止日期列表没有 `validThrough`，保持空。非目标地区由美国站过滤。

下一步：观察 3 个成功周期后标 `regular`。队列下一手 Salesforce / Oracle / IBM / Workday（公司）。DoorDash 继续停放。

## 2026-09-17：Wave A 工厂第九家 Broadcom

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `e5b346e9-c90d-4515-b6b8-e510c5ce6cf4`，来源 `f4cae51b-da88-4dd3-b1d0-35f2e21be17b`。未改 Microsoft / Shopify / Airbnb / Lyft / Uber / Cisco / Qualcomm / AMD / Dell 连接器，未重开覆盖工单。DoorDash 仍停放。Broadcom 走已有 Workday 连接器，不是新的高风险自定义源。

官方源探测：Greenhouse / Ashby / Lever 无完整源。完整官方列表是 Workday `https://broadcom.wd1.myworkdayjobs.com/wday/cxs/broadcom/External_Career/jobs`，`total` 367。稳定外部 ID 为 `externalPath`。Canonical URL 为 `https://broadcom.wd1.myworkdayjobs.com/External_Career/job/...`。

采集器验收（UTC 2026-09-17 02:29 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招 | 367 / 367 / 367 |
| 唯一外部 ID | 367 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial` |
| 正文 ≥300 / 地点 / 部门 | 列表无正文 / 367 / 0 |
| 详情已抓 | Workday 列表不含详情，缺描述走质量/repair，不关岗 |
| 目录公司数 / failed | 84 / 0（随后 ServiceNow 接入后为 85） |

字段口径：地点保留 Workday 官方 location 原文（如 `USA-CA San Jose Innovation Drive`）。截止日期列表没有结构化字段，保持空。印度、新加坡等地由美国站地区过滤丢弃。

美国站：已增加 Broadcom 官方 host `broadcom.wd1.myworkdayjobs.com` 字段规则。主 Feed 游标未重置。Workday 详情仍走现有 `myworkdayjobs.com` 官方详情队列。

## 2026-09-17：Wave A 工厂第八家 Dell Technologies

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `0491d61b-3a50-4027-9508-e0fc65240894`，来源 `c81820cc-7b26-4753-b667-37da992c0bf8`。未改 Microsoft / Shopify / Airbnb / Lyft / Uber / Cisco / Qualcomm / AMD 连接器，未重开覆盖工单。DoorDash 仍停放。用户同意把剩余顺序改成 Dell → Oracle → Broadcom；Dell 走已有 Oracle HCM 连接器，不是新的高风险自定义源。

官方源探测：Greenhouse `dell` / `delltechnologies` 均 404。`jobs.dell.com` 跳到 Oracle Candidate Experience `https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers`。完整官方列表是 `https://iawmqy.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions`，`siteNumber=CX_1`，`TotalJobsCount` 466。稳定外部 ID 为官网 `Id`（如 `295350`、`R286431`）。Canonical URL 为 `https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job/{id}`。

采集器验收（UTC 2026-09-17 02:24–02:26 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招 | 466 / 466 / 466 |
| 唯一外部 ID | 466 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial` |
| 正文 ≥300 / 地点 / 部门 | 详情 repair 进行中；列表地点 466 / 部门 96 |
| date_posted / employment | 466 / 列表无 JobSchedule，详情补 `Full time` |
| workplace / 带币种薪资 / 截止日期 | 列表 448 `On-site`/`Field` / 详情正文抽取 / 详情 `ExternalPostedEndDate` |
| 详情已抓 | 有界 repair 首批 160 `fetched`，0 关闭、0 错误；其余走定时 beat |
| 目录公司数 / failed | 83 / 0 |
| 仍观察 | Microsoft、JPMorgan Chase（本轮未改这两家） |

字段口径：地点保留官网 `PrimaryLocation` 原文（如 `Round Rock, TX, United States`）。workplace 来自官网 `WorkplaceType`（`On-site` / `Field`），不把 `Field` 猜成 Hybrid。雇佣类型来自详情 `JobSchedule`。截止日期只用官网 `ExternalPostedEndDate`，没有该字段就保持空。薪资列表没有结构化金额，只在详情正文出现带币种金额时由美国站抽取。印度、巴西、以色列、波兰等非目标地区由美国站地区过滤丢弃。

美国站：已部署 Dell 官方 host `iawmqy.fa.ocs.oraclecloud.com` / `enterpriseplatform.dell.com` / `jobs.dell.com` 字段规则，以及已有 Oracle HCM 连接器配置。主 Feed 游标未重置。公网 `/api/jobs?company=Dell%20Technologies` 目标地区 **240** 条在招；抽样 `/api/jobs/86795`（Round Rock，Signal Integrity Principal Engineer）地点/工作方式/雇佣类型 `official_payload` / `verified`，薪资 `$166,600 - $185000` 来自官网正文，截止日期为空，正文 3276 字，`is_active=true`，`is_closed=false`。`/api/jobs/86864` 地点 `Round Rock, TX, United States; Hopkinton, MA, United States`，雇佣类型 `Full time`。Shopify / AMD / Uber 公网抽样仍在招。

下一步：观察 Shopify / Airbnb / Lyft / Uber / Cisco / Qualcomm / AMD / Dell Technologies 各 3 个成功周期后标 `regular`。队列下一手是 Oracle。DoorDash 继续停放。

## 2026-09-16：Wave A 工厂第七家 AMD

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `5360af70-dfe6-40e3-9f73-af6621d56360`，来源 `2a2dfca8-0b6b-4eca-8590-4352259fe6ed`。未改 Microsoft / Shopify / Airbnb / Lyft / Uber / Cisco / Qualcomm 连接器，未重开覆盖工单。DoorDash 仍停放。用户要求继续推进下一手；AMD 官方源是 Jibe `/api/jobs`，现网没有现成 Jibe 连接器，因此新增通用 `jibe` 连接器，不是把 AMD 硬塞进 Phenom/Workday/iCIMS。

官方源探测：Greenhouse / Lever 404；SmartRecruiters 空列表；Eightfold `Not Supported`；Workday 各租户 POST 422；iCIMS 搜索页 405 人机验证，不是完整快照源。完整官方列表是 `https://careers.amd.com/api/jobs`，`totalCount`/`count` 1226。稳定外部 ID 为 `req_id`（如 `91544`）。Canonical URL 为 `https://careers.amd.com/careers-home/jobs/{req_id}`。sitemap 1228 条 `/jobs/{id}` 只作交叉核对，不以 sitemap 关岗。分页 `limit=100` 可用，`limit=200` 返回 422。

采集器验收（UTC 2026-09-16 09:16 列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招 | 1226 / 1226 / 1226 |
| 唯一外部 ID | 1226 |
| 覆盖 / 质量 | `coverage=complete`，`quality=ok` |
| 正文 ≥300 / 地点 / 部门 | 1226 / 1226 / 1226 |
| date_posted / employment | 1226 / 1226 |
| workplace / 带币种薪资 / 截止日期 | 736（官网正文抽取 Hybrid/Onsite/Remote） / 894（tags2/tags3 含币种） / 0 |
| 详情已抓 | 列表即含完整正文，1226 `fetched_json`；未因缺字段下架 |
| 目录公司数 / failed | 82 / 0 |
| 仍 incomplete | Microsoft、JPMorgan Chase（本轮未改这两家） |

字段口径：地点只用 `city` / `state` / `country` 完整标签（如 `San Jose, California, United States`），不用 `location_name` 代码 `US,CA,San Jose`。`location_type=LAT_LNG` 是地理编码标记，已改名为 `jibe_location_type`，不映射成工作方式。employment 来自官网 `employment_type`（`FULL_TIME` / `INTERNSHIP` 等）。截止日期官网没有 `applicationDeadline` / `validThrough`，保持空，不猜。薪资 `salary_*_value=0` 丢弃；只保留 tags 里带币种的金额。申请链接是 iCIMS login，不作为 canonical URL。印度、中国内地、台湾、马来西亚等非目标地区由美国站地区过滤丢弃。

美国站：已部署 AMD 官方 host `careers.amd.com` 字段规则，以及 Feed 对 `jibe` 官方 payload 的信任。主 Feed 游标未重置。首轮同步早于规则发布，公网地点曾显示「未注明」；只把 AMD 的 `feed_updated_at` 前移后重放，未重置主游标。抽样 `/api/jobs/85198` 地点 `San Jose, California, United States`、`location_source=official_payload` / `verified`；`/api/jobs/85194` 地点 `Boxborough, Massachusetts, United States`，薪资 `USD $106,470.00/Yr. - USD $152,100.00/Yr.` 来自 `official_description`，截止日期为空，`is_active=true`，`is_closed=false`。Shopify / Qualcomm 公网抽样仍在招。

下一步：观察 Shopify / Airbnb / Lyft / Uber / Cisco / Qualcomm / AMD 各 3 个成功周期后标 `regular`。队列下一手是 Broadcom。DoorDash 继续停放。

## 2026-09-16：Wave A 工厂第六家 Qualcomm

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `d421947d-c5fc-458b-b961-d818b7fa3d3e`，来源 `1f70853b-f384-4e88-878b-024cb73af39b`。未改 Microsoft / Shopify / Airbnb / Lyft / Uber / Cisco 连接器，未重开覆盖工单。DoorDash 仍停放。用户要求继续推进下一手；Qualcomm 走已有 Eightfold 连接器，不是新的高风险自定义源。

官方源探测：Greenhouse / Ashby / Lever 404；SmartRecruiters 空列表；`/api/apply/v2/jobs` 403 `Not authorized for PCSX`。`jobs.qualcomm.com` 跳到 Eightfold `https://careers.qualcomm.com/careers`。完整官方列表是 `https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com`，`count` 2003。稳定外部 ID 为官网 Job ID / `atsJobId`（如 `3094633`）。Canonical URL 为 `https://careers.qualcomm.com/careers/job/{eightfold_id}`。Workday 租户 400/内部错误，不是完整快照源。

采集器验收（UTC 2026-09-16 07:41 第三轮列表 success）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招 | 2003 / 2003 / 2003 |
| 唯一外部 ID | 2003 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial` |
| 正文 ≥300 / 地点 / 部门 | 详情 repair 进行中 / 2003 / 2003 |
| date_posted / employment | 2003 / 0（官网 `type=ATS` 不是雇佣类型，保持空） |
| workplace / 带币种薪资 / 截止日期 | 2003 `onsite` / 详情正文抽取 / 0（无结构化截止字段） |
| 详情已抓 | 有界 repair 已开始，抽样 80/80 `fetched_json`，0 关闭、0 错误；其余走定时 beat |
| 目录公司数 / failed | 81 / 0 |
| 仍 incomplete | Microsoft、JPMorgan Chase（本轮未改这两家） |

字段口径：地点只用 Eightfold `location` / `locations` 完整标签（如 `San Diego, California, United States of America`），不拼接 `standardizedLocations` 碎片。workplace 来自 `workLocationOption`（`onsite`）。`postedTs` 转为 ISO 日期写入 `date_posted`。列表没有正文，不把 listing 标成 `fetched_json`。截止日期官网没有 `applicationDeadline` / `validThrough`，保持空，不猜。薪资只在详情正文出现带币种金额时由美国站抽取。印度、中国内地、台湾、墨西哥、以色列、法国等非目标地区由美国站地区过滤丢弃。

质量尾巴：首轮抓取时 publisher `count` 从 2004 变为 2003（列表尾页已空），已按当前官方总数 2003/2003 对账。详情 repair 与列表 crawl 并行，未因缺正文下架。Eightfold 连接器补了 camelCase（`atsJobId` / `positionUrl` / `workLocationOption`）和 `max_pages`，Morgan Stanley 源配置未改。

美国站：已部署 Qualcomm 官方 host `careers.qualcomm.com` 字段规则，以及 Feed 对 `eightfold` 官方 payload 的信任。主 Feed 游标未重置。公网 `/api/jobs?company=Qualcomm` 目标地区约 386 条在招；抽样 `/api/jobs/84392` 地点/工作方式 `official_payload` / `verified`，薪资 `$191,800.00 - $287,800.00` 来自 `official_description`，截止日期为空，`is_active=true`，`is_closed=false`。Shopify / Airbnb / Lyft / Uber / Cisco 公网抽样仍在招。

下一步：观察 Shopify / Airbnb / Lyft / Uber / Cisco / Qualcomm 各 3 个成功周期后标 `regular`。队列下一手是 AMD。DoorDash 继续停放。

## 2026-09-16：Wave A 工厂第五家 Cisco

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `1d111f89-aa87-4822-91c6-31a5e0cfcdcd`，来源 `297a6a1c-c12f-48b1-af36-f0fe0f36f597`。未改 Microsoft / Shopify / Airbnb / Lyft / Uber 连接器，未重开覆盖工单。DoorDash 仍停放。用户要求按下一手继续；Cisco 走已有 Phenom 连接器，不是新的高风险自定义源。

官方源探测：Greenhouse / Ashby / Lever 404；SmartRecruiters 空列表；Eightfold 404。`jobs.cisco.com` 跳到 Phenom `https://careers.cisco.com/global/en`。完整官方列表是 `https://careers.cisco.com/global/en/search-results` 的 `phApp.ddo.eagerLoadRefineSearch`，`totalHits` 1311。稳定外部 ID 为 `jobSeqNo`（如 `CISCISGLOBAL2016926EXTERNALENGLOBAL`）。Canonical URL 为 `https://careers.cisco.com/global/en/job/{jobSeqNo}`。Workday `cisco.wd5.myworkdayjobs.com` 只是申请页，不是完整快照源。

采集器验收（UTC 2026-09-16 05:47 列表，随后详情 repair）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，`publisher_reported_complete` |
| 官方 / 发现 / 在招 | 1311 / 1311 / 1311 |
| 唯一外部 ID | 1311 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial` |
| 正文 ≥300 / 地点 / 部门 | 1252 / 1310 / 1311 |
| date_posted / employment | 1311 / 1311 |
| workplace / 带币种薪资 / 截止日期 | 1284 / 412 / 采集库 0；美国站已从官网正文回填 359 条 |
| 详情已抓 | 904 `fetched_json`；405 `detail_unavailable`（限流 403）保持在招 |
| 目录公司数 / failed | 80 / 0 |
| 仍 incomplete | Microsoft、JPMorgan Chase（本轮未改这两家） |

字段口径：地点只用 Phenom `location` / `cityStateCountry` 和 `multi_location` 对象的完整标签，不拼接 city/state 碎片，不把 dict 打成字符串。employment 来自列表 `type`（如 `Full time`）。workplace 来自 `RemoteType`（Hybrid / Onsite Only）；空则保持空。截止日期官网没有 `applicationDeadline` / JSON-LD `validThrough`；正文有明确标签 `The application window is expected to close on: MM/DD/YYYY` 时写入，采集库 386 条含该句，美国站目标地区回填 359 条。没有该句的保持空。不把 `targetHireDate` 当申请截止。薪资只在正文出现带币种金额时写入。越南、台湾、中国内地等非目标地区由美国站地区过滤丢弃。过期的官网窗口日期只展示，不因此下架。

质量尾巴：1 条斯洛伐克校招 `2013016` 官网地点为空，保持空，不猜城市。405 条详情被 Cloudflare 限流，保持 `OPEN`。首次 repair 曾因正文页脚 “Job posting may be removed” 误关 165 条；这些详情页仍有匹配的 `jobDetail.jobSeqNo`，已重开并补正文，现网关闭数为 0。公网抽样薪资曾抽出 `0.00 to $159,200.00`，官网原文是 `$125,700.00 to $159,200.00`，记为抽取尾巴，不改生命周期。

美国站：已部署 Cisco Phenom host 规则、board `CISCISGLOBAL`、`RemoteType` 工作方式映射，以及 `application window is expected to close on` 截止日期抽取。主 Feed 游标未重置。生产库 dry-run 后写入 359 条缺失截止日期，未改 `is_active` / `is_closed`。公网 `/api/jobs/83521` 抽样返回 `valid_through=2026-09-10`，证据 `official_description` / `verified`，仍在招。

下一步：观察 Shopify / Airbnb / Lyft / Uber / Cisco 各 3 个成功周期后标 `regular`。队列下一手是 Qualcomm。DoorDash 继续停放。

## 2026-09-16：Wave A 工厂第四家 Uber

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `15ba6e1c-a4bf-467a-bf7a-91d3e599fff9`，来源 `aff2639e-9f5b-4d87-bac7-c5ae9baebb85`。未改 Microsoft / Shopify / Airbnb / Lyft 连接器，未重开覆盖工单。DoorDash 仍停放。用户明确要求接下一家；Uber 走已有 Oracle HCM 连接器，不是新的高风险自定义源。

官方源探测：Greenhouse `uber` / Ashby / Lever 均 404。候选页 `jobs.uber.com/en/jobs/` 与 sitemap `https://jobs.uber.com/en/jobs/sitemap.xml` 公开 506 个唯一 ID，但岗位详情页 Cloudflare 403。完整官方列表是 Oracle HCM `https://iaziqy.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions`，`siteNumber=CX_1`，`TotalJobsCount` 与 sitemap 1:1。Canonical URL 为 `https://iaziqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/UberCareers/job/{id}`。

采集器验收（UTC 2026-09-16 05:15 首轮，05:21 第二轮）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | 两轮均为 success |
| 官方 / 发现 / 在招 | 505 / 505 / 505（首轮 506，第二轮官方少 1 条已按完整快照关闭） |
| 唯一外部 ID | 505 |
| 覆盖 / 质量 | `coverage=complete`，`quality=partial` |
| 正文 ≥300 / 地点 / 部门 | 503 / 505 / 505 |
| date_posted / employment | 505 / 501 |
| workplace / 带币种薪资 / 截止日期 | 84 / 246 / 30 |
| 详情已抓 | 505；1 条 `detail_unavailable` 保持在招 |
| 目录公司数 / failed | 79 / 0 |
| 仍 incomplete | Microsoft、JPMorgan Chase（本轮未改这两家） |

字段口径：地点用 Oracle `PrimaryLocation`（可含多个城市，用 `; ` 连接），不猜城市。employment 来自详情 `JobSchedule`（如 `Full time`）。workplace / 薪资 / 截止日期官网结构化字段大多为空，只在详情正文或官方 payload 明确出现时写入；没有证据保持空。墨西哥、智利、印度、菲律宾、日本、荷兰等地由美国站地区过滤丢弃。

质量尾巴：岗位 `152551` 官方详情正文仅 22 字；`160400` 详情不可用。两者保持 `OPEN`，不因字段失败下架。

美国站：已部署 Uber Oracle host 规则、`JobSchedule` 映射和 board `UberCareers`。主 Feed 游标未重置。公网 `/api/jobs?company=Uber` 已返回目标地区在招岗位（抽样 id `82952`），地点/雇佣类型证据 `verified`，官方 Oracle 链接，`is_active=true`，`is_closed=false`。

下一步：观察 Shopify / Airbnb / Lyft / Uber 各 3 个成功周期后标 `regular`。队列下一手是 Cisco。DoorDash 继续停放。

## 2026-09-16：Wave A 工厂第三家 Lyft

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `4e79d137-c67a-41c2-9c3f-cc8903012a32`，来源 `b8daf7a6-ac08-465e-be63-81e865406d89`。未改 Microsoft / Shopify 连接器，未重开覆盖工单。DoorDash 仍停放。

官方源探测：Greenhouse board `lyft` 公开 JSON 179 个唯一 ID。`boards.greenhouse.io/lyft` 跳到 `www.lyft.com/careers`。岗位 canonical URL 全部是 `https://app.careerpuck.com/job-board/lyft/job/{id}?gh_jid={id}`，详情页 200。元数据只有 `Career Site Category`，没有 Workplace Type / application_deadline。

采集器验收（UTC 2026-09-16 04:14）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，6 秒 |
| 官方 / 发现 / 写入 | 179 / 179 / 179 |
| 唯一外部 ID | 179 |
| 覆盖 / 质量 | `coverage=complete`，`quality=ok` |
| 正文 ≥300 / 地点 / 部门 | 179 / 179 / 179 |
| date_posted | 179 |
| workplace / employment（正文抽取） | 166 / 33 |
| 带币种薪资 / 截止日期 | 12 / 0 |
| 详情 `fetched_json` | 179 |
| 目录公司数 / failed | 78 / 0 |
| 仍 incomplete | 仅 Microsoft |

字段口径：地点只用 Greenhouse `location.name`（如 `New York, NY`），不把 offices 里的另一个城市拼进来；截止日期官网没有结构化字段，保持空；employment / workplace 官网 metadata 未提供，仅在正文出现明确 full-time/internship/remote/hybrid/on-site 时写入。墨西哥等地由美国站地区过滤丢弃。

美国站：已部署 `app.careerpuck.com` / `www.lyft.com` 官方 host 规则和 Greenhouse board `lyft`。主 Feed 游标未重置。公网 `/api/jobs?company=Lyft` 已返回在招岗位，地点证据 `verified`，官方 CareerPuck 链接，`is_active=true`，`is_closed=false`，截止日期为空。

下一步：观察 Shopify / Airbnb / Lyft 各 3 个成功周期后标 `regular`。队列下一手是 Uber。DoorDash 继续停放。当天不再接入第四家。

## 2026-09-16：Wave A 工厂第二家 Airbnb

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `da4155f7-30db-4457-aa8c-d2e4cc95aa3c`，来源 `cf2c8fea-a36a-4ed9-b3a7-fecd1dc1bb95`。未改 Microsoft 连接器，未重开 Amazon / BofA / Accenture 覆盖工单，未改 Shopify 连接器。

官方源探测：Greenhouse board `airbnb` 公开 JSON `https://boards-api.greenhouse.io/v1/boards/airbnb/jobs?content=true`，158 个唯一 ID，岗位 URL 全部在 `careers.airbnb.com/positions/{id}?gh_jid={id}`。元数据只有 `Workplace Type` 和 `Is this job part of ACC?`，没有官方 `application_deadline`。

采集器验收（UTC 2026-09-16 03:52）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，4 秒 |
| 官方 / 发现 / 写入 | 158 / 158 / 158 |
| 唯一外部 ID | 158 |
| 覆盖 / 质量 | `coverage=complete`，`quality=ok` |
| 正文 ≥300 / 地点 / 部门 | 158 / 158 / 158 |
| workplace / date_posted | 158 / 158 |
| 官方 employment / 截止日期 | 0 / 0 |
| 详情 `fetched_json` | 158 |
| 目录公司数 / failed | 77 / 0 |
| 仍 incomplete | 仅 Microsoft |

字段口径：地点只用 Greenhouse `location.name`（如 `London, United Kingdom`），不拼接 offices 造成重复；workplace 来自官方 metadata `Workplace Type`（Hybrid/Remote）；employment 官网未提供则保持空，仅 15 条从正文明确 full-time/contract 补上；截止日期官网没有结构化字段，保持空。Greenhouse 连接器只做空字段回填和 `source_complete`，不改岗位生命周期。

质量尾巴：采集库 `raw_payload.salary_range` 有 128 条被结构化抽取写成逗号，不是覆盖缺口。美国站展示层拒绝无币种/金额的值，公网抽样没有把 `,` 当成薪资。

美国站：已部署 Airbnb 官方 host 规则、Greenhouse board `airbnb`，以及地点 `name`/`location` 去重。主 Feed 游标未重置。公网 `/api/jobs?company=Airbnb` 已返回在招岗位，地点/工作方式证据为 `verified`，`is_active=true`，`is_closed=false`。非目标地区（法国、日本、西班牙等）由地区过滤丢弃。

下一步：观察 Airbnb 与 Shopify 各 3 个成功周期后标 `regular`。队列下一手是 Lyft（Greenhouse 稳定 ATS）；DoorDash 官网 403，继续停放。当天不再接入第三家。

## 2026-09-16：Wave A 工厂首家 Shopify

执行位置：上游采集器 `/opt/global-jobs`；美国应用 `/opt/liorvix`。采集器公司 ID `ed9e9a7d-55ec-4190-8f58-5ef19294e0fa`。未改 Microsoft 连接器，未重开 Amazon / BofA / Accenture 覆盖工单。

官方源探测：Greenhouse board `shopify` 404；公开 Ashby posting-api 404。官网 careers 页带 `ashby_jid`，完整官方列表是 `https://www.shopify.com/careers.data` 与 `https://www.shopify.com/careers/sitemap.xml`，岗位详情是 `{canonical}.data`。listing 与 sitemap 均为 115 个唯一 posting UUID，1:1 对齐。

采集器验收（UTC 2026-09-16 02:57）：

| 指标 | 结果 |
| ---: | ---: |
| crawl | success，33 秒 |
| 官方 / 发现 / 写入 | 115 / 115 / 115 |
| 唯一外部 ID | 115 |
| 覆盖 / 质量 | `coverage=complete`，`quality=ok` |
| 正文 ≥300 / 地点 / 部门 | 115 / 115 / 115 |
| workplace / employment / date_posted | 115 / 115 / 115 |
| 官方薪资 / 截止日期 | 13 / 0 |
| 详情 `fetched_json` | 115 |
| 目录公司数 / failed | 76 / 0 |
| 仍 incomplete | 仅 Microsoft |

字段口径：地点保留官网原值（`Americas`、`United Kingdom`、`Toronto` 等），不猜城市；部门用 `teamName`；薪资只在官网 `shouldDisplayCompensation` 为真时写入；截止日期若早于 `publishedDate` 或官网为空则保持空。岗位 URL 用 sitemap/canonical `https://www.shopify.com/careers/{slug}_{uuid}`，不用 `?ashby_jid=` 列表壳。

美国站：已部署 `Americas`/`ANZ` 目标地区识别、`shopify` 官方 payload 信任和 `www.shopify.com` 字段规则。主 Feed 游标未重置；Shopify 岗位随增量 Feed 进入美国库。未对已有岗位做生命周期变更。

下一步：观察 Shopify 3 个成功周期后标 `regular`。同一天不再接入第二家高风险源。队列下一手是 Airbnb（Greenhouse `airbnb`，158 条已样本通过）。

## 2026-09-07：Google 官方详情 20 条 canary

执行位置：美国应用服务器 `/opt/liorvix`；目标 Supabase project ref：`weqvdtdjdzmqflhwobec`。上游采集器位于独立服务器，本轮未在上游服务器启动抓取或修改配置。

- 生产 dry-run：Google 首批 20 条在招岗位详情请求 `20 / 20` 成功，`failed=0`，`removed=0`，候选更新 `3` 条，均为官方详情页明确的 `employment_category=社招`；其余 17 条没有新的官方字段，保持原值。
- 生产 canary：使用 `--limit=20 --write` 更新 `3` 条，`failed=0`，未修改 `is_active`、`is_closed` 或岗位 ID。
- 写入后 dry-run：同一批次 `would_update=0`、`removed=0`、`failed=0`，说明 canary 已幂等收口。
- 数据库/API 验收：岗位 `11475` 的 `job_type=社招`，`field_evidence.fields.employment_category.status=verified`，证据 URL 为 Google 官方岗位详情页；岗位仍为 `is_active=true`、`is_closed=false`。公网 `/api/health` 返回 HTTP 200，公网 `/api/jobs/11475` 返回同样的字段和生命周期状态。
- 运行入口：美国服务器 `liorvix.service` 设置 `JOBS_AUTO_WORKER=true`，主 Feed、官方详情、失败队列和维护任务均由应用内 worker 定时执行；`liorvix-jobs-incremental.timer` 和 `liorvix-jobs-maintenance.timer` 当前停用，不能与应用内 worker 并行启用。

下一步：按同一流程继续 Google 后续批次或进入 Microsoft/Meta；先做 20 条 dry-run，再做独立 canary，不能直接全量 `--write`。Google 本轮未执行 `--close-removed`，因此没有改变任何岗位生命周期。

## 2026-09-07：Amazon 官方详情第二批 20 条

执行位置：美国应用服务器 `/opt/liorvix`；目标 Supabase project ref：`weqvdtdjdzmqflhwobec`。本批从 `after-id=839` 继续，未重置 Amazon 游标。

- 生产 dry-run：选中 20 条在招岗位，官方详情全部成功，`failed=0`、`removed=0`；其中 19 条可补官方地点，1 条没有新的可补字段。
- 生产写入：使用 `--scan-all --close-removed --after-id=839 --limit=20 --write` 更新 19 条地点字段，`failed=0`，`removed=0`，未修改岗位 ID、收藏/投递关系或岗位生命周期。
- 写入后 dry-run：同批次 `would_update=0`、`removed=0`、`failed=0`，已幂等收口；下一批从岗位 ID `868` 之后继续。
- 数据库/API 验收：公网 `/api/jobs/840` 返回 `region=USA, CA, Irvine`、`field_evidence.fields.location.status=verified`，证据 URL 为 Amazon 官方详情页；岗位仍为 `is_active=true`、`is_closed=false`。

下一步：继续按 500-1,000 条受控批次推进 Amazon；每批先 dry-run，再写入，404/410 或明确关闭页才下架，403/429/超时保持岗位不变。

## 执行规则

- 每家公司先记录来源、真实样本、dry-run 和字段候选数，完成生产库/API/页面三处验收后才标为已上线。
- 此处的“匹配”仅指使用 `company + external_job_id` 找到当前 `collector_feed` 在招岗位，不代表已经写入。
- 所有字段回填只补空值或无官方证据的历史值，不新增 ATS 岗位记录，不更新 `is_active` 或 `is_closed`。
- 本地 `.env.local` 的项目 ref 只能用于本轮环境记录，不能自行视为生产环境。

## 批次 3：等待探测公司首轮盘点

执行时间：2026-09-02

本批只读检查生产环境，没有写入岗位或字段。生产台账中 29 家被标记为“来源待探测”的公司，实际岗位链接盘点显示多数已经指向官方来源：

| 公司/来源族 | 代表性岗位链接域名 | 规模（约） | 当前结论 |
| --- | --- | ---: | --- |
| Amazon | `www.amazon.jobs` | 20,318 | 页面可访问，需 Amazon 专用适配器 |
| JPMorgan Chase | `jpmc.fa.oraclecloud.com` | 10,373 | Oracle HCM，需租户配置 |
| Apple | `jobs.apple.com` | 3,442 | 官方 API，需接入适配器 |
| Google | `www.google.com` | 2,345 | 官方 Careers，响应超过当前安全大小限制 |
| Microsoft | `apply.careers.microsoft.com` | 1,474 | 页面可访问，需专用适配器 |
| Deloitte | `apply.deloitte.com` | 1,163 | Avature，需适配器 |
| Morgan Stanley | `morganstanley.eightfold.ai` / `morganstanley.tal.net` | 1,128 | Eightfold/Taleo，需分开处理 |
| Meta | `www.metacareers.com` | 775 | 页面可访问，部分字段可提取 |
| Goldman Sachs | `higher.gs.com` | 758 | 自定义官方来源，需分页探测 |
| UBS、Jane Street、Deutsche Bank 等 | 各自官方域名 | 约 1,000+ | 已有官方链接，需逐家适配 |

样本 dry-run 结果：Amazon、Apple、Microsoft、Meta、Deloitte、Morgan Stanley、Goldman Sachs 页面可访问并能取得正文；Google/UBS 需要先处理响应大小限制；Jane Street 存在协议异常。所有样本均为 dry-run，没有写入。

下一步按 [`job-sync-discovery-resolution-plan.md`](job-sync-discovery-resolution-plan.md) 的 3A-3H 批次实施。当前不能仅修改 `job_company_sources.status`，必须先有官方来源证据、连接器或安全通用详情解析器，再开放历史字段复核。

### 批次 3A：Amazon Jobs 首次 dry-run

执行时间：2026-09-02

已将 Amazon 的官方来源登记为 `amazon_jobs`，并部署独立的通用详情任务。生产写入开关 `JOBS_GENERIC_OFFICIAL_BACKFILL_WRITE_ENABLED` 保持关闭。

| 指标 | 结果 |
| --- | ---: |
| 生产在招岗位候选 | 20,306 |
| 本次抽样 | 20 |
| 官网页面成功取得正文 | 10 |
| 官网返回 404 | 10 |
| 可补字段岗位 | 10 |
| dry-run 实际写入 | 0 |

结论：Amazon 详情链接存在一半已失效或已关闭，不能直接全量写入。下一步先修复上游 Amazon 岗位 URL/关闭状态映射，再复跑 20 条样本；通过后才开启 Amazon 专用写入开关。Amazon 当前在历史复核队列中显示为“官方详情复核未启用写入开关”，不会自动写入。

### 批次 3B：Apple Jobs 官方 API dry-run

执行时间：2026-09-03

Apple 详情页是前端壳页面，岗位正文由同域只读接口返回：先请求 `/api/v1/CSRFToken`，再请求 `/api/v1/jobDetails/<jobNumber>`。已将该接口接入安全外部抓取层，仅对白名单域名 `jobs.apple.com` 启用，并保留 DNS 校验、HTTPS、响应大小和官方域名限制。生产通用官方写入开关仍保持关闭。

| 指标 | 结果 |
| --- | ---: |
| 生产在招岗位候选 | 3,483 |
| 本次抽样 | 20 |
| 官方 API 成功 | 20 |
| 页面级失败/跳过 | 0 |
| 实际可补岗位 | 15 |
| 地点候选字段 | 15 |
| 经验候选字段 | 12 |
| 岗位类型候选字段 | 7 |
| 工作方式/薪资/截止日期候选字段 | 0 / 0 / 0 |
| dry-run 实际写入 | 0 |

结论：Apple 官方 API、岗位号和详情链接匹配稳定；地点、官方资格文本和部分经验要求可形成字段证据。Apple 页面没有在样本中提供明确工作方式、具体薪资或截止日期，这三项保持为空，不用通用规则猜测。Apple 已具备小批量生产验收条件，但在完成首批生产写入前仍保持 `JOBS_GENERIC_OFFICIAL_BACKFILL_WRITE_ENABLED=false`。

#### Apple 生产 canary

执行时间：2026-09-03

在独立公司白名单 `JOBS_GENERIC_OFFICIAL_BACKFILL_COMPANIES=Apple` 下完成首批 20 条生产写入：更新 20 条岗位，0 失败，0 跳过；没有修改 `is_active`、`is_closed` 或岗位 ID。写入后 Apple 队列保留游标并显示“canary 已完成 20 条”，随后已重新排队从第 21 条继续。当前服务配置只允许 Apple 的通用官方复核，Amazon 仍保持暂停。

## 批次 0：来源矩阵和质量基线

执行时间：2026-08-28

命令：

```bash
pnpm run audit:company-source-matrix -- --out=output/company-source-matrix-current.json
```

结果：

| 项目 | 结果 |
| --- | ---: |
| 在招 `collector_feed` 岗位 | 48,981 |
| 活跃公司 | 75 |
| 岗位链接域名组 | 79 |
| 已归入来源族的公司 | 51 |
| 仍需来源探测的公司 | 24 |

已识别的来源族（按当前在招岗位量）：

| 来源族 | 公司数 | 在招岗位 | 分类依据 |
| --- | ---: | ---: | --- |
| Oracle HCM | 3 | 9,777 | 官方域名 / 已验证适配器 |
| Workday | 19 | 7,714 | 官方域名 |
| Apple 官方 API | 1 | 3,449 | 已验证适配器 |
| Greenhouse | 17 | 2,764 | 9 家连接器登记，8 家官方域名 |
| Ashby | 8 | 1,248 | 6 家连接器登记，1 家已验证适配器，1 家官方域名 |
| Phenom | 2 | 363 | 已验证适配器 |
| Lever | 1 | 267 | 连接器登记 |
| 自建官网/未分类 | 24 | 23,399 | 待源探测 |

注意：Stripe、Databricks、Datadog、Coinbase、Asana、Brex 等公司会提供品牌官网 canonical URL；来源矩阵以已验证连接器注册表优先，不能仅按 URL 域名把它们误判为自建站点。

## 批次 1：官方 ATS 先锋验收

### Greenhouse：Stripe

执行命令：

```bash
pnpm run sync:job-connector -- --company=Stripe --timeout-ms=20000
pnpm run backfill:connector-fields -- --company=Stripe
```

| 指标 | 结果 |
| --- | ---: |
| 官方接收 / 解析 | 577 / 577 |
| 目标地区标准化岗位 | 436 |
| 解析丢失 | 0 |
| 现有上游在招岗位 | 369 |
| 外部 ID 匹配 | 368 |
| 候选岗位 | 368 |
| 地点 / 工作方式 / 岗位类型 / 经验候选字段 | 368 / 83 / 125 / 351 |
| 薪资 / 截止日期候选字段 | 0 / 0 |
| 写入 | 0（dry-run） |

结论：Greenhouse 连接器和“只回填字段”的匹配规则可用。官网本次未提供可验证薪资或截止日期，因此保持为空。

#### Stripe 生产回填与验收

执行时间：2026-08-28

生产环境：`weqvdtdjdzmqflhwobec`（在美国服务器 `/opt/liorvix/.env.local` 中确认）。

先以 `--limit=20` 做生产抽样：20 条均保持在招，20 条经验字段和 2 条工作方式字段写入了 `verified` 官方证据；随后完成三处验收（生产数据库、公开 `/api/jobs`、20 个公开岗位页）后，才执行 `--all`。

```bash
JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true \
  pnpm run backfill:connector-fields -- --company=Stripe --write --limit=20

JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true \
  pnpm run backfill:connector-fields -- --company=Stripe --write --all
```

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 378（写入前后不变） |
| 官方接收 / 解析 | 577 / 577 |
| 外部 ID 匹配 | 377 |
| 首批写入 | 20 |
| 后续候选 / 写入 | 333 / 333 |
| 官方经验字段证据 | 360 |
| 官方工作方式字段证据 | 88 |
| 官方岗位类型字段证据 | 127 |
| 官方薪资 / 截止日期证据 | 0 / 0 |
| 公开 API 中经验 / 工作方式岗位 | 360 / 88 |
| 抽样公开岗位页 | 20 / 20 可访问 |

说明：首批预览时官方 board 有 578 条，后续全量写入时为 577 条，这是官网岗位自然变动；生产上游的 378 条岗位未因字段任务下架。官网没有明确薪资或截止日期时，保持为空是预期结果。

### Ashby：OpenAI

执行命令：

```bash
pnpm run sync:job-connector -- --company=OpenAI --timeout-ms=20000
pnpm run backfill:connector-fields -- --company=OpenAI
```

| 指标 | 结果 |
| --- | ---: |
| 官方接收 / 解析 | 743 / 743 |
| 目标地区标准化岗位 | 682 |
| 解析丢失 | 0 |
| 现有上游在招岗位 | 672 |
| 外部 ID 匹配 | 669 |
| 候选岗位 | 669 |
| 地点 / 工作方式 / 岗位类型 / 经验候选字段 | 669 / 453 / 669 / 403 |
| 薪资 / 截止日期候选字段 | 0 / 0 |
| 写入 | 0（dry-run） |

结论：Ashby 连接器和字段证据链可用；官网本次没有可验证的薪资或截止日期，保持为空。

#### OpenAI 生产回填与验收

执行时间：2026-08-28

生产环境：`weqvdtdjdzmqflhwobec`（在美国服务器 `/opt/liorvix/.env.local` 中确认）。

先以 `--limit=20` 做生产抽样：岗位数量、公开 API 字段和 20 个公开岗位页均通过验收后，才对剩余候选执行 `--all`。最终 dry-run 的候选数为 0。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 672（写入前后不变） |
| 官方接收 / 解析 | 742 / 742 |
| 外部 ID 匹配 | 669 |
| 首批写入 | 20 |
| 全量前剩余候选 | 632 |
| 全量后候选 | 0 |
| 官方经验字段证据 | 404 |
| 官方工作方式字段证据 | 454 |
| 官方岗位类型字段证据 | 669 |
| 官方薪资 / 截止日期证据 | 0 / 0 |
| 公开 API 中经验 / 工作方式 / 岗位类型岗位 | 405 / 456 / 669 |
| 抽样公开岗位页 | 20 / 20 可访问 |

说明：公开 API 中少量工作方式和经验字段来自既有记录，因此其数量可能高于本次带 `verified` 证据的字段数；本次写入只补官方源中存在的字段。官网没有明确薪资或截止日期时，保持为空是预期结果。

### Greenhouse：Databricks

#### Databricks 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 548（写入前后不变） |
| 官方接收 / 解析 | 842 / 842 |
| 外部 ID 匹配 | 546 |
| 候选岗位 | 479 |
| 首批 / 后续写入 | 20 / 459 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 445 / 40 / 212 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批公开岗位页验收 | 20 / 20 可访问 |
| 跨页公开 API 对账 | 445 / 445 条经验岗位返回 |

说明：写入后发现列表 API 只按 `created_at` 排序时会在同批导入的相同时间戳下产生跨页遗漏。已改为以 `created_at`、`id` 稳定排序并完成生产构建和健康检查；Databricks 的公开 API 漏岗数已从 5 变为 0。

### Greenhouse：Brex

#### Brex 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 275（写入前后不变） |
| 官方接收 / 解析 | 294 / 294 |
| 外部 ID 匹配 | 275 / 275 |
| 候选岗位 | 263 |
| 首批 / 后续写入 | 20 / 243 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 231 / 0 / 183 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Brex 官方源本次没有提供明确工作方式、薪资或截止日期，相关字段保持为空。

### Greenhouse：Datadog

#### Datadog 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 272（写入前后不变） |
| 官方接收 / 解析 | 449 / 449 |
| 外部 ID 匹配 | 269 / 272 |
| 候选岗位 | 232 |
| 首批 / 后续写入 | 20 / 212 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 202 / 55 / 138 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：3 条现有上游岗位未能与本轮官方外部 ID 匹配，保持其原有字段和生命周期，未作任何下架或覆盖。

### Ashby：Ramp

#### Ramp 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 134（写入前后不变） |
| 官方接收 / 解析 | 136 / 136 |
| 外部 ID 匹配 | 134 / 134 |
| 候选岗位 | 133 |
| 首批 / 后续写入 | 20 / 113 |
| 全量后候选 | 0 |
| 首批工作方式 / 岗位类型 / 经验写入 | 20 / 20 / 15 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Ramp 官方 Ashby 数据明确提供工作方式和岗位类型；仅对存在明确年限要求的岗位写入经验字段。

### Greenhouse：Figma

#### Figma 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 123（写入前后不变） |
| 官方接收 / 解析 | 160 / 160 |
| 外部 ID 匹配 | 123 / 123 |
| 候选岗位 | 104 |
| 首批 / 后续写入 | 20 / 84 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 100 / 0 / 59 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Figma 官方 Greenhouse 源本次没有明确工作方式、薪资或截止日期，相关字段保持为空。

### Greenhouse：GitLab

#### GitLab 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 150（写入前后不变） |
| 官方接收 / 解析 | 217 / 217 |
| 外部 ID 匹配 | 149 / 150 |
| 候选岗位 | 147 |
| 首批 / 后续写入 | 20 / 127 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 15 / 149 / 96 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：1 条现有上游岗位未能与本轮官方外部 ID 匹配，保持原有字段和生命周期，未作下架或覆盖。

### Greenhouse：Coinbase

#### Coinbase 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 149（写入前后不变） |
| 官方接收 / 解析 | 182 / 182 |
| 外部 ID 匹配 | 149 / 149 |
| 候选岗位 | 144 |
| 首批 / 后续写入 | 20 / 124 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 145 / 144 / 94 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：验收统计窗口中出现 4 条同时间的既有更新；全部仍在招且公开 API、岗位页一致。本次回填仅按官方外部 ID 对候选岗位补字段。

### Greenhouse：Asana

#### Asana 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 78（写入前后不变） |
| 官方接收 / 解析 | 125 / 125 |
| 外部 ID 匹配 | 78 / 78 |
| 候选岗位 | 78 |
| 首批 / 后续写入 | 20 / 58 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 78 / 3 / 41 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：官方列表中有 4 条当前未进入上游岗位库的岗位；本次字段回填不新增岗位，只处理已存在的 78 条岗位。

### Ashby：Cursor

#### Cursor 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 105（写入前后不变） |
| 官方接收 / 解析 | 120 / 120 |
| 外部 ID 匹配 | 105 / 105 |
| 候选岗位 | 101 |
| 首批 / 后续写入 | 20 / 81 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 53 / 105 / 105 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Cursor 官方 Ashby 数据完整提供工作方式与岗位类型；只有 53 条岗位包含可验证的明确经验要求。

### Ashby：Notion

#### Notion 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 82（写入前后不变） |
| 官方接收 / 解析 | 135 / 135 |
| 外部 ID 匹配 | 82 / 82 |
| 候选岗位 | 80 |
| 首批 / 后续写入 | 20 / 60 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 58 / 68 / 82 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Notion 官方 Ashby 源本次没有提供可验证的薪资或截止日期，相关字段保持为空。

### Ashby：Perplexity

#### Perplexity 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 91（写入前后不变） |
| 官方接收 / 解析 | 98 / 98 |
| 外部 ID 匹配 | 88 / 91 |
| 候选岗位 | 85 |
| 首批 / 后续写入 | 20 / 65 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 75 / 40 / 88 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：3 条现有上游岗位未能与官方外部 ID 匹配，保留原有字段和生命周期，未作下架或覆盖。

### Ashby：Vanta

#### Vanta 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 95（写入前后不变） |
| 官方接收 / 解析 | 108 / 108 |
| 外部 ID 匹配 | 94 / 95 |
| 候选岗位 | 88 |
| 首批 / 后续写入 | 20 / 68 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 73 / 90 / 94 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：1 条现有上游岗位未能与官方外部 ID 匹配，保留原有字段和生命周期，未作下架或覆盖。

### Lever：Palantir

执行命令：

```bash
pnpm run sync:job-connector -- --company=Palantir --timeout-ms=10000
```

结果：官方 Lever API 在当前执行出口 10 秒超时并被主动中止。

结论：标记为 `detail_unavailable/blocked`，未把超时理解为零岗位，未写入、未下架，也不扩大重试。待在生产服务器或另一合规网络出口完成真实样本和 dry-run 后再继续。

#### Palantir 生产回填与验收

执行时间：2026-08-28

生产环境：`weqvdtdjdzmqflhwobec`（美国服务器 `/opt/liorvix/.env.local`）。官方 Lever board 在生产出口可稳定读取，因此在已通过 20 条样本写入及三处抽样验收后，执行了全量只补缺失字段回填。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 278（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 307 / 307 / 278 |
| 外部 ID 匹配 | 278 / 278 |
| 首批写入 | 20 |
| 全量前候选 / 写入 | 257 / 257 |
| 全量后 dry-run 候选 | 0 |
| 官方工作方式 / 岗位类型 / 经验字段证据 | 278 / 278 / 3 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开岗位详情页抽样 | 20 / 20 可访问 |

说明：Palantir 本轮官方 Lever 数据只为少量岗位提供了可验证的明确经验年限；没有官方薪资和截止日期字段，故保持为空。地点字段本轮没有缺失候选，未做覆盖。此前本地出口超时只作为一次网络观察记录，不代表官网无岗位或需要下架岗位。

### Greenhouse：Point72

#### Point72 生产回填与验收

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `point72`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/point72/jobs?content=true`，详情链接为 `https://boards.greenhouse.io/point72/jobs/{external_job_id}`。生产源与现有岗位通过 `external_job_id` 匹配；1 条已有上游岗位未能匹配，本轮保持其字段和生命周期不变。

真实样本审查曾发现两条实习岗位把公司介绍中的“more than 30 years of investing experience”误识别为候选人经验。已在通用解析器中排除此类公司历史语境，并新增回归测试；修复后该错误经验显示数为 0，才进行写入。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 169（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 236 / 236 / 170 |
| 外部 ID 匹配 | 168 / 169 |
| 首批写入 | 20 |
| 全量前剩余候选 / 写入 | 110 / 110 |
| 全量后 dry-run 候选 | 0 |
| 官方岗位类型 / 经验 / 截止日期字段证据 | 46 / 109 / 1 |
| 官方薪资 / 工作方式字段证据 | 0 / 0 |
| 误识别的公司历史经验 | 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 169 条 / 20 / 20 可访问 |

说明：Point72 的官方 Greenhouse 列表没有明确工作方式和薪资字段；除一条官网正文明确标注的报名截止日期外，截止日期保持为空。字段缺失不影响岗位上架状态。

### Greenhouse：Reddit

#### Reddit 生产回填与验收

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `reddit`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/reddit/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/reddit/jobs/{external_job_id}`。生产上游存在 147 条在招岗位，其中 145 条与本轮官方外部 ID 匹配；2 条未匹配岗位保持字段和生命周期不变。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 147（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 152 / 152 / 148 |
| 外部 ID 匹配 | 145 / 147 |
| 首批写入 | 20 |
| 全量前剩余候选 / 写入 | 123 / 123 |
| 全量后 dry-run 候选 | 0 |
| 官方工作方式 / 岗位类型 / 经验字段证据 | 106 / 145 / 141 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开岗位详情页抽样 | 20 / 20 可访问 |

说明：真实样本中的 4-7 年、6-8 年、10+ 年、14+ 年等经验均来自岗位要求；远程字段来自官方地点/工作方式字段。官网本轮没有明确薪资或截止日期，因此保持为空。

### Greenhouse：Robinhood

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `robinhood`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/robinhood/jobs?content=true`，详情链接为 `https://boards.greenhouse.io/robinhood/jobs/{external_job_id}`。生产上游存在 124 条在招岗位，其中 121 条与本轮官方外部 ID 匹配；3 条未匹配岗位保留原有字段和生命周期，不作下架或覆盖。

真实样本确认 Greenhouse 的 `application_deadline` 是官方结构化字段，例如 `2026-09-12T14:29:37-04:00`。此前通用标准化层只允许官网正文截止日期，导致该字段被错误隐藏。现已限定放行 `source_type=official_ats` 且 `official_payload` 的结构化日期，并新增回归测试；普通上游时间戳和 2001 年异常日期仍会被拒绝。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 124（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 129 / 129 / 127 |
| 外部 ID 匹配 | 121 / 124 |
| 首批写入 | 20 |
| 全量前剩余候选 / 写入 | 89 / 89 |
| 全量后 dry-run 候选 | 0 |
| 官方经验字段证据 | 92 |
| 官方 ATS 截止日期证据 | 10 |
| 异常截止日期 | 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 截止日期 9 条可见 / 20 / 20 可访问 |

说明：公开 API 默认目标地区范围内返回 92 条 Robinhood 岗位，其中 9 条有公开可见的官方截止日期；生产库中的第 10 条不在该默认公开地区结果中。薪资与工作方式没有本轮可回填的官方缺失字段，保持原状。

### Greenhouse：Twilio

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `twilio`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/twilio/jobs/{external_job_id}`。生产上游有 93 条在招岗位，其中 92 条可通过官方外部 ID 匹配；未匹配的 1 条岗位保持既有字段和生命周期，不做下架或覆盖。

真实样本确认 Twilio 的薪资通常写在官方岗位正文中，且可能包含按地点区分的多个带币种区间。连接器只提取同时包含币种和金额的区间，保留最多四个官方区间；截止日期仅接受正文中明确标注的 application deadline，不从发布时间或普通描述推断。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 93（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 144 / 144 / 97 |
| 外部 ID 匹配 | 92 / 93 |
| 首批写入 | 20 |
| 全量前剩余候选 / 写入 | 72 / 72 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 2 / 92 / 43 |
| 官方经验 / 薪资 / 截止日期字段证据 | 90 / 63 / 16 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资、截止日期、经验均可见 / 20 / 20 可访问 |

说明：Twilio 的官网没有为每个岗位提供结构化地点字段，因此只对能明确验证的字段写入；字段为空不等于岗位失效。生产数据库、公开 `/api/jobs`、公开 `/api/jobs/{id}` 和 20 个实际岗位页均已完成抽样核验。

### Greenhouse：Discord

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `discord`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/discord/jobs/{external_job_id}`。官方与生产均为 52 条在招岗位，全部通过官方外部 ID 精确匹配。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 52（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 52 / 52 / 52 |
| 外部 ID 匹配 | 52 / 52 |
| 首批 / 后续写入 | 20 / 32 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 52 / 7 / 34 |
| 官方经验 / 薪资 / 截止日期字段证据 | 51 / 52 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资与经验可见 / 20 / 20 可访问 |

说明：Discord 的薪资来自官方 Greenhouse 内容中的带币种范围；官网本轮没有明确截止日期，故全部保持为空。地点字段已存在且可验证，本轮不覆盖原值。数据库、公开 API 和实际岗位页的首批抽样均通过。

### Greenhouse：TPG

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `tpgcareers`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/tpgcareers/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/tpgcareers/jobs/{external_job_id}`。该公司官方与生产均只有 17 条在招岗位，因此首批样本覆盖了全部 17 条，而不是拆成不必要的两次写入。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 17（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 17 / 17 / 17 |
| 外部 ID 匹配 | 17 / 17 |
| 首批 / 后续写入 | 17 / 0 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 既有可验证地点未覆盖 / 0 / 13 |
| 官方经验 / 薪资 / 截止日期字段证据 | 15 / 11 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资与经验可见 / 17 / 17 可访问 |

说明：TPG 官方源没有明确工作方式或截止日期，相关字段保持为空。现有地点字段未缺失，本轮不覆盖；经验、薪资和岗位类型仅在官方内容明确给出时写入。公司官网招聘页和全部官方详情页均可访问。

### Greenhouse：Bridgewater Associates

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `bridgewater89`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/bridgewater89/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/bridgewater89/jobs/{external_job_id}`。官方与生产均为 16 条在招岗位，全部外部 ID 精确匹配；首批覆盖全部 14 条有待补官方字段的岗位。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 16（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 16 / 16 / 16 |
| 外部 ID 匹配 | 16 / 16 |
| 首批 / 后续写入 | 14 / 0 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 2 / 2 / 14 |
| 官方经验 / 薪资 / 截止日期字段证据 | 12 / 7 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资可见 / 16 / 16 可访问 |

说明：Bridgewater 官方源没有明确截止日期；工作方式和地点仅保留已有的可验证值。经验、薪资和岗位类型只在官方内容明确给出时写入，未因字段缺失改变岗位状态。

### Greenhouse：General Atlantic

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `generalatlantic`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/generalatlantic/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/generalatlantic/jobs/{external_job_id}`。官方源有 15 条，其中 3 条不在平台目标地区范围；进入目标地区的 12 条与生产岗位全部精确匹配。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 12（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 15 / 15 / 12 |
| 外部 ID 匹配 | 12 / 12 |
| 首批 / 后续写入 | 9 / 0 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 既有可验证地点未覆盖 / 0 / 6 |
| 官方经验 / 薪资 / 截止日期字段证据 | 9 / 2 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资与经验可见 / 12 / 12 可访问 |

说明：地区过滤只用于字段回填的目标范围，不改变官网或生产岗位生命周期。官网没有明确工作方式和截止日期，故不作推断填写。

### Ashby：Runway

执行时间：2026-08-28

来源登记：Runway 的官方岗位同时分布在 Ashby 的 `runway`（4 条）和 `runway-ml`（42 条）两个 board。连接器已改为聚合多个同公司的官方 board 后按外部 ID 去重，避免遗漏；生产 46 条岗位中，目标地区的 45 条与官方岗位匹配，未匹配的 1 条保留原字段和生命周期。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 46（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 46 / 46 / 45 |
| 外部 ID 匹配 | 45 / 46 |
| 首批 / 后续写入 | 20 / 24 |
| 全量后 dry-run 候选 | 0 |
| 官方工作方式 / 岗位类型 / 经验字段证据 | 45 / 45 / 34 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开岗位页抽样 | 20 / 20 可访问 |

说明：官方源本轮没有明确薪资和截止日期，相关字段保持为空。多 board 仅影响官方数据聚合和字段回填，不改变当前岗位 ID 或上下架状态。

### Ashby：Linear

执行时间：2026-08-28

来源登记：官方 Ashby board 为 `linear`，列表地址为 `https://api.ashbyhq.com/posting-api/job-board/linear`，官方职位链接为 `https://jobs.ashbyhq.com/linear/{external_job_id}`。官方列表收到 29 条，23 条进入平台目标地区范围，且与生产中的 23 条在招 `collector_feed` 岗位全部按官方外部 ID 精确匹配。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 23（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 29 / 29 / 23 |
| 外部 ID 匹配 | 23 / 23 |
| 首批 / 后续写入 | 20 / 3 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 23 / 23 / 23 |
| 官方经验 / 薪资 / 截止日期字段证据 | 19 / 0 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 20 / 20 可访问 |

说明：Linear 的官方内容为 19 条岗位提供了明确的工作经验要求；官方源没有薪资或截止日期，相关字段保持为空。首批写入后，生产数据库、公开 API 和岗位页均通过抽样；随后才回填剩余 3 条。新增 `pnpm run audit:connector-backfill -- --company=<公司>` 作为可复用的只读验收命令，输出已验证字段覆盖和可抽样的岗位 ID。

## 已完成的防呆实现

- `pnpm run audit:company-source-matrix`：在数据库端聚合 75 家公司的来源域名、有效来源族和六项字段证据覆盖率；报告附环境 project ref。
- `pnpm run sync:job-connector -- --company=<公司>`：dry-run 现在额外输出六项字段覆盖率、现有 `collector_feed` 数量和外部 ID 匹配数。
- `pnpm run backfill:connector-fields -- --company=<公司>`：默认只预览候选字段；写入必须同时传 `--write` 与 `JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true`。
- `pnpm run audit:connector-backfill -- --company=<公司>`：只读汇总生产在招岗位的字段值、证据状态和抽样岗位 ID，用于首批写入后的数据库/API/页面三处验收。
- 连接器把岗位类型的官方字段证据写入 `field_evidence`，避免“字段已经推导但质量审计仍显示未验证”。
- 岗位列表默认排序以 `created_at`、`id` 作为稳定分页键；同批上游导入的岗位时间戳相同时，跨页请求不会重复或漏掉岗位，避免出现“数据库有经验字段但列表 API 没返回该岗位”的假象。

## 生产写入前的固定步骤

以下步骤必须在确认的生产环境执行，且仅对已完成 dry-run 的单家公司进行：

```bash
# 1. 确认当前环境与生产 project ref；此命令不写入。
pnpm run backfill:connector-fields -- --company=Stripe

# 2. 复查 official / matched / candidate 数量后，先对固定的 20 条岗位抽样写入。
JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true pnpm run backfill:connector-fields -- --company=Stripe --write --limit=20

# 3. 重新生成来源矩阵，并从生产数据库、/api/jobs、实际岗位页抽样核验。
pnpm run audit:company-source-matrix -- --out=output/company-source-matrix-production.json
```

首批 20 条完成三处验收后，才允许显式使用 `--all` 回填该公司的其余候选岗位。Stripe 和 OpenAI 均已完成该流程。

## 下一轮顺序

1. 进入批次 1，以 Boston Consulting Group 作为 Phenom 先锋公司；先完成官方列表、分页、详情、外部 ID 和 20 条样本验证。
2. BCG 通过完整生产验收后，再处理 Oliver Wyman；任何解析、详情或匹配异常只暂停当前公司。
3. Phenom 族稳定后，按计划以 Lazard 进入 Oracle HCM 先锋验证，再启动 Workday 的 Houlihan Lokey。

## 批次 1：Phenom - BCG 灰度验收

执行时间：2026-08-28（进行中）

来源登记：BCG 官方列表为 `https://careers.bcg.com/global/en/search-results`，列表数据位于 `phApp.ddo.eagerLoadRefineSearch.data.jobs`，详情数据位于 `phApp.ddo.jobDetail.data.job`，稳定官方岗位 ID 为 `jobSeqNo`，详情 URL 为 `https://careers.bcg.com/global/en/job/{jobSeqNo}`。

本轮已完成分页、稳定 ID 去重、多地点合并和“只对当前生产库匹配岗位请求详情”的低并发详情抓取。生产 dry-run 记录为：在招 `collector_feed` 250 条、官方列表接收 894 条、稳定 ID 去重后约 718 条、外部 ID 匹配 192 条、详情请求 199 条且请求失败 0 条。已先对 20 条进行只补缺失字段的灰度写入；本条记录不将其标记为生产验收完成。

新增边界：BCG 官方详情 HTML 会包含静态的 `the job you are trying to apply for has been filled` 组件，即使 `phApp.ddo.jobDetail.data.job` 仍有与 URL 匹配的官方岗位数据。真实 dry-run 因此发现不能把这句文案单独当作关闭证据。连接器现以匹配的官方详情 payload 为优先依据；仅在缺少匹配详情数据且存在关闭页时记为 `detail_closed`。前一种情况记为 `detail_ambiguous` 供审计，仍可作为字段证据；两种情况都不会由字段任务改变 `collector_feed` 的上下架状态。

待完成：将本地修复部署到生产服务器，重新运行 BCG dry-run，完成 20 条数据库/API/页面验收后才决定是否执行 `--all`。BCG 完成前不启动 Oliver Wyman。

### BCG 修复后只读复核

执行时间：2026-08-28

本地已配置环境的只读 dry-run 在修复后输出如下。此结果只证明连接器和当前配置的数据库可用，尚不替代生产环境验收。

| 指标 | 结果 |
| --- | ---: |
| 官方列表接收 / 稳定 ID 解析 | 894 / 719 |
| 列表重复外部 ID | 175 |
| 当前在招 `collector_feed` / 匹配外部 ID | 225 / 188 |
| 详情请求 / 失败 / 明确关闭 | 188 / 0 / 0 |
| 含静态过期组件但有匹配详情 | 188 |
| 地点 / 工作方式 / 岗位类型字段覆盖 | 201 / 142 / 201 |
| 经验 / 薪资 / 截止日期字段覆盖 | 160 / 23 / 3 |

结论：详情 payload 优先规则已确认有效，未再将匹配岗位误判为关闭。下一步只能在已确认的生产 Supabase 环境运行相同的 dry-run 和首批 20 条写入。

### BCG 字段回填 dry-run（测试环境）

执行时间：2026-08-28

环境：`bonvalewfehgarshxkyl`。该 project ref 与生产记录中的 `weqvdtdjdzmqflhwobec` 不同，故本次结果严禁用于宣称已上线，也没有执行写入。

| 指标 | 结果 |
| --- | ---: |
| 当前在招 `collector_feed` / 外部 ID 匹配 | 225 / 181 |
| 官方接收 / 解析 / 目标地区规范化 | 894 / 719 / 193 |
| 详情请求 / 失败 / 明确关闭 / 静态组件歧义 | 181 / 0 / 0 / 181 |
| 可回填岗位 | 181 |
| 地点 / 工作方式 / 岗位类型候选 | 181 / 139 / 181 |
| 经验 / 薪资 / 截止日期候选 | 156 / 24 / 3 |

首批生产验收将固定为该公司 job ID 升序的前 20 个候选，但必须先在生产服务器的 `/opt/liorvix/.env.local` 重新计算候选数和样本，不能复制本测试环境的岗位 ID。

### BCG 生产灰度与截断页面修复

执行时间：2026-08-28

生产环境 `weqvdtdjdzmqflhwobec` 的 dry-run 显示 246 条在招岗位、186 条官方外部 ID 匹配、171 条候选。首批 20 条已只补缺失字段写入：工作方式 15、岗位类型 20、经验 17、薪资 1，写入前后在招岗位数量仍为 246。

首个公网详情验收发现 `fetchSafeExternalPage` 的页面长度限制可在 BCG 的完整 `jobSeqNo` 之前截断 JSON；旧的“完整 ID 匹配”保护会退化为关闭误判。现已改为在完整解析失败时识别官方 `phApp.ddo.jobDetail.data.job` 信封作为有效详情证据，并新增回归测试。后续继续详情验收前必须部署该修复，并复核首个受影响岗位的状态。

进一步核验发现安全抓取返回的是去除脚本后的纯文本，因此 BCG 的详情数据包不会传递到通用链接检查。最终策略收紧为：已登记的 Phenom 公司在官方 host 的 `/job/{id}` URL 不再由通用 `filled` 文案关闭；其状态仍由官方连接器和上游关闭事件管理。恢复操作只能针对明确岗位 ID，并显式声明该已登记 Phenom 规则，禁止批量恢复。

### BCG 生产回填与首轮验收

执行时间：2026-08-28

生产服务器：`/opt/liorvix`，Supabase project ref：`weqvdtdjdzmqflhwobec`。

部署前，服务器完成 `pnpm run ts-check`、`pnpm run test:job-connectors`、`pnpm run test:job-standard-fields`、`pnpm run test:job-maintenance-content` 和 `pnpm run test:job-content`。所有 Greenhouse、Ashby、Lever、Phenom fixture 均通过。随后构建并重启 `liorvix`，本机和公网 `https://liorvix.com/api/health` 都返回 `{"status":"ok"}`。

生产 dry-run 初始快照：246 条在招 `collector_feed` 岗位，186 条官方外部 ID 匹配，171 条候选，详情请求 193 条、失败 0。首批 20 条写入后，公开岗位详情 API 的 20/20 样本均返回 200；示例岗位 `10219` 公开 API 显示仍在招，且地点、工作方式、岗位类型和经验字段均可见。该岗位曾被旧通用 HTML 判断误关，已使用严格限定的 Phenom 恢复流程恢复；新规则已发布并复测。

全量回填分多次处理官网在分页/去重过程中的实时变化。每次只补缺失或未验证字段，不修改 `is_active` / `is_closed`；生产在招岗位数始终为 246。最后生产字段审计为：

| 字段 | 有值 / 已验证 |
| --- | ---: |
| 地点 | 246 / 246 |
| 工作方式 | 173 / 173 |
| 岗位类型 | 236 / 236 |
| 经验 | 195 / 195 |
| 薪资 | 27 / 27 |
| 截止日期 | 3 / 3 |

说明：官网实时分页使紧邻的 dry-run 会出现不同的外部 ID 匹配集合，无法将瞬时候选数作为完成的唯一判断。因此以字段证据覆盖、零详情失败、246 条岗位数量不下降、20 条公开详情验收和连续同步观察共同作为完成证据。BCG 现进入三次同步观察期；在观察完成前，Oliver Wyman 仅可进行只读官方源登记和 fixture 准备，不得写生产数据。

## 2026-09-02：Accenture 官方字段队列完成与性能修复

生产环境：`weqvdtdjdzmqflhwobec`。Accenture 官方 Workday 来源为 `accenture.wd103.myworkdayjobs.com`，tenant `accenture`，site `AccentureCareers`。最终生产在招 `collector_feed` 岗位为 2,380 条。

本轮自动队列最后批次从游标 `46960` 推进到 `64264`：100 条候选，详情成功 94 条，跳过 100 条，更新 0 条，失败 0；游标已到当前最大岗位 ID，后续进入 10 分钟复查冷却。字段审计（有值 / verified）为：地点 `2,380 / 2,292`、工作方式 `428 / 428`、岗位类型 `1,564 / 1,540`、经验 `1,134 / 1,429`、薪资 `710 / 710`、截止日期 `0 / 0`。经验 verified 多于当前有值是历史证据残留，不据此补猜测；官网没有可验证截止日期时保持为空。

生产 `/api/health`、`/api/jobs/6767`、`/jobs/6767` 和 Accenture 官方详情页均返回 HTTP 200，岗位仍保持开放；严格回归结果为 `company_count: 75`、`regressions: []`，报告为 `output/connector-regression-after-accenture-20260902.json`。

本轮同时修复了队列重复扫描：完成公司不再将游标清为 `null`，游标到达当前最大岗位 ID后不再启动详情子进程，并设置 10 分钟完成复查冷却；Workday 详情请求最多 3 个并发 worker，但仍保持全局 `JOB_BACKFILL_REQUEST_DELAY_MS=1200` 请求启动间隔。生产实测 100 条批次约 122 秒，失败 0；未修改岗位 ID、`is_active`、`is_closed`、收藏或投递记录。

## 2026-09-02：生产队列运行复核与调度参数恢复

生产 project ref 再次只读核对为 `weqvdtdjdzmqflhwobec`。复核时发现服务器 `.env.local` 被保留为旧的 `JOBS_OFFICIAL_DETAILS_BATCH_SIZE=20`、`JOBS_OFFICIAL_DETAILS_INTERVAL_MINUTES=0.5`，与已验证的性能配置不一致；这会让队列每轮少处理、等待时间更长，但不是游标回退的根因。

已先将原配置备份至服务器 `/root/liorvix-env-before-official-details-config-20260902`，再恢复以下生产参数：

- `JOBS_OFFICIAL_DETAILS_BATCH_SIZE=100`
- `JOBS_OFFICIAL_DETAILS_INTERVAL_MINUTES=0.1`
- `JOBS_OFFICIAL_DETAILS_COMPANIES_PER_CYCLE=3`
- `JOB_BACKFILL_CONCURRENCY=3`
- `JOB_BACKFILL_REQUEST_DELAY_MS=1200`
- `JOBS_OFFICIAL_DETAILS_FOCUS_COMPANY=`（Accenture 已完成，恢复公平轮转）

重启后 `liorvix.service=active`，公网 `/api/health` 返回 `{"status":"ok"}`。队列复核显示旧的 Intel/Blackstone 租约自然过期并释放，随后 Accenture、Bain Capital、Ares Management、Rothschild & Co、Adobe、Brookfield、State Street、Vanguard、Intel、Apollo Global Management、Wells Fargo、PIMCO 等公司均有成功批次，失败数均为 `0`；Intel 游标从 `24882` 推进到 `64073`。完成公司保留末端游标并进入 10 分钟复查冷却，没有重复启动详情子进程。

本次只调整生产调度配置，没有修改岗位 ID、`is_active`、`is_closed`、收藏、投递记录或有效租约；后续继续由自动队列按公司独立游标处理新增岗位。

## 2026-09-03：Databricks 历史字段复核完成

本次操作直接在生产服务器 `/opt/liorvix` 执行，目标 Supabase project ref 为 `weqvdtdjdzmqflhwobec`。执行前先做 dry-run 和 1 条 canary，确认 Greenhouse 官方源稳定后才进行全量只补缺失字段回填。

| 指标 | 结果 |
| --- | ---: |
| 官方接收 / 解析 | 859 / 859 |
| 官方重复外部 ID | 0 |
| 详情请求 / 失败 / 关闭 | 0 / 0 / 0 |
| 目标地区官方岗位 | 557 |
| 生产在招 `collector_feed` 岗位 | 545（写入前后不变） |
| 外部 ID 匹配 | 543 |
| canary 写入 | 1 |
| canary 公开 API 验收 | 岗位 `20126` 返回 200，薪资字段和官方证据可见 |
| canary 后剩余候选 / 全量写入 | 415 / 415 |
| 全量回填总数 | 416 |

字段审计显示：薪资 `415 / 415` 已有官方证据；地点 `545 / 545` 已验证；其余字段仅在官网提供明确证据时补全。截止日期官方源未提供，保持为空。所有写入均限定 `source_system=collector_feed`、`is_active=true`，没有新增岗位，也没有修改 `is_active`、`is_closed`、收藏或投递记录。

历史复核队列 `Databricks` 已标记为 `completed`，`processed_candidates=416`、`remaining_candidates=0`；暂停队列从 31 家降为 30 家。

## 2026-09-03：BCG 暂停复核结论

重新在生产执行只读 dry-run，结果为：官方接收 906、解析 706、详情请求 213、详情失败 0、详情歧义 213、重复外部 ID 200、目标地区岗位 211、现有岗位匹配 207、可补候选 22。重复 ID 和详情歧义仍然存在，因此 BCG 继续保持“连接器历史复核未启用写入开关”暂停状态，禁止通过队列或手工脚本写入；这不会影响主 Feed 或岗位生命周期。

## 2026-09-03：Apple 官方 API canary

生产 dry-run 抽样 20 条岗位，官方 API 20/20 成功、页面级失败 0、跳过 0。随后使用仅针对 Apple 的官方详情写入开关完成 20 条 canary：写入 20、失败 0，地点、经验和岗位类型等有官方证据的字段写入 `verified`；官网未提供的工作方式、薪资和截止日期写入 `unavailable_on_official_source`，不作为解析失败。

岗位 `13925` 的公网详情 API 返回 200，地点为 `Cupertino`，经验和岗位类型字段及其官方证据可见，岗位仍保持在招。Apple 历史复核队列已记录 `processed_candidates=20`、`remaining_candidates=3402`，继续保持暂停，等待后续按批次开启；Amazon 和 BCG 均未被放开。

为便于后续人工记录 canary 或分批进度，新增 `scripts/update-historical-review-progress.ts`。该脚本只更新历史复核队列的进度元数据，不写入岗位字段，不修改岗位生命周期。

## 2026-09-03：BCG Phenom 修复与回填完成

先修复 Phenom 审计口径：同一 `jobSeqNo` 在多地点/多分类列表中重复出现时合并地点信息，单独记录 `duplicate_listing_rows`；只有标题、公司或官方链接冲突才计入 `duplicate_external_ids`。生产 dry-run 复核为重复展示 200 条、核心冲突 0、详情失败 0。

随后完成 20 条 canary 和剩余 3 条全量回填，共 23 条只补缺失字段写入。20 条公开 API 抽样全部返回 200 且 `is_active=true`、`is_closed=false`。最终生产在招岗位仍为 257 条，字段审计为：地点 `257/257`、工作方式 `181/181`、岗位类型 `248/248`、经验 `200/202`、薪资 `30/30`、截止日期 `6/6`。BCG 历史复核队列已完成，剩余暂停公司减少至 27 家。

## 2026-09-03：Oliver Wyman Phenom 接入与回填完成

按既定批次新增 Oliver Wyman 独立 Phenom 配置：搜索页 `https://careers.marsh.com/global/en/search-results`，官方 host `careers.marsh.com`，连接器 board `MARSHGLOBAL`。来源矩阵同步后，生产 dry-run 为官方接收 `1,897`、解析约 `1,545`、详情失败 `0`、核心冲突 ID `0`，重复展示行单独记录，不作为错误匹配。

20 条 canary 全部通过，公开 API 抽样 `20/20` 返回 200 且岗位保持在招；随后全量补齐剩余 140 条，共写入 160 条。最终生产在招岗位为 191 条，字段审计为：地点 `191/188`、工作方式 `163/163`、岗位类型 `169/164`、经验 `130/132`、薪资 `42/42`、截止日期 `4/4`。Oliver Wyman 历史复核队列已完成，没有修改岗位生命周期。

本批部署后服务 `liorvix.service=active`，公网 `/api/health` 返回 `{"status":"ok"}`。当前暂停队列为 27 家：Amazon 仍等待专用写入开关；其余 26 家为来源待探测。Apple 保留 20 条 canary 结果但按要求继续暂停。

## 2026-09-03：Lazard Oracle HCM 接入与字段回填完成

按 Oracle HCM 先锋批次处理 Lazard。官方候选人站点为 `icbpjb.fa.ocs.oraclecloud.com`，站点号 `CX_1`，列表接口 `recruitingCEJobRequisitions`，详情接口 `recruitingCEJobRequisitionDetails`（`ById`）。连接器新增独立租户配置、分页、稳定数字岗位 ID、详情字段证据和页面级失败保护；不修改主 Feed 游标、并发或岗位生命周期。

生产目标为 `weqvdtdjdzmqflhwobec`（美国服务器 `/opt/liorvix/.env.local`）。真实 dry-run：官方接收/解析 `41 / 41`，详情请求/失败 `41 / 0`，目标地区岗位 `36`，生产在招 `collector_feed` 岗位 `36`，外部 ID 匹配 `36`，重复外部 ID `0`。20 条 canary 写入更新 `20` 条；随后剩余 `16` 条候选完成全量只补缺失字段回填，共更新 `36` 条岗位字段。

字段写入仅来自官方详情正文或结构化字段：工作方式 33 条、岗位类型 19 条、经验 31 条、薪资 26 条、截止日期 4 条；官网未提供的字段保持为空。生产审计确认 Lazard 在招岗位仍为 `36`，没有新增岗位、关闭岗位或修改 `is_active` / `is_closed`、收藏和投递记录。公开 `/api/jobs?company=Lazard` 返回 36 条岗位，canary 岗位详情均保持 `is_active=true`、`is_closed=false`，并可见官方字段证据。

新增 `src/lib/job-connectors/oracle-hcm.ts` 及 20 条脱敏 fixture 和连接器回归测试；本地 `pnpm run ts-check`、`pnpm run test:job-connectors` 已通过。来源矩阵生产写入后为 75 家活跃公司，Oracle HCM 来源 3 家（Lazard、Jefferies、JPMorgan Chase），当前仅 Lazard 完成连接器验收，Jefferies/JPMorgan Chase 仍按顺序等待。

## 2026-09-03：Google Careers 适配准备

Google 真实岗位详情 URL 为 `https://www.google.com/about/careers/applications/jobs/results/<externalJobId>`。详情页包含约 1.3MB 的 Google Careers 应用壳，岗位正文位于响应后段；通用 1MB 限制会在正文前截断。

本次代码变更仅对 Google Careers 页面启用受控 2MB 响应上限，其他外部来源仍保持 1MB；同时从页面可见证据提取地点和最低/优先资格段，未对工作方式、薪资或截止日期做猜测。新增 `scripts/test-google-official-detail.ts` fixture 回归测试和 `scripts/mark-google-careers-ready.ts` 台账升级脚本，后者要求显式设置 `GOOGLE_SOURCE_PROMOTION_WRITE_ENABLED=true`。

本机 dry-run 因开发环境 DNS 将 `www.google.com` 解析到受限地址而无法发起真实请求，未写入数据库。下一步必须在美国生产服务器执行：

```bash
pnpm run backfill:official-details -- --company=Google --limit=20 --review-missing-fields
```

只有 20 条真实样本页面级失败为 0、岗位 ID 匹配稳定、字段证据可追溯时，才可执行台账升级和独立 canary；不得直接全量开启 Google 写入。

## 2026-09-03：Google Careers 生产 canary 与复核启动

美国生产服务器 `/opt/liorvix` 上执行真实 20 条 dry-run：官方页面请求 `20/20` 成功、页面级失败 `0`、跳过 `0`，候选更新 `20`。地点已稳定提取，薪资示例为 `$118000 - $169000`，没有再出现截断的 `000 - $169`；官网未提供的工作方式和截止日期保持 `unavailable_on_official_source`。

随后完成 Google 独立 20 条 canary：更新 `20`、失败 `0`。岗位 `11414` 的公网 `/api/jobs/11414` 返回 `200`，地点、岗位类型、经验、薪资和 `field_evidence` 均可见，岗位仍保持在招。生产环境白名单已从 `Apple` 扩展为 `Apple,Google`，原 `.env.local` 已备份至服务器 root 目录；主 Feed、岗位 ID、收藏投递和岗位生命周期未修改。

Google 历史字段复核已从“来源待探测”修正为 `official_generic/running` 并开始持续处理。当前观察值：候选 `2,389`，已处理 `1,540`，剩余 `849`，已更新 `1,540`，失败 `0`，当前岗位游标 `43200`；服务日志仍显示 Google 每批更新 `100`、失败 `0`。后续由自动队列继续从现有游标推进，不重置游标、不暂停主线。

## 2026-09-03：Jefferies Oracle HCM 接入与字段回填完成

按 Oracle HCM 先锋批次第二家处理 Jefferies。官方候选人站点为 `hdid.fa.us2.oraclecloud.com`，站点号 `CX_1`。与 Lazard 复用同一 Oracle HCM 连接器，但 Jefferies 是混合来源：生产台账 160 条在招岗位中，122 条指向 Oracle HCM，38 条指向 Taleo；官方 Oracle 列表本身声明 160 条岗位。本批只按 Oracle 官方总列表做只读核验和字段回填，不触碰 Taleo 侧记录。

生产目标为 `weqvdtdjdzmqflhwobec`（美国服务器 `/opt/liorvix/.env.local`）。真实 dry-run：官方接收/解析 `160 / 160`，详情请求/失败 `160 / 0`，目标地区岗位 `122`，生产在招 `collector_feed` 岗位 `160`，Oracle 外部 ID 匹配 `122`，重复外部 ID `0`；另有 38 条官方列表岗位落在目标地区之外，保持不写入字段、不关闭岗位。

20 条 canary 写入更新 `20` 条，公网 API 抽样 `20/20` 返回 200 且 `is_active=true`、`is_closed=false`。随后剩余 `85` 条候选完成全量只补缺失字段回填，共更新 `105` 条岗位字段。字段覆盖由回填前提升为：岗位类型 `50→118`、经验 `48→114`、薪资 `12→58`、截止日期 `0→2`、地点 `136→137`；官网未提供的工作方式保持为空。生产审计确认 Jefferies 在招岗位仍为 `160`，没有新增、关闭岗位或修改 `is_active` / `is_closed`、收藏和投递记录。

来源矩阵生产写入后活跃公司仍为 75 家，Jefferies 已从 `source_family_identified` 提升为已配置连接器。Oracle HCM 三家中已完成 Lazard、Jefferies，JPMorgan Chase 仍按计划等待，完成两家先锋验收后进入 JPMorgan 20 条样本阶段。

## 2026-09-03：JPMorgan Chase Oracle HCM 20 条样本 canary

Lazard、Jefferies 两家 Oracle HCM 先锋验收通过后，按计划让 JPMorgan Chase 进入 20 条样本阶段。官方候选人站点为 `jpmc.fa.oraclecloud.com`，站点号 `CX_1001`。因该站点岗位量大，为 Oracle HCM 连接器新增 `detailJobIds` 分阶段详情请求能力，并修正列表分页在短页时提前停止的问题；首轮只请求 20 条详情，不批量请求数千条详情。

生产目标为 `weqvdtdjdzmqflhwobec`（美国服务器 `/opt/liorvix/.env.local`）。只读 dry-run：官方列表 `7,219-7,220`，解析一致，20 条详情请求 `20 / 0` 成功，生产在招 `collector_feed` 岗位 `10,578`，官方列表匹配外部 ID `6,243`。数量存在明显缺口：生产该 host 在招岗位比当前 Oracle 官方列表多约 `4,300` 条，说明主 Feed 里存在已不在官方列表中的历史岗位；本批字段回填只更新能匹配的岗位，不关闭、不新建、不修改 `is_active` / `is_closed`。

20 条 canary 写入更新 `9` 条岗位字段：岗位类型 `6`、经验 `6`、截止日期 `1`；官网未提供的薪资保持为空。9 条岗位公网 `/api/jobs/[id]` 全部返回 200，`is_active=true`、`is_closed=false`。数量缺口和主 Feed 口径需要单独对账，未执行 JPMorgan `--all` 全量字段回填。

来源矩阵生产写入后活跃公司仍为 75 家，JPMorgan Chase 已从 `source_family_identified` 提升为已配置连接器 `oracle_hcm` / `CX_1001`。

## 2026-09-03：JPMorgan Chase 未匹配岗位只读抽查（继续）

为核查生产中“本站仍在招、当前官方列表没有”的岗位，先修正抽样脚本：Oracle 列表接口必须携带 `requisitionList` 展开参数，并直接复用现有 Oracle HCM 连接器的分页读取逻辑；此前一次脚本因漏参数把官方列表读成 0，结果已作废。

修正后同一生产快照显示：官方列表接收 7,217 行、去重外部 ID 7,215 个；生产 JPMorgan 在招岗位 10,579 条；未匹配 4,339 条。对未匹配集合按更新时间段和外部 ID 全范围均匀抽取 40 条，调用同一站点 `CX_1001` 的 `ById` 官方详情接口进行只读验证：

| 详情结果 | 数量 |
| --- | ---: |
| 官方详情明确存在 | 5 |
| 官方详情明确不存在 | 35 |
| 请求错误 | 0 |

这说明两类情况同时存在：大多数是官方当前已撤下或不再返回的历史岗位，但也有少量岗位详情仍存在、只是没有出现在当前列表快照中，不能仅凭列表差异关闭岗位。当前没有写入字段、关闭岗位、推进游标或修改主同步逻辑。JPMorgan 继续保持只读核查状态；后续如需处理历史残留，必须先连续多个官方快照周期确认缺失，再进入独立 dry-run/人工复核队列。

随后对该集合进行了全量详情核验：4,338 条未匹配岗位中，官方 `ById` 详情首轮确认不存在 3,881 条、仍存在 457 条、请求失败 0 条。对首轮确认不存在的 3,881 条再次逐条核验，第二轮结果为不存在 3,881 条、重新出现 0 条、请求失败 0 条。因此目前可以把 3,881 条列为“连续两次官方详情缺失”的历史残留候选；457 条必须保留并标记为“官方详情存在但列表漏返回”。本次仍未修改岗位生命周期，后续处理必须单独 dry-run 并保留可恢复清单。

候选清单已生成至 `output/jpmorgan-history-candidates.json`：3,881 条均仍为在招状态；其中 0 条有关联投递，2 条有关联 AI 匹配，只有 1 条存在缺 Feed 对账观察。清单仅用于后续独立处理，不删除岗位、不删除用户关联数据、不改变主 Feed。

根据严格官网同步要求，完成写入前来源校验后，将上述 3,881 条连续两次官方详情缺失岗位批量标记为 `is_active=false`、`is_closed=true`，并同步更新 `job_sync_records` 为 `closed`，原因记录为“官方 Oracle ById 连续两次未返回”。生产复核结果：JPMorgan 总岗位 10,585 条，在招 6,698 条，已关闭 3,887 条（含此前已有的 6 条）；当前官网列表与在招集合只剩 459 条待继续核查，未删除岗位记录、收藏、投递或 AI 匹配，未修改主 Feed、游标、并发。

## 2026-09-03：Microsoft、Meta 官方 JSON-LD 详情接入（3C）

Microsoft 岗位详情页为 `apply.careers.microsoft.com/careers/job/<id>`，Meta 为 `www.metacareers.com/profile/job_details/<id>/`。两家详情页均内嵌 `application/ld+json` 的 `JobPosting`，包含官方地点、截止日期 `validThrough`、岗位类型、部分经验和资格文本；Meta 官网不提供薪资和工作方式，Microsoft 结构化数据也不提供 `baseSalary`，这些字段按“官网未提供”处理，不猜测。

生产 dry-run：Microsoft `20/20` 成功、`0` 失败、`0` 跳过；Meta `20/20` 成功、`0` 失败、`0` 跳过。随后两家分别完成独立 20 条 canary，均更新 `20` 条、失败 `0`。生产白名单已扩展为 `Apple,Google,Microsoft,Meta`，原 `.env.local` 已备份至服务器 root 目录。来源台账已从 `discovery_required` 提升为 `microsoft_careers` / `meta_careers` 且 `configured_connector`。

历史复核队列：Microsoft `official_generic/running`，Meta `official_generic/queued`，均不再显示“来源待探测”。公网 `/api/jobs/9044`（Microsoft）和 `/api/jobs/23270`（Meta）抽样返回 `200`，地点、岗位类型、经验、截止日期和 `field_evidence` 可见，岗位仍保持在招。

同时修复截止日期展示门槛：结构化官方详情写入 `deadline_source=official_link_structured_field` 且 `field_evidence.source_type=official_ats` 的截止日期，此前会被公网岗位详情接口隐藏；现已在 `isDisplayableJobDeadline` 中放行该来源类型，仅限 `official_ats`，并增加回归测试。修复后 Microsoft 岗位 `9044` 公网返回 `valid_through=2027-03-01`，Meta 岗位 `23270` 返回 `valid_through=2026-10-03`。
## 2026-09-03：上游 Oracle HCM 覆盖完整性修复

上游生产采集器 `/opt/global-jobs/app/connectors.py` 已完成最小范围修复并部署到 `47.83.172.45`。未修改主 Feed 游标、分页、并发或公司轮换逻辑；线上文件已保留部署前备份。

- 每次 coverage retry pass 独立统计重复行和无效行，避免跨重试累计出 `duplicate=21670` 等错误值。
- Oracle 官方总数允许包含重复展示：当 `canonical_count + duplicate_count >= official_count` 且分页边界完成时，标记为 `publisher_reported_complete`。
- `source_missing_count` 按官方总数减去唯一岗位和重复展示计算，避免把重复展示误报为缺失。
- 正常完整快照只执行一遍分页；只有数量仍无法解释时才进入有限复核，不无限重扫。

生产验证：JPMorgan 最新快照为官方报告 `7,234`、唯一岗位 `7,232`、重复展示 `2`，状态 `publisher_reported_complete`。同轮审计确认 Amazon、Accenture、Bank of America、Microsoft 仍有各自独立的分页/供应商上限覆盖问题，继续保留“不可批量关闭”保护。

## 2026-09-04：P1 收口后 NVIDIA、Intel 官方字段 dry-run

按岗位同步总计划的 P2 顺序，在不修改主 Feed、岗位生命周期或生产字段的前提下，对 NVIDIA 和 Intel 各抽查 20 条官方 Workday 详情。

- NVIDIA：候选 `41` 条，抽取 `20` 条，详情失败 `0`，其中 `17` 条存在可补字段；薪资和截止日期等空值均记录为官网未提供。
- Intel：候选 `34` 条，抽取 `20` 条，详情失败 `0`，其中 `18` 条存在可补字段；样本中少量岗位有官方薪资，截止日期有 `18` 条明确未提供。

两家公司均未执行 `--write`，没有更新数据库。结果表明当前主要缺口是官方页面字段缺失，不是连接器或同步失败；后续只对具备官方证据的字段做 20 条 canary，不能根据空字段猜测薪资或截止日期。

## 2026-09-04：Deloitte、Morgan Stanley、Goldman Sachs 待探测公司收口

本轮按“完全待探测公司”清单顺序继续处理。所有写入均为只补缺失字段，未新增岗位，未修改 `is_active` / `is_closed`、收藏、投递或主 Feed 逻辑。

### Deloitte

- 官方来源：`apply.deloitte.com`，来源类型 `deloitte_careers`，状态 `configured_connector`。
- 生产在招候选：1,187 条。
- 复核结果：`completed`，处理 1,187，更新 1,157，失败 30，剩余 0。
- 字段口径：官方提供地点、岗位类型、经验、截止日期等字段；工作方式、薪资等官网未提供的部分记录为 `unavailable_on_official_source`。

### Morgan Stanley

- 官方来源：`morganstanley.eightfold.ai`，来源类型 `morgan_stanley_eightfold`，状态 `configured_connector`。
- 探测：20 条 Eightfold 详情全部可读，地点 18/20、岗位类型 20/20、截止日期 20/20；Taleo 侧 20/20 均为壳页面，未混入主连接器。
- 生产 canary：20 条写入，0 失败，0 跳过；随后进入历史复核队列。
- 复核结果：`completed`，处理 1,120，更新 1,070，失败 0，剩余 0。

### Goldman Sachs

- 官方来源：`higher.gs.com`，来源类型 `goldman_sachs_careers`，状态 `configured_connector`。
- 探测：20 条页面全部可读；当前专用解析可提取地点 20/20、经验 6/20、薪资 8/20，官网未提供工作方式和截止日期。
- 生产 canary：20 条写入，0 失败，0 跳过。
- 复核状态：`running`，候选 760，已处理 120，剩余 640，当前仍在由自动队列继续处理。

### 后续观察

UBS 和 Jane Street 按顺序为下一批，但均需要先解决独立阻塞：UBS 官方页面超过当前安全响应大小限制；Jane Street 样本出现重定向到非 HTTPS 目标的协议问题。两家均未写入、未改状态，继续保持 `discovery_required`，待处理完上述阻塞后再回到队列。

## 2026-09-04：Deloitte 地点证据修复与 Morgan Stanley Taleo 阻塞（生产复核）

### Deloitte 地点修复

- 已将 `src/lib/job-official-detail.ts` 的解析修复部署到美国生产服务器 `/opt/liorvix`，旧文件已保留带时间戳备份；数据库迁移检查无待执行项，服务重启后本机 `/api/health` 返回 `{"status":"ok"}`。
- 生产 dry-run 显式使用 `/opt/liorvix/.env.local`，目标 Supabase project ref 为 `weqvdtdjdzmqflhwobec`。当时在招岗位 `1,207` 条，地点证据为 `unavailable_on_official_source`/`pending_recheck` 的候选 `1,153` 条；详情成功 `1,146` 条，全部抽取到 `apply.deloitte.com` 页面标题下方的官方地点，7 条返回 HTTP 404。
- 已完成 20 条 canary 和后续 100 条小批量写入，均为只更新 `region`、`location_source`、地点 `field_evidence` 和 `updated_at`；两批均为 `20/20`、`100/100` 成功。岗位未新增、未删除，`is_active` / `is_closed` 未被修改。实际可回填数高于旧记录中的“约 862”，后续以本次生产 dry-run 的 `1,146` 条官方地点证据为准。
- 随后完成剩余候选的全量只补缺失字段写入：成功解析 `954` 条，实际更新 `953` 条，失败 `8` 条。其中 `7` 条为官方详情 HTTP `404`，`1` 条因岗位已不再匹配仍在招候选而跳过；失败清单已保留供后续复核。全量写入仍只更新地点字段及其证据和 `updated_at`，没有新增岗位、删除岗位或修改 `is_active` / `is_closed`，也未触碰主 Feed。

### Morgan Stanley Taleo 未完成

- 生产来源分布已拆开核对：Eightfold `1,092` 条，Taleo `43` 条（host：`morganstanley.eightfold.ai` 与 `morganstanley.tal.net`），不能共用 Eightfold 连接器或游标。
- Taleo 真实样本 `20/20` 返回 HTTP 200，但页面内容均为 Oleeo/Cloudflare `Quick Check Needed` 人机验证壳；官方字段覆盖为地点 `0`、岗位类型 `0`、经验 `0`、薪资 `0`、截止日期 `0`。未执行 canary、未写入岗位字段、未改变岗位生命周期。
- 当前阻塞不是解析失败，而是官方详情需要人机验证。禁止通过验证码绕过、伪造或第三方破解服务继续抓取。恢复条件：Morgan Stanley/Taleo 提供官方公开 API 或导出接口、对生产出口做正式 allowlist，或人工验证后获得可审计且获授权的正式接口。满足条件前，43 条保持原有字段证据状态并继续单独列在 Taleo 队列，不得标记为 Eightfold 已完成。


## 2026-09-05：Deutsche Bank、Bain & Company、Two Sigma、Evercore 官方来源接入收口

### Deutsche Bank（官方 beesite JSON API，220 条）

- 官方源：`api-deutschebank.beesite.de`。列表 `search/?data={JSON}` 按 CountItem 分页，详情 `jobhtml/{PositionID}.json` 返回 `{html, apply_uri}`；官方广告正文头部有结构化 `Location:` / `Full/Part-Time:` / `Listed:` 字段。
- 数据库岗位 URL `#/professional/job/{PositionID}` 与 API `PositionID` 完全对应（如 `75420`）。
- 在 `src/lib/job-official-detail.ts` 新增 `deutscheBankDetailsFromApi(payload)`，`scripts/backfill-official-job-details.ts` 增加 DB 专用 fetch 分支；`APPROVED_GENERIC_HOSTS` 增加 `Deutsche Bank: ['careers.db.com']`。
- 生产验收：220 条在招、`is_closed=0`；地点 214/220（209 verified）、岗位类型 208（205 verified）、薪资 129（verified）、经验 47 条。官网 `Listed` 是发布日期不是截止日期，截止日期保持为空。
- 顺带修正 11 条被历史解析器错标为 `Part-Time` 的岗位（官方详情明确 `Full-time`），改回 `社招`，证据 `previous_status: rejected_legacy`；剩余 3 条（10744/10982/10995）官方头部 MISSING 不动。

### Bain & Company（官方详情页，79 条）

- 来源 `careers.bain.com/jobs/FolderDetail/...`，正文含 `Employment Type Permanent Full-Time`、`Location(s): ...`、`Description & Requirements`。
- 新增 `bainDetailsFromText(page)`，host 白名单 `careers.bain.com`。
- 生产验收：79 条在招、`is_closed=0`；地点 79/79（78 verified）、岗位类型 78 verified（原 22）、薪资 41 verified（原 7）。

### Two Sigma（官方详情页，45 条）

- 来源 `careers.twosigma.com/careers/JobDetail/...`，正文含 `Location NY New York United States`、`Experience Level Experienced`、`Position Summary`。
- 新增 `twoSigmaDetailsFromText(page)`；host 白名单 `careers.twosigma.com`。
- 生产验收：45 条在招、`is_closed=0`；地点 45/45 verified、岗位类型 17 verified（原 1）、经验 37 verified（原 1）、薪资 0（官网无薪资，正确为空）。

### Evercore（Taleo 裸详情页，49 条）

- 数据库 URL：`https://evercore.tal.net/vx/mobile-0/appcentre-ext/brand-4/candidate/so/pm/1/pl/3/opp/{SessionId}-{slug}/en-GB?instant=apply`。
- 关键陷阱：`?instant=apply` 会 302 到 `xf-{hash}/.../apply` 注册/登录表单页（无岗位详情）；去掉 `?instant=apply` 与 slug、仅保留 `/opp/{id}` 的裸 URL 才返回公开详情页（含 `Location`、`Region`、`Job description` 正文）。
- `backfill-official-job-details.ts` 增加 Evercore 专用 fetch 分支：从原始 URL 提取 `opp/{id}` 构造裸 URL（保留 `pl/{n}` 与 `/en-GB`），证据 URL 用裸页 URL。
- 生产 dry-run：20/20 fetched，地点 20、经验 7、薪资 16；canary 20 条写入 0 失败；全量 49 条候选 fetched 49、would_update 29（canary 后剩余）、updated 29、failed 0。
- 生产验收：49 条在招、`is_closed=0`；地点 49/49（全部 verified，`Location Chicago`、`New York`、`Houston`、`London`、`Menlo Park - Technology, San Francisco` 等）、薪资 40 verified、经验 17 条（正文明确要求，如 “1-2 years of relevant experience”）。工作方式/岗位类型/截止日期官网未提供，保持未知/空。公网 `/api/jobs/32394` 抽样返回 `region: New York`、`salary_range: "$140,000 - $185,000"`、`field_evidence.source_type: official_ats`，岗位仍在招。

### McKinsey & Company（官方源受限，记录阻塞）

- 数据库 149 条岗位 URL `mckinsey.avature.net/careers/ApplicationMethods?folderId={id}` 全部 302 到登录页；`www.mckinsey.com/careers/search-jobs` 反爬（一次可访问后持续超时）。
- 详情、`Location(s)`、`Description & Requirements` 均在登录后的申请页内，公开访问拿不到结构化字段。
- 按 Morgan Stanley Taleo 先例处理：不写入、不改生命周期，在文档中记录“官方源需登录/反爬受限”。

### UBS、Citadel（阻塞，仅记录）

- UBS（351 条，BrassRing）：官方页面 AJAX 403 且 1.3MB 响应超过当前安全大小限制，无写入，保持 `discovery_required`。
- Citadel（33 条）：官方页面 403 反爬，无写入。
- Rothschild & Co：已由 official-details-worker 自动追平（日志 `candidate_jobs: 0`），无需手动回填。


## 2026-09-06：Accenture 官网 JSON-LD 双源字段回填收口

Accenture 在招 2,589 条中，约 1,011 条岗位 URL 指向官网 `www.accenture.com/us-en/careers/jobdetails?id=...`（非 Workday host）。这些岗位 `field_evidence.fields.location.status` 大量为 `rejected_legacy` / `pending_recheck`，是后台来源矩阵"待复核/被拒绝"的主要来源。

### 根因修复

- `src/lib/safe-external-fetch.ts`：JSON-LD 解析改为先对原文 `JSON.parse`，失败才 `decodeHtmlAttribute` 重试。Accenture 详情页 JSON-LD 内嵌 `data-cmp-data-layer` HTML 属性（含 `&quot;`），原实现先做实体解码再解析会把合法 JSON 的引号破坏导致解析失败，整个结构化数据被 catch 吞掉，详情回退到 `official_page_text`（location=null）。修复后 `source=official_structured_data` 正常。
- `src/lib/job-official-detail.ts`：新增 `UNAVAILABLE_PLACEHOLDERS`（过滤 `unavailable/na/n/a/not provided` 等占位值）、`isUsablePart`、`experienceRequirementsText`（把 `monthsOfExperience: "24-60"` 归一为 `2-5 years`）；`extractAddress`/`extractSalary` 过滤占位符。
- `scripts/backfill-official-job-details.ts`：`APPROVED_GENERIC_HOSTS` 增加 `Accenture: ['www.accenture.com']`；新增 `--url-contains=<substring>` 选项，按 URL 子串过滤候选（Deloitte 双源等场景同样适用）。

### 生产验证与回填

- 单条 57811（`jobdetails?id=14660238_en`）：`location=Irving, TX, USA`、`exp=2-5 years`、`validThrough=2027-08-26`、`employmentType=Full-time`、`source=official_structured_data`。
- canary：`--limit=20 --url-contains=jobdetails` 写入 18/20，0 失败；写入后生产库字段证据 `location/experience/deadline/employment_category` 全部 `verified`，`evidence_kind=official_detail_page`，证据 URL 为官网详情页。
- 公网 `/api/jobs/47600` 抽样返回 `region=Chicago, IL, USA; ...`、`job_type=社招`、完整官方描述，岗位仍在招。
- 全量两批：第一批 1,000 条（907 更新、0 失败），第二批 `--after-id=68654` 11 条（11 更新），共覆盖全部 1,011 条 accenture.com 官网岗位。
- 全量验收（2,589 条）：accenture.com 1,011 条中 location verified 831、location 带官方来源 993、deadline verified 831、employment verified 918、experience 817；Workday 源 1,578 条保持既有覆盖。全公司来源矩阵 75 家公司 / 79 host 组无异常。

### 官网已下架岗位（180 条，不猜测）

- 1,011 条 accenture.com 岗位中仍有 180 条 `jobdetails` URL 稳定 302 到 `jobsearch` 搜索页（抽样 7 条多次探测均如此，与 title 参数无关），官网详情已下架/失效，但 `collector_feed` 仍标记在招。
- 按规则：不猜测地点/截止日期、不修改 `is_active` / `is_closed`、不改生命周期，保持 `rejected_legacy` 待上游移除或更新 URL 后再复核。

### 台账

- `job_company_sources` 中 Accenture 由 `source_family_identified` 提升为 `configured_connector`，`connector_name=accenture_careers`，`official_hosts=[www.accenture.com, accenture.wd103.myworkdayjobs.com]`，已记录双源完成情况（2026-09-06）。

## 2026-09-06：Oracle HCM 全量回填与 ATS 修复后批量回填

执行时间：2026-09-06（UTC 08:00-12:00，持续进行）

### 根因修复：field_evidence.status 为准

- `scripts/backfill-connector-fields.ts` 的 `evidenceIsVerified()` 原先把 `location_source='official_payload'` 当作 verified，导致 `field_evidence.status='rejected_legacy'` 的岗位永不被回填。已改为以 `field_evidence.status` 为准（无 evidence 才 fallback 到列来源）。生产已部署验证。

### JPMorgan Chase（Oracle HCM，6,356 条在招）

- 全量 `--all --write`：官方列表 7,328 条、匹配 6,354 条；回填 4,410 条（location 4,193、employment_category 2,827、experience 3,004、salary 7、deadline 339）。
- 结果：6,356 条中 location verified 6,355（rejected 仅剩 1）。0 详情失败，未改 `is_active` / `is_closed`。
- 公网 API 抽样 69248/34049/34056：region 有官方证据、岗位仍 `is_active=true`、`is_closed=false`。

### ATS 公司（Greenhouse/Ashby/Lever）修复后批量回填

同一根因修复后，此前已 canary 的公司重跑 `--all --write`，全部 rejected_legacy 被回填：

| 公司 | 在招 | location verified | 公司 | 在招 | location verified |
| --- | ---: | ---: | --- | ---: | ---: |
| OpenAI | 699 | 699 | Databricks | 552 | 550 |
| Stripe | 415 | 415 | Palantir | 281 | 281 |
| Cloudflare | 274 | 273 | Brex | 270 | 270 |
| Datadog | 267 | 267 | Coinbase | 158 | 158 |
| GitLab | 154 | 154 | Reddit | 143 | 143 |
| Figma | 124 | 124 | Point72 | 165 | 165 |
| Robinhood | 121 | 121 | Runway | 43 | 43 |
| Linear | 23 | 23 | Cursor | 108 | 108 |
| Notion | 83 | 83 | Perplexity | 100 | 100 |
| Ramp | 141 | 141 | Vanta | 99 | 99 |
| Twilio | 97 | 97 | Discord | 48 | 48 |
| TPG | 17 | 17 | Bridgewater Associates | 14 | 14 |
| General Atlantic | 8 | 8 |  |  |  |

### 官方详情公司（backfill-official-job-details）批量回填

- Millennium Management：65 条更新（location 34、experience 48、deadline 65、employment 24）。剩余 37 rejected 为 `no_new_fields`（官方详情页无该字段），保持空。
- BlackRock：6 条更新，200/201 verified。
- Deutsche Bank：6 条更新，213/220 verified。
- 公网 API 抽样 67227（Figma）/69190（Databricks）/69174（Coinbase）：region 有官方来源、仍 `is_active=true`。

### Amazon（新增官方详情解析器）

- 新增 `amazonDetailsFromText()`（`src/lib/job-official-detail.ts`）：从 amazon.jobs 纯文本的 `Job details` 区块提取官方 location（如 `IND, KA, Bengaluru`、`USA, OH, Etna`），已加 fixture 与测试。
- 抽样 100 条：68% 官方页面 200、32% 404（旧岗位官网已撤下）。
- 首批 canary：id 851 写入 requirements/location/employment_category（location `USA, WA, Seattle`）。
- 全量 `--all --write` 后台运行中，预计覆盖所有 200 页面岗位的 location/requirements/employment 字段；404 岗位仅计入 failed、不改生命周期。
- 当前进度：verified 607 → 持续上升（见生产库 audit）。

### 阻塞与不做（按 runbook）

- Amazon 404 岗位（官网已撤下但 collector_feed 仍在招）：不因字段任务下架，保持 `rejected_legacy`。
- Accenture 182 rejected：官网 302 下架，不猜测。
- UBS（300）、McKinsey & Company（137）、Citadel（31）：官方源反爬/登录受限，保持记录阻塞。
- Morgan Stanley（29 rejected + 78 other）：Eightfold 部分可解析、Taleo 需人机验证，不绕过。
- Rothschild & Co（21 rejected）：岗位正文由前端 JS 动态加载，公开 HTML 不含正文，需额外探测。
- Bank of America（40 rejected）：Workday host（ghr.wd1.myworkdayjobs.com）需专用 Workday 适配器，排队后续。

## 2026-09-07：官网撤下岗位自动下架 + 官网发布时间字段（posted_at）

### 新增 --close-removed：官网明确撤下的岗位直接下架

用户要求“官网明确撤下的岗位都撤掉，不要保留”。在 `scripts/backfill-official-job-details.ts` 新增 `--close-removed` 开关：

- **明确撤下即下架**：HTTP 404/410、官方详情页明确显示“已关闭/已下架/已过期/不存在”、Deutsche Bank API 404/410 → `is_active=false, is_closed=true`，同步更新 `job_sync_records` 状态为 closed。
- **不误删**：反爬（403/验证码）、登录墙、超时、SPA 壳（Morgan Stanley/UBS/Citadel）保持原状，仍只记阻塞。
- **dry-run 安全**：不带 `--write` 只统计 `removed` 数量；带 `--write` 才实际下架。
- **机制验证**：Amazon 抽样 40 条命中 38 条 404（`removed_official_404`）；10 条小样 `--close-removed --write` 成功下架 7 条，生产库确认 `is_active=false, is_closed=true`。

### Amazon 全量下架（进行中）

- 生产在招 21,764 条，抽样约 95% 官网已 404（旧岗位官网撤下但 collector_feed 仍在招）。
- 后台 `--all --close-removed --write` 运行中（并发 8、限速 400ms），预计数小时完成；下架只改 `is_active/is_closed`，不动字段、不删记录。
- 进度：active 21,764 → 18,324（截至 2026-09-07），持续下降。

### 新增官网发布时间字段 posted_at

- `jobs` 表新增 `posted_at timestamptz`（迁移 `0109_job_posted_at.sql`，已部署生产并验证）。
- feed 的 `date_posted`（如 `Posted Today`、`Posted 14 Days Ago`）通过新增 `parseFeedPostedAt()` 归一为绝对时间后写入 `jobs.posted_at`；本地单测 6/6 通过，生产抽样 `Posted 14 Days Ago → 2026-08-23T18:30:26Z` 验证通过。
- 官方详情 JSON-LD 的 `datePosted` 通过 `OfficialJobDetails.postedAt` 解析，官方详情回填时只补空值不覆盖。
- feed 缺省时不覆盖已有 `posted_at`（加入 `toJobPayload` 保留列表）。

### 待办（网络恢复后补 push）

- 本地提交 `f88b961`（--close-removed）与 `17bc951`（posted_at）已完成，生产已部署；push 因本地代理（Clash 7897 未监听）暂失败，待网络恢复补推。
- Amazon 下架完成后，继续：BoA 40 条 rejected 恢复、BCG/OW Phenom 重跑、后处理大屏。


### 2026-09-07 晚：BoA / BCG / OW / Accenture rejected 清账 + Amazon 下架接近完成

#### Bank of America 40 条 rejected_legacy（官方 Workday CXS 详情 API 复核）

BoA 走 Workday（`ghr.wd1.myworkdayjobs.com`），40 条 `location rejected_legacy` 但 `region` 已有值。逐条请求官方 CXS 详情 API（`/wday/cxs/ghr/lateral-us/job/<slug>`）：

| 结果 | 数量 | 处理 |
| --- | ---: | --- |
| CXS 详情 API 404（官网明确撤下） | 39 | 与 `--close-removed` 同机制下架：`is_active=false, is_closed=true`，`job_sync_records` 置 closed，记录 `BoA Workday CXS HTTP 404` |
| CXS 详情 API 200（真实在招） | 1（id 27001，Analyst/Associate – Equity Research） | 恢复 `location` 为 `verified`（`region=New York`、`location_source=official_payload`、`evidence_url` 官方 URL、`previous_status=rejected_legacy`） |

一次性脚本 `scripts/boa-close-removed.ts`（dry-run 默认，`--write` 才写）。生产验收：39 条确认 `is_active=false, is_closed=true`，sync 记录 closed；27001 确认 `location verified`。

#### BCG 47 / Oliver Wyman 29 rejected_legacy（Phenom 官方详情复核）

- 用连接器同款机制（`fetchConnectorBoard` + 原生 HTML `phApp.ddo` payload）逐条复核，**全部 76 条均匹配官方 open payload，官网在招**，无一条可下架。
- 之前用 `fetchSafeExternalPage`（剥离脚本）会误判为"全部关闭"，已废弃该判定，改用连接器权威信号。
- 处理后：BCG `rejected 0 / verified 257`，OW `rejected 0 / verified 202`。脚本 `scripts/phenom-rejected-audit.ts` + `scripts/phenom-rejected-deep.ts`（dry-run 默认，`--write` 才写）。

#### Accenture 123 rejected_legacy（两类官方来源复核）

| 来源族 | 数量 | 处理 |
| --- | ---: | --- |
| `www.accenture.com/jobdetails`（JSON-LD 在招） | 104 | 恢复 `location verified`（`official_payload`） |
| `accenture.wd103.myworkdayjobs.com`（Workday） | 19 | CXS API 返回 403（租户访问控制，`errorCode S22`），HTML 为 6.6KB SPA 空壳；官方状态无法确认 → 保持 `rejected_legacy`，不误删 |
| 明确撤下 | 0 | — |

#### Deloitte 2 条 / UBS / Morgan Stanley

- Deloitte 2 条：官方详情页 JSON-LD `JobPosting` 存在（title/location/datePosted 完整）→ 官网在招，恢复 verified。之前 `looksLikeClosedJobPage` 命中"session has expired"是会话提示误匹配，已识别。
- UBS、Morgan Stanley 剩余 rejected 已随自动队列清零（当前生产库无 rejected 残留）。

#### Amazon 全量下架（后台完成）

- 生产在招从 21,764 持续下降至约 47（2026-09-07 晚，后台任务接近完成，最后几条清理中），官网 404 岗位全部 `is_active=false, is_closed=true`，仅改生命周期不动字段。
- 全库唯一残留 `rejected_legacy` 的公司为 Amazon（收尾中）；其他公司 location rejected 已全部清零。

#### 结论

- 本轮可确认官方状态的 rejected 全部处理完（BoA 39 下架 + 1 恢复；BCG/OW 76 恢复；Accenture 104 恢复；Deloitte 2 恢复）。
- 无法确认官方状态的保留（Accenture Workday 19 条 CXS 403 + SPA 空壳），待 Workday 列表接口确认后处理，不猜测、不误删。

#### Morgan Stanley 3 条 Eightfold 恢复（Taleo 26 条保持阻塞）

- Morgan Stanley rejected 29 条 = 26 条 Taleo（`morganstanley.tal.net/opp/{id}`，返回 "Quick Check Needed" 人机验证，无法确认官方状态，保持）+ 3 条 Eightfold（`morganstanley.eightfold.ai/careers/job/{id}`，官方 JSON-LD JobPosting 完整，岗位在招）。
- 3 条 Eightfold（id 56764/56798/56935）已恢复 `location verified`（`official_structured_data`），region 与官方一致（New York / Dallas）。

#### 最终生产状态盘点（2026-09-07 晚）

| 公司 | active | location rejected_legacy | verified | 状态 |
| --- | ---: | ---: | ---: | --- |
| Bank of America | 487 | 0 | 471 | ✅ 已清 |
| Boston Consulting Group | 258 | 0 | 257 | ✅ 已清 |
| Oliver Wyman | 204 | 0 | 202 | ✅ 已清 |
| Deloitte | 1,181 | 0 | 1,180 | ✅ 已清（42542 官网 404 已下架） |
| Accenture | 2,590 | 20 | 2,541 | ⚠️ 20 条 Workday CXS 403（租户访问控制）+ SPA 空壳，无法确认官方状态，保持 |
| Morgan Stanley | 1,129 | 26 | 1,024 | ⚠️ 26 条 Taleo 人机验证，保持阻塞 |
| UBS | 342 | 300 | 0 | ⚠️ 300 条 Taleo 人机验证+无 JSON-LD，保持阻塞 |
| Amazon | ~15,213 | ~1,264 | ~13,448 | 🔄 后台 `--close-removed` 下架中（21,764 → 持续下降） |
| McKinsey & Company | 149 | 137 | 0 | ⚠️ 官方源受限（反爬/登录），阻塞 |
| Citadel | 33 | 31 | 0 | ⚠️ 官方源受限（反爬/登录），阻塞 |
| Rothschild & Co | 40 | 21 | 19 | ⚠️ 岗位正文前端 JS 动态加载，阻塞 |

#### Workday 官方详情 API 全量上下架同步（2026-09-07）

- 新增正式脚本 `scripts/close-removed-by-official-list.ts`：用 Workday `wday/cxs/<tenant>/<site>/job/<slug>` 官方详情 API 对库内每个 active 岗位做生命周期判定（200=在招保留；404/410=官网已撤下架；403/429/超时=保留不误删）。
- 从 `job_url` 自动推导 tenant/site（`buildWorkdayCxsDetailUrl`），覆盖全部 18 个 Workday tenant/site 组合、约 8,436 条在招岗位。
- 实测限流：详情 API 并发 6 + 150ms 触发高频 429；并发 4 + 350ms 稳定无 429（Citi/NVIDIA/WF 全量 0 unknown）。
- 先修正了"列表搜索比对"方案的误判：Workday 列表 `searchText=<requisition_id>` 对带 `-1/-2` 后缀 ID 不可靠（详情 API 200 的岗位列表搜不到），改为详情 API 后无此问题。

##### 执行结果（全部生产库，`is_active=true` 逐条验证）

| 公司 | 检查 | 官网在招 | 官网已撤下架 | 无法判定（保留） |
| --- | ---: | ---: | ---: | ---: |
| Bank of America | 474 | 396 | 78 | 13（网络） |
| Accenture | 1,559 | 1,339 | 0 | 220（详情 API 403） |
| Citigroup | 2,192 | 2,192 | 0 | 0 |
| NVIDIA | 925 | 925 | 0 | 0 |
| Wells Fargo | 1,126 | 1,125 | 0 | 1（网络） |
| Fidelity Investments | 447 | 447 | 0 | 0 |
| Vanguard | 421 | 420 | 0 | 1（网络） |
| Intel | 237 | 237 | 0 | 0 |
| State Street | 220 | 220 | 0 | 0 |
| Ares Management | 175 | 175 | 0 | 0 |
| Barclays | 158 | 158 | 0 | 0 |
| Blackstone | 143 | 143 | 0 | 0 |
| PIMCO | 137 | 137 | 0 | 0 |
| Brookfield | 98 | 98 | 0 | 0 |
| Adobe | 76 | 76 | 0 | 0 |
| The Carlyle Group | 63 | 63 | 0 | 0 |
| Apollo Global Management | 32 | 32 | 0 | 0 |
| Bain Capital | 22 | 22 | 0 | 0 |
| Rothschild & Co | 19 | 19 | 0 | 0 |
| Houlihan Lokey | 11 | 11 | 0 | 0 |

- Bank of America：active 从 487 → 409，78 条官网已撤岗位 `is_active=false, is_closed=true`，同步 `job_sync_records` 标记 `closed`。
- Accenture 220 条详情 API 403：抽查公开 HTML 页面均 200 在招（`Associate-Social-Producer_R00348602-1` 等），判定为"岗位在招但详情 API 访问受限"，**保留不误删**，符合 runbook"403 不等于撤下"原则。
- `backfill-official-job-details.ts` 新增 `--scan-all` 开关：跳过 `hasCandidate` 字段过滤，对全量 active 岗位做官网生命周期/字段检查（配合 `--close-removed` 使用）。Citigroup 30 条 dry-run 验证无误判。

#### 历史字段复核 Worker 来源判定修复（2026-09-07）

- 根因：`src/lib/job-historical-field-review-worker.ts` 按 `connector_name` 判定来源族，但 Deutsche Bank / Bain & Company / Two Sigma / Evercore 的 `connector_name` 没有对应 Phase 2 配置（它们走官方详情脚本），被错判为 `registered_connector` 后调用 `backfill-connector-fields.ts`，报「未找到阶段 2 公司配置」并反复重试失败。
- 修复：来源族判定改为「Workday → 官方通用 source_type 白名单 → Phase 2 配置（`getCompanySourceProfile`）→ 官方详情公司白名单 → discovery_required」；`last_error` 文案按 family 区分（连接器/官方详情）。
- 效果（生产队列 `job_historical_field_reviews` 全部 completed）：Deutsche Bank 官方 beesite API 更新 219 条、Evercore Taleo 更新 48 条、Bain & Company 更新 71 条、Two Sigma 更新 37 条、Millennium Management 更新 158 条；不再循环失败。
- 生产 `JOBS_GENERIC_OFFICIAL_BACKFILL_COMPANIES` 白名单补入 `Deutsche Bank,Bain & Company,Two Sigma,Evercore,Millennium Management`，重启 liorvix 生效。

#### Apple 官方 jobDetails API 上下架同步（2026-09-07）

- 新增正式脚本 `scripts/close-removed-by-apple-api.ts`：先请求 `jobs.apple.com/api/v1/CSRFToken` 拿 token+cookie（复用一次 session），再请求 `/api/v1/jobDetails/<jobNumber>`：200=在招保留；404/410=官网撤下下架；其他（403/429/超时）=保留不误删。
- Apple 全量 3,454 条 active dry-run：3,453 条逐条核验全部 `verified_open`，无撤岗；写入脚本已入库。

#### 官方详情公司 close-removed 全量同步（2026-09-07，进行中）

- 用 `backfill-official-job-details.ts --company=X --scan-all --close-removed` 对官方详情类公司做全量上下架核验（404/关闭页 → 下架，403/429/超时 → 保留）。
- BlackRock（199 条 active）dry-run 完成：全部在招 `removed=0`，无官网已撤岗位；1 条补 `posted_at`，198 条字段已有证据跳过。生产无需下架。
- 后续：Google / Microsoft / Meta / Deloitte / Morgan Stanley / Goldman Sachs / Amazon 逐家跟进（Amazon 20,098 条量大，需分批）。
## 2026-09-08 自动队列接管

- 已在美国生产服务器 `/opt/liorvix` 核对项目 `weqvdtdjdzmqflhwobec`：应用内 worker、官方详情、连接器写入和历史复核均已开启。
- 发现通用官方来源白名单仍只包含旧的 13 家，导致 Amazon 等已具备官方适配器的公司被暂停；已备份 `.env.local` 为 `/opt/liorvix/.env.local.before-auto-queue`，将 `JOBS_GENERIC_OFFICIAL_BACKFILL_COMPANIES` 清空并重启 `liorvix.service`。
- 重启后服务为 `active`，systemd 岗位 timer 保持 `disabled`，避免重复调度和租约竞争。
- 生产验收：Amazon 已进入 `running`，游标推进至 `1414`，累计处理 `300` 条、更新 `229` 条；Citadel、McKinsey & Company、UBS 继续保持 `discovery_required/paused`；JPMorgan Chase 继续因 Oracle 全量对账保护而暂停。
- 以后新增已确认来源会由 worker 自动创建/恢复队列；一般不需要人工逐家公司执行脚本。仅在来源探测、canary、失败队列人工复核或服务故障时介入。

## 2026-09-09 UBS BrassRing 来源恢复

- 美国服务器只读探测确认 `jobs.ubs.com/TGnewUI/Search/home/HomeWithPreLoad?...PageType=JobDetails&jobid={id}` 返回 HTTP 200；页面虽约 1.3MB，但内嵌 `JobDetailQuestions` 包含官方标题、正文、城市、国家/州、工作类型和经验要求。此前“1.3MB 超限/AJAX 403”的阻塞记录已被新证据替代；未使用验证码、登录或第三方接口。
- `safe-external-fetch` 仅对 UBS BrassRing 详情页放宽到 2MB，并只提取 `JobDetailQuestions`；`job-official-detail` 增加 UBS 专用标准化，保留官方原值。新增 20 条回归 fixture。
- 生产 project ref `weqvdtdjdzmqflhwobec` dry-run：20/20 获取、解析和候选更新成功，0 失败、0 跳过；地点 20/20、工作类型 20/20、经验 11/20，薪资仅在官网明确出现时写入，截止日期无官方字段则为空。
- 生产 20 条 canary 写入完成，更新 20 条；随后来源台账提升为 `source_type=ubs_brassring`、`status=configured_connector`、`connector_name=official_generic`，历史队列切换为 `official_generic`，游标保留在原位置，未改变 `is_active/is_closed`。
- 生产验收：UBS active 336 条；抽样岗位均 `is_active=true,is_closed=false`，字段证据为 `official_link_structured_field`；公网 `https://liorvix.com/api/jobs/22441` 返回 HTTP 200。服务重建并重启后 `liorvix.service` 为 active，后续由自动 worker 继续处理。

## 2026-09-09 Citadel 官方 sitemap 接入与上游状态修正

- 上游服务器出口对 `https://www.citadel.com/career-sitemap.xml` 稳定返回 HTTP 200；sitemap 当前提供 60 条官方岗位 URL，采集器每小时均成功读取并写入 60 条开放岗位。Citadel 详情页仍返回 HTTP 403，因此不绕过访问控制、不伪造正文或其他未发布字段。
- 上游 `SitemapConnector` 增加 `emea` URL 标记到 `EMEA` 的保守地点映射；采集质量统计不再把 sitemap 缺少详情正文单独标记为失败，仍会对缺少地点/部门的记录保留 `partial`。本次手动验收后 60 条中 58 条关键质量字段完整，2 条分别缺少官方地点或部门，状态可解释。
- 美国应用端已部署 Citadel `sitemap` 来源台账和 `official_payload` 地点证据规则；生产 `weqvdtdjdzmqflhwobec` 当前 Citadel 公开岗位接口返回 34 条目标地区岗位，全部有可展示地点，30 条有正文，服务健康检查为 `{"status":"ok"}`。

### Citadel 详情正文导入边界

Citadel 的详情页允许正常浏览器访问，但对采集服务器返回 HTTP 403。为避免复制浏览器 cookie 或绕过 Cloudflare，新增 `pnpm import:citadel-browser-details` 作为一次性官方证据导入工具：输入只能来自正常浏览器看到的 Citadel 详情页，脚本会校验官方 host、详情 URL、正文长度和反爬标记，并把 `official_browser_detail`、`official_detail_page`、抓取时间写入 `field_evidence`。默认 dry-run，生产写入必须显式设置 `CITADEL_BROWSER_DETAIL_WRITE_ENABLED=true`、使用生产环境文件并追加 `--write`；已有可展示正文的岗位不会覆盖。后续 sitemap 同步保留已导入正文。
- 仅补写了 3 条缺失地点证据（岗位 ID `63734`、`63733`、`70442`），没有改变岗位上下架状态；后续由现有上游定时任务持续同步 sitemap。

## 2026-10-12 Citadel 详情 repair 空转停放

- 上游 `/opt/global-jobs`：定时 `repair_job_details` 每个整点 05 分仍把 Citadel HTML 详情当可重试 403。sitemap 每 5 分钟把 `detail_status` 写回 `not_fetched`，13 条缺正文岗位反复被选中，抓取结果始终是 `blocked=13, fetched=0`。
- 已在 `repair_job_details` 默认排除公司 `Citadel` 和 host `www.citadel.com`。显式传入 `include_parked_blocked_details=true` 才能再审计。未改 sitemap 调度、主 Feed 游标或岗位开闭。
- 备份 `app/services.py.backup.before-citadel-park-repair-*`、`app/tasks.py.backup.before-citadel-park-repair-*`；worker/beat 已重建。验收：`company_name=Citadel` 返回 `selected=0, parked_excluded=1`；试跑 repair 只请求 Microsoft / Qualcomm / JPMorgan 官方详情 API，日志无 `citadel.com/careers/details`；Citadel 在招仍为 73。

## 2026-10-12 看板 recent-runs 按公司去重

- 上游 `/dashboard/recent-runs` 默认改为每家公司只返回最近一次运行（`unique_company=true`，limit 24）。Citadel sitemap 仍每 5 分钟写入 `crawl_runs`，但运行状态页不再被同一条 success 刷满。原始时间线用 `unique_company=false`。
- 看板 `app.js` 改为请求 `limit=24&unique_company=true`。未改 5 分钟调度、主 Feed 游标或岗位开闭。
- 公网验收：`/collector-api/dashboard/recent-runs` 24 条、24 家、Citadel 1 条；`unique_company=false&limit=12` 仍是 Citadel 占 10 条。

## 2026-10-12 Citadel 目标地区岗位对齐与浏览器导入收口

- 对照：官方 sitemap 63 条，采集器在招 73 条，美国站目标地区在招 39 条。Feed 目标地区 39 条已全部在美国站，无缺失。采集器多出的 10 条不在当前 sitemap（含旧 GQS URL 与已撤 Asia/US campus referrals），未关岗。
- 美国站缺正文 4 条（均为已在招 US intern/HR）。sitemap 另有 8 条无地点：6 条是现有 GQS 岗的新 slug，2 条（Equities 2028 intern、Business Manager）无地点故未入库。禁止用标题猜地点。
- `pnpm import:citadel-browser-details` 改为按规范化官方 URL 匹配，已有岗只补缺失正文；`--create-missing` 仅在 JSON 含官方地点且属于目标地区时建岗，不重开已关闭岗。Citadel 字段规则增加 `official_detail_page`。
- 清理会把 Citadel 打回 `discovery_required` 的台账脚本，以及 Playwright 探测、一次性 collector-cmd、`.before-citadel-*` 备份。未改主 Feed 游标、sitemap 调度或岗位开闭。
- 待导入清单：`output/citadel-browser-import-queue.json`。

## 2026-10-12 Citadel 本机每日补正文

- 新增 `pnpm capture:citadel-browser-details`：用本机 Chrome/Edge 打开官方详情页，写入 `output/citadel-browser-details-latest.json`，再交给现有导入脚本。只处理美国站缺正文的在招岗，以及 sitemap 新增且不是 GQS 换链、不是亚欧排除 slug 的岗位。
- 本机配置目录 `%LOCALAPPDATA%\liorvix\citadel-chrome-profile`。连续两次验证页即停。默认不写库；`--write` 需 `CITADEL_BROWSER_DETAIL_WRITE_ENABLED=true` 和 `.env.production.local`。
- 每日任务脚本 `scripts/citadel-daily-detail-sync.ps1`。本机已用 Chrome 打通 1 条缺正文 intern 岗并写入生产。计划任务因权限拒绝未注册；已改到当前用户「启动」目录 `Liorvix-Citadel-Daily.cmd`，每天第一次登录跑一次。桌面和项目根目录有手动入口「更新Citadel岗位正文」，双击会强制跑一次。需要整点调度时再以有权限的账户运行 `scripts/install-citadel-daily-task.ps1`。未改采集器、主 Feed 游标或岗位开闭。

## 2026-10-12 Wave B 开工：Pinterest

- 查重：上游 `companies` / 目录无 Pinterest；美国生产 `job_company_sources` 无行。
- 官方源：Greenhouse board `pinterest`（board API 名称 Pinterest），采集器出口 179 条、唯一 ID 179。官方 careers `https://www.pinterestcareers.com/`（HTML 403 不影响列表 API）。岗位 URL 全部 `www.pinterestcareers.com/jobs/?gh_jid=`。
- 连接器样本：`GreenhouseConnector` 179/179，地点 179、部门 179、用工类型 179、上架日期 179、正文≥300 179、`source_complete` 179。截止日期和薪资官网未提供，保持空。workplace 列表未给，未猜测。
- 登记一条 `completeness_source`：`companies.id=38b2801e-5faf-45e3-aa7f-bc87ac278c40`，`company_sources` Greenhouse `board_token=pinterest`。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `7fabf454-c836-44f1-80d6-44bcce876172`：`success`，3 秒，discovered/expected/official/created = 179/179/179/179，updated 0，`official_count_status=publisher_reported_complete`。
- 现网目录 91 家、0 failed。Pinterest `open_jobs=179`、`official_open_jobs=179`、`coverage=complete`、`quality=ok`、`completeness_source=greenhouse`。公网 `/collector-api/dashboard/company-directory` 一致。Greenhouse 列表已含全文，未跑详情 repair。
- 连续 3 个成功周期后标 `regular`。下一家稳定 ATS：Box（Greenhouse `boxinc`）。

## 2026-10-12 Wave B：Box

- 查重：上游 `companies` / 目录无 Box（`%box%` 无命中）；美国生产 `job_company_sources` 无行。Pinterest 仍为 179 / 179 complete。
- 官方源：Greenhouse board `boxinc`（board API 名称 Box），采集器出口 127 条、唯一 ID 127。官方 careers `https://www.box.com/careers`（HTML 403 不影响列表 API）。岗位 URL 全部 `job-boards.greenhouse.io/boxinc/jobs/{id}`。
- 连接器样本：`GreenhouseConnector` 127/127，地点 127、部门 127、用工类型 127、上架日期 127、正文≥300 127、`source_complete` 127。截止日期和薪资官网未提供，保持空。workplace 列表未给，未猜测。
- 登记一条 `completeness_source`：`companies.id=d19d02c2-e8c9-437a-a635-35b189a5acc2`，`company_sources` Greenhouse `board_token=boxinc`。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `e64edbcc-4199-4ef8-b9f7-d628eaed068c`：`success`，3 秒，discovered/expected/official/created = 127/127/127/127，updated 0，`official_count_status=publisher_reported_complete`。
- 现网目录 92 家、0 failed。Box `open_jobs=127`、`official_open_jobs=127`、`coverage=complete`、`quality=ok`、`completeness_source=greenhouse`。公网 `/collector-api/dashboard/company-directory` 一致。Greenhouse 列表已含全文，未跑详情 repair。Pinterest 仍 179 / 179 complete。
- 当天稳定 ATS 配额已用完（Pinterest + Box）。连续 3 个成功周期后标 `regular`。下一家：Instacart（Greenhouse `instacart`）。

## 2026-10-12 Wave B：Instacart

- 查重：上游 `companies` / 目录无 Instacart；美国生产 `job_company_sources` 无行。Pinterest 179 / 179、Box 127 / 127 仍 complete。
- 官方源：Greenhouse board `instacart`（board API 名称 Instacart），采集器出口 119 条、唯一 ID 119。官方 careers `https://www.instacart.careers/`（200）。岗位 URL 全部 `instacart.careers/job/?gh_jid=`。
- 连接器样本：`GreenhouseConnector` 119/119，地点 119、部门 119、用工类型 119、上架日期 119、正文≥300 119、`source_complete` 119。截止日期和薪资官网未提供，保持空。workplace 列表未给，未猜测。
- 登记一条 `completeness_source`：`companies.id=17dd001d-be1c-4306-86d1-f9a0a9202f83`，`company_sources` Greenhouse `board_token=instacart`。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `42f4c080-5de6-4503-8864-0416aefa5e1d`：`success`，2 秒，discovered/expected/official/created = 119/119/119/119，updated 0，`official_count_status=publisher_reported_complete`。
- 现网目录 93 家、0 failed。Instacart `open_jobs=119`、`official_open_jobs=119`、`coverage=complete`、`quality=ok`、`completeness_source=greenhouse`。公网 `/collector-api/dashboard/company-directory` 一致。Greenhouse 列表已含全文，未跑详情 repair。Pinterest、Box 仍 complete。
- 连续 3 个成功周期后标 `regular`。下一家稳定 ATS：Plaid（Ashby `plaid`）。

## 2026-10-13 Wave B：Plaid

- 查重：上游 `companies` / 目录无 Plaid；美国生产 `job_company_sources` 此前无行。Pinterest、Box、Instacart 仍 complete。
- 官方源：Ashby board `plaid`（posting-api 200，`jobs` 121、唯一 ID 121）。官方 careers `https://plaid.com/careers/`（200）。岗位 URL 全部 `jobs.ashbyhq.com/plaid/{id}`。Greenhouse / Lever 404，不是完整列表。备用 token `plaidinc` / `plaidhq` 404。
- 连接器样本：`AshbyConnector` 121/121，地点 121、部门 121、工作方式 121、用工类型 121、上架日期 121、正文≥300 121。截止日期和薪资官网未提供，保持空。部门字段官网返回 `All Departments`，未猜测。`source_complete` 由 crawl 层按完整官方列表写入。
- 登记一条 `completeness_source`：`companies.id=a09e83dd-ba05-424e-9d37-31d50a440c99`，`company_sources` Ashby `board_name=plaid`（`3294c653-9f69-475e-85ce-323284a0c343`）。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `ebd6ffcf-c3c6-409f-bb6e-0d50a9ecd047`：`success`，约 1.5 秒，discovered/expected/official/created = 121/121/121/121，updated 0，`official_count_status=complete_official_list`。
- 现网目录 94 家、0 failed。Plaid `open_jobs=121`、`official_open_jobs=121`、`coverage=complete`、`quality=ok`、`completeness_source=ashby`。公网 `/collector-api/dashboard/company-directory` 一致。Ashby 列表已含全文，未跑详情 repair。Pinterest、Box、Instacart 仍 complete。
- 连续 3 个成功周期后标 `regular`。下一家稳定 ATS：Chime。

## 2026-10-13 Wave B：Chime

- 查重：上游 `companies` / 目录无 Chime。Plaid 121 / 121、Pinterest / Box / Instacart 仍 complete。
- 官方源：Greenhouse board `chime`（board API 名称 Chime Financial, Inc），采集器出口 66 条、唯一 ID 66。官方 careers `https://www.chime.com/careers/`（HTML 403 不影响列表 API）。岗位 URL 全部 `boards.greenhouse.io/chime/jobs/{id}`。Ashby / Lever 404，备用 token `chimeinc` / `chimecard` / `chimefinancial` 404。
- 连接器样本：`GreenhouseConnector` 66/66，地点 66、部门 66、上架日期 66、正文≥300 66、`source_complete` 66。截止日期、薪资、工作方式和用工类型官网列表未给，保持空。
- 登记一条 `completeness_source`：`companies.id=99cdbbfd-3202-495b-b5ed-2cca94504cd9`，`company_sources` Greenhouse `board_token=chime`（`b4899a83-e984-43aa-9679-25e2c1ccbd8e`）。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `5063cf76-bfe5-4892-98b0-9cab1470d75f`：`success`，约 1.8 秒，discovered/expected/official/created = 66/66/66/66，updated 0，`official_count_status=publisher_reported_complete`。
- 现网目录 95 家、0 failed。Chime `open_jobs=66`、`official_open_jobs=66`、`coverage=complete`、`quality=ok`、`completeness_source=greenhouse`。公网 `/collector-api/dashboard/company-directory` 一致。Greenhouse 列表已含全文，未跑详情 repair。Plaid、Pinterest、Box、Instacart 仍 complete。
- 连续 3 个成功周期后标 `regular`。下一家稳定 ATS：Dropbox。

## 2026-10-13 Wave B：Dropbox

- 查重：上游 `companies` / 目录无 Dropbox。Chime 66 / 66、Plaid / Pinterest / Box / Instacart 仍 complete。
- 官方源：Greenhouse board `dropbox`（board API 名称 Dropbox），采集器出口 32 条、唯一 ID 32。官方 careers `https://www.dropbox.jobs/en/`（`jobs.dropbox.com/` 与 Greenhouse 看板均 302 到该页，200）。`dropbox.com/jobs` 与 `dropbox.com/careers` 404。岗位 URL 全部 `jobs.dropbox.com/listing/{id}`。Ashby / Lever 404，备用 token `dropboxinc` / `dbx` / `dropboxhq` 404。
- 连接器样本：`GreenhouseConnector` 32/32，地点 32、部门 32、用工类型 32、上架日期 32、正文≥300 32、`source_complete` 32。截止日期、薪资和工作方式官网列表未给，保持空。
- 登记一条 `completeness_source`：`companies.id=7d93c38c-ed8e-4d77-bb7c-7547919de0c2`，`company_sources` Greenhouse `board_token=dropbox`（`16e5fd54-2c8c-4509-907e-88e959bc08c4`）。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `af13566d-a719-4182-8f87-660a37342380`：`success`，约 1 秒，discovered/expected/official/created = 32/32/32/32，updated 0，`official_count_status=publisher_reported_complete`。
- 现网目录 96 家、0 failed。Dropbox `open_jobs=32`、`official_open_jobs=32`、`coverage=complete`、`quality=ok`、`completeness_source=greenhouse`。公网 `/collector-api/dashboard/company-directory` 一致。Greenhouse 列表已含全文，未跑详情 repair。Chime、Plaid、Pinterest、Box、Instacart 仍 complete。
- 连续 3 个成功周期后标 `regular`。下一家稳定 ATS：GitHub（Jibe，复用 AMD）。

## 2026-10-13 Wave B：GitHub

- 查重：上游 `companies` / 目录无 GitHub。Dropbox 32 / 32、Chime / Plaid 仍 complete。AMD Jibe 仍 1296 / 1296 complete。
- 官方源：Jibe `https://www.github.careers/api/jobs`，`totalCount`/`count` 73。官方 careers `https://www.github.careers/careers-home/`（200；`github.com/about/careers` 302 到该页）。`careers.github.com` 无解析，`jobs.github.com` 拒绝连接。稳定外部 ID 为 `req_id`。Canonical URL `https://www.github.careers/careers-home/jobs/{req_id}`。Greenhouse / Ashby / Lever 404。
- 连接器样本：复用现成 `JibeConnector`，`page_size=20`/`max_pages=1` 得到 20/20，地点 20、部门 20、用工类型 18、上架日期 20、正文≥300 20、`detail_status=fetched_json`。截止日期、薪资和工作方式官网列表未给，保持空。样本 `source_complete=false` 是因为只取 20 条、官方 73 条。
- 登记一条 `completeness_source`：`companies.id=3c52f80d-d42c-44a6-abb0-473c4621ccc4`，`company_sources` Jibe `api_url=https://www.github.careers/api/jobs`（`764b5547-ab4c-4524-a1b3-0f77c94cf240`），`page_size=100`，`max_pages=10`。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `6ef951b4-2b78-491c-900a-d33b8d735a30`：`success`，约 3.5 秒，discovered/expected/official/created = 73/73/73/73，updated 0，`official_count_status=publisher_reported_complete`。
- 现网目录 97 家、0 failed。GitHub `open_jobs=73`、`official_open_jobs=73`、`coverage=complete`、`quality=ok`、`completeness_source=jibe`。公网 `/collector-api/dashboard/company-directory` 一致。列表 JSON 已含全文，未跑详情 repair。Dropbox、Chime、Plaid、AMD 仍 complete。
- 连续 3 个成功周期后标 `regular`。下一家稳定 ATS：DocuSign（Jibe）。

## 2026-10-13 Wave B：DocuSign

- 查重：上游 `companies` / 目录无 DocuSign。GitHub 73 / 73、Dropbox / Chime 仍 complete。AMD Jibe 仍 1296 / 1296 complete。
- 官方源：Jibe `https://careers.docusign.com/api/jobs`，`totalCount`/`count` 270。官方 careers `https://careers.docusign.com/careers-home/`（200；`docusign.com/careers` 与 `docusign.com/company/careers` 均 302 到该页）。稳定外部 ID 为 `req_id`。Canonical URL `https://careers.docusign.com/careers-home/jobs/{req_id}`。列表 `apply_url` 指向 iCIMS 登录壳（如 `latamcareers-docusign.icims.com/.../login`），不当 canonical，也不当列表源。Greenhouse / Ashby / Lever 404。
- 连接器样本：复用现成 `JibeConnector`，`page_size=20`/`max_pages=1` 得到 20/20，地点 20、部门 20、用工类型 20、上架日期 20、正文≥300 20、`detail_status=fetched_json`。截止日期、薪资和工作方式官网列表未给，保持空。样本 `source_complete=false` 是因为只取 20 条、官方 270 条。
- 登记一条 `completeness_source`：`companies.id=eefacbdf-d2d0-4629-9afc-357713800b9f`，`company_sources` Jibe `api_url=https://careers.docusign.com/api/jobs`（`3e2807ee-0a52-4b28-bf45-e8c05e630251`），`page_size=100`，`max_pages=10`。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `33db52c3-d147-4e3c-94d7-b386cf490d44`：`success`，约 8 秒，discovered/expected/official/created = 270/270/270/270，updated 0，`official_count_status=publisher_reported_complete`。
- 现网目录 98 家、0 failed。DocuSign `open_jobs=270`、`official_open_jobs=270`、`coverage=complete`、`quality=ok`、`completeness_source=jibe`。公网 `/collector-api/dashboard/company-directory` 一致。列表 JSON 已含全文，未跑详情 repair。GitHub、Dropbox、Chime、AMD 仍 complete。
- 连续 3 个成功周期后标 `regular`。已知稳定连接器队列已走完。下一家先探测 Snowflake。

## 2026-10-13 Wave B：Snowflake

- 查重：上游 `companies` / 目录无 Snowflake。DocuSign 270 / 270、GitHub 73 / 73 仍 complete。
- 官方源探测：Greenhouse / Lever 404；SmartRecruiters 空列表；Jibe `/api/jobs` 500；Workday 各租户 422/401；Ashby `snowflake` 200 但无 jobs 列表。官网 `https://www.snowflake.com/careers/` 302 到 `https://careers.snowflake.com/us/en`。完整官方列表是 Phenom `https://careers.snowflake.com/us/en/search-results` 的 `phApp.ddo.eagerLoadRefineSearch`，`totalHits` 364。稳定外部 ID 为 `jobSeqNo`。Canonical URL `https://careers.snowflake.com/us/en/job/{jobSeqNo}`。
- 连接器样本：Phenom 连接器不允许不完整快照（`max_pages=2` 会因 20 < 364 失败）。第一页 DDO 10/10 唯一 ID，地点 10、部门 10、用工类型 10、上架日期 10。列表是 teaser（`listing_teaser_only`）。截止日期、薪资和工作方式官网列表未给，保持空。
- 登记一条 `completeness_source`：`companies.id=8f92499d-c57a-4700-8833-455de209f756`，`company_sources` Phenom `https://careers.snowflake.com/us/en/search-results`（`5af842f1-deee-406e-b209-9c18aae5c880`），`page_size=10`，`max_pages=80`。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `c09d7cce-332e-4dec-a4f1-7b61bf908114`：`success`，约 27 秒，discovered/expected/official/created = 364/364/364/364，updated 0，`official_count_status=publisher_reported_complete`。
- 有界详情 repair：20 + 4×80 + 24 = 364，`fetched` 364，unavailable/blocked/timeout/error 均为 0。正文≥300 为 364/364。`description_status` 仍为 `listing_teaser_only`（与 Cisco Phenom 相同），目录 `quality=partial`，不重开覆盖工单。
- 现网目录 99 家、0 failed。Snowflake `open_jobs=364`、`official_open_jobs=364`、`coverage=complete`、`quality=partial`、`completeness_source=phenom`。公网 `/collector-api/dashboard/company-directory` 一致。岗位 URL 全部 `careers.snowflake.com`。DocuSign、GitHub 仍 complete。
- 连续 3 个成功周期后标 `regular`。下一家先探测 Zoom。

## 2026-10-13 Wave B：Zoom

- 查重：上游 `companies` / 目录无 Zoom。Snowflake 364 / 364、DocuSign 270 / 270、GitHub 73 / 73 仍 complete。
- 官方源探测：Greenhouse / Ashby / Lever 404；SmartRecruiters 空列表；Jibe / Eightfold / Phenom 不是列表源。`www.zoom.com/careers` HTML 403（Cloudflare）不是关岗信号。`zoom.us/careers` 200 到营销页 `https://explore.zoom.us/en/careers/`，再链到 `https://careers.zoom.us/home` → `https://www.careers.zoom.us/`。该 CMS 的 RSS/Atom 是博客 3 条，不是岗位列表。完整官方列表是 Workday CXS `https://zoom.wd5.myworkdayjobs.com/wday/cxs/zoom/Zoom/jobs`（站点名 `Zoom` 与 `zoom` 岗位集合相同）。采集时官方 `total` 从 101 落到 100；crawl 时 `total=100`，唯一 `externalPath` 100。Canonical URL `https://zoom.wd5.myworkdayjobs.com/Zoom{externalPath}`。
- 连接器样本：复用现成 `WorkdayConnector`，`page_size=20`。列表 101/101 时地点 101、正文 0（Workday 列表无 JD）。截止日期和部门列表未给，保持空。
- 登记一条 `completeness_source`：`companies.id=1d272e4b-6a88-44d2-ac21-e2567c8572ca`，`company_sources` Workday `https://zoom.wd5.myworkdayjobs.com/Zoom`（`f2509e1f-f1c7-4f1e-accd-7e99fc4bd304`），`api_url=https://zoom.wd5.myworkdayjobs.com/wday/cxs/zoom/Zoom/jobs`，`page_size=20`。官方 careers `https://www.careers.zoom.us/`。未改连接器代码，未改主 Feed 游标，未关岗。
- 全量 crawl `8e77783c-029c-42e3-8ad3-8c07e060ffd2`：`success`，约 3 秒，discovered/expected/official/created = 100/100/100/100，updated 0，`official_count_status=publisher_reported_complete`。现网 CXS `total` 仍为 100。
- 有界详情 repair：20 + 40 + 40 = 100，`fetched` 100，unavailable/closed/blocked/timeout/error 均为 0。正文≥300 为 100/100，地点 100，工作方式 100，用工类型 100，上架相对文案 100，部门 34，薪资 67。截止日期官网详情未映射为 `valid_through`，保持空。`detail_status=fetched`。目录 `quality=partial`（与 Broadcom Workday 相同），不重开覆盖工单。
- 现网目录 100 家、0 failed。Zoom `open_jobs=100`、`official_open_jobs=100`、`coverage=complete`、`quality=partial`、`completeness_source=workday`。公网 `/collector-api/dashboard/company-directory` 一致。岗位 URL 全部 `zoom.wd5.myworkdayjobs.com`。Snowflake、DocuSign、GitHub 仍 complete。
- 连续 3 个成功周期后标 `regular`。下一家先探测 HubSpot。

## 2026-10-13 Wave B：HubSpot（探测停放，未登记）

- 查重：上游 `companies` / 目录无 HubSpot。Zoom 100 / 100、Snowflake 364 / 364、DocuSign 270 / 270、GitHub 73 / 73 仍 complete。目录 100 家、0 failed。
- 官方 careers：`https://www.hubspot.com/careers/jobs` 与 `/careers/jobs/all` 200，标题 All Openings。`jobs.hubspot.com` 302 到该页。页面是 HubSpot CMS + `template_careers-directory` React 目录，不是可解析的岗位列表 HTML。
- 常见 ATS：Greenhouse token `hubspot` / `hubspotjobs` / `hubspotinc` 均为 404。Ashby / Lever 404。SmartRecruiters 空列表。Jibe / Eightfold / Phenom 不是列表源。Workday 租户 401/422。`www.careers.zoom.us` 式 CMS RSS 对 HubSpot 不存在；`www.hubspot.com/sitemap.xml` 3071 条无 `/careers/jobs/{id}`。
- 官方列表机制：`window.careersUrlConfig.serverUrl=https://wtcfns.hubspot.com/careers/graphql`（`template_careers-language.min.js`）。schema 字段 `jobs` / `job` / `search` / `offices` / `departments`；`Job` 形状含 Greenhouse 式 `absolute_url`、`internal_job_id`、`requisition_id`、`content`。官网 Job Alerts 链到 `my.greenhouse.io/...job_board=hubspotjobs`，公开 board API 仍 404。
- 采集器出口实测：GraphQL 网关 200，但所有 list/detail/search/offices/departments resolver 的底层 REST 返回 404 `Job not found` / `Office not found` / `Department not found`。`search(searchQuery:)` 类型是 `[Job]`，同样 404。`wtcfns.hubspot.com/careers/jobs` 要 API Gateway token。Altru `data-altru-directory=7146` / `data-altru-post=7046` 的 `api.altrulabs.com/dist-api/us/widgets/{id}` 无匹配记录。
- 现成连接器：`OfficialConnector` 只 GET JSON-LD；`PublicFeedConnector` 只 GET JSON 列表；没有 GraphQL POST 连接器。不新写连接器去包一层 404 后端。
- 未登记 `companies` / `company_sources`，未改连接器代码，未改主 Feed 游标，未关岗。HubSpot 停放，等官方 GraphQL 底层列表恢复或出现可复用的完整官方 JSON 后再走样本/登记。
- 下一家先探测 LinkedIn。

## 2026-10-13 Wave B：LinkedIn（探测停放，未登记）

- 查重：上游 `companies` / 目录无 LinkedIn。Zoom 100 / 100、Snowflake 364 / 364、HubSpot 未登记。目录 100 家、0 failed。incomplete 仍是 Microsoft / Barclays / State Street，不并入扩公司队列。
- 官方 careers：`https://careers.linkedin.com/` 200，Adobe AEM（`content.linkedin.com/lem` + `delivery-p143253-e1476319.adobeaemcloud.com`）。JSON-LD 只有 Organization / WebSite / WebPage，没有 JobPosting 列表。`/jobs`、`/openings`、`/search`、`.model.json`、sitemap 均 404/400。页面 CTA 链到 LinkedIn Jobs `f_C=1337,9202023,2561065,2587638,290903,39939`（地点页），不是 careers 站内列表。
- 常见 ATS：Greenhouse `linkedin` 404；`linkedinjobs` 200 但是 Talon.One 的 19 条，不是 LinkedIn 公司。Ashby 404。Lever `linkedin` 23 条，标题含 `Deauth Test` / `Kritika Bug Bash`，是测试板。SmartRecruiters 空列表。Jibe / Eightfold / Phenom 不是列表源。Workday 租户 401/422。Avature `linkedin.avature.net` 200 但是空标题登录壳，`SearchJobs` 路径 404，不是现成 Avature 门户。iCIMS 405 人机验证。
- Microsoft 已有独立公司（PCSX `apply.careers.microsoft.com`）。Microsoft 在招标题含 LinkedIn 为 0。本轮 PCSX GET 429、POST 401，不能把 LinkedIn 登记成 Microsoft 过滤子集。
- 实际开口：`https://www.linkedin.com/jobs/search?f_C=1337` 标题 197 条（美国）、`geoId=92000000` 标题 415 条（全球）。JSON-LD 是 `ItemList` 首页 60 条 `ListItem`（不是 `JobPosting`），`OfficialConnector` 只会得到 0 条。guest HTML `jobs-guest/jobs/api/seeMoreJobPostings/search` 每页约 10 张卡片，同出口连续请求已 429。`www.linkedin.com/robots.txt` 禁止未授权自动化。`/jobs/linkedin-jobs` 标题 11,000+ 是平台上含 LinkedIn 字样的岗位，不是公司在招，不当源。
- 现成连接器：`OfficialConnector` 只 GET JSON-LD JobPosting；`PublicFeedConnector` 只 GET JSON 列表；没有 LinkedIn guest HTML 连接器。不为 429/反爬 HTML 分页新写连接器，也不把测试 Lever 或 Talon.One Greenhouse 登记成 completeness 源。
- 未登记 `companies` / `company_sources`，未改连接器代码，未改主 Feed 游标，未关岗。LinkedIn 停放，等官方出现可复用的完整 JSON/ATS 列表后再走样本/登记。
- 下一家先探测 Snap。

## 2026-10-13 Wave B：LinkedIn（本机官方快照 + public_feed，已登记）

- 办法 1：本机 headed Edge 专用配置 `%LOCALAPPDATA%\liorvix\linkedin-edge-profile` 登录后，抓官方公司筛选 `f_C=1337&geoId=92000000`。guest HTML 登录后 451，改走页面已发出的官方 JobCards GET（`voyagerJobsDashJobCards`）和职位简介 GET（`JOB_DESCRIPTION_CARD`）。采集器侧只登记现成 `public_feed`，不新写 GraphQL/HTML 连接器。
- 快照：`list_complete=true`，官方 `paging.total` 416，抓到 416 条，地点 416，正文≥300 为 416，招聘方均为 LinkedIn，URL 全部 `www.linkedin.com/jobs/view/{id}`。
- 写入：静态 feed `http://api:8000/static/feeds/linkedin-official-jobs.json`（worker 实测 200 / 2,759,685 bytes / 416 jobs）。`companies` + 一条 `public_feed` `completeness_source=true`。
- crawl `6c4fe21b-9c1c-4a4e-bb78-8f99ad28c792` success：discovered 416 / expected 416 / official 416 / `publisher_reported_complete` / created 416。目录 101 家、0 failed。LinkedIn `open_jobs=416`，`coverage=complete`，`quality=partial`（部门/雇佣类型未在官方卡片保证，不猜）。incomplete 仍是 Microsoft / Barclays / State Street。HubSpot 未登记。
- 未改主 Feed 游标，未关其它公司岗位。日常入口：登录后关专用 Edge，再跑桌面 `Update LinkedIn Jobs`。
- 下一家先探测 Snap。

## 2026-10-13 LinkedIn 地点证据回填

- 现象：采集器 416 条都有官方地点，生产库 250 条目标地区岗位 `region` 也有值，但 `location_source` 为空。公开 API 按证据规则把地点显示成「未注明」。
- 原因：LinkedIn 不在 `job-company-field-rules` 里，collector `public_feed` 又不带 `structured_field_sources.location`，Feed 无法把 `www.linkedin.com` 上的 JobCards 地点标成 `official_payload`。
- 修复：登记 LinkedIn 官方 host（`www.linkedin.com` / `linkedin.com`），允许 `official_payload`。地点字符串里的 Hybrid/Remote/On-site 作为官方 workplace。生产只补缺失证据，不改开关状态、不改 Feed 游标。
- 生产库 `weqvdtdjdzmqflhwobec`：250 条在招全部写入 `location_source=official_payload`，workplace 250/250。公网 `/api/jobs?company=LinkedIn` 抽样 8 条地点均可见；详情 `123455` 为 `Montreal, QC (On-site)`。
- 仍不猜部门、薪资、截止日期。印度/爱尔兰等非目标地区岗位继续只留在采集器，不进美国站目录。
