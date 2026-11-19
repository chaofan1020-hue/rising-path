# 上游岗位采集器稳态推进计划

更新时间：2026-10-13  
**本文是采集器工作的唯一执行入口。** 其它岗位计划只保留规范或历史，执行顺序以本节为准。

范围：上游采集器 `/opt/global-jobs`（`47.83.172.45`，公开接口 `hfscareer.com/collector-api`）；美国站只作为 Feed 消费者。例外：Apple 地点「未注明」允许在采集器修好后，用官方 jobDetails 做只补地点回填。  
不在本计划内：大屏文案、Citadel Cookie/指纹绕过、Wave C。Wave B 已开工。

## 1. 结论

采集器没有停机。2026-10-13 现网：健康检查 200，101 家公司，0 家 `failed`。P0 覆盖已经齐。**Wave B 已接入 Pinterest 179 / 179、Box 128 / 128、Instacart 117 / 117、Chime 66 / 66、Dropbox 32 / 32（均为 Greenhouse）、Plaid 121 / 121（Ashby）、GitHub 73 / 73、DocuSign 270 / 270（均为 Jibe）、Snowflake 364 / 364（Phenom，`quality=partial` 因列表 teaser 标记，详情已有界 repair）、Zoom 100 / 100（Workday，`quality=partial`，详情已有界 repair）、LinkedIn 416 / 416（本机登录后官方 JobCards 快照 + `public_feed`），覆盖均为 `complete`。** 扩公司队列不处理现网 `coverage=incomplete`：Microsoft（约 2340 / 2280）、Barclays（753 / 730）、State Street（1106 / 1104）。

| 公司 | 现网 | 状态 |
|---|---|---|
| Amazon | 22,562 / 22,562，`completeness_source=amazon` | 覆盖完成，观察中 |
| Bank of America | 2,007 / 2,007，Workday 为完整源 | 13,853 是分区重叠，不是漏抓 |
| Accenture | 865，Workday 已停用，公开 feed 为完整源 | 双源已拆 |
| Citadel | 61 / 61，sitemap 每 5 分钟 | 列表自动化已上线；详情 403 停放 |

真正还没做完的是更小的尾巴，不是再开覆盖工单：

1. **目录口径已上线（2026-09-14）。** 质量缺口走 `quality_status=partial`。Microsoft / Barclays / State Street 现网 `coverage=incomplete`，不并入 Wave B。
2. **Apple 地点「未注明」已按官方列表证据回填（阶段 B，美国站）。**
3. **Jefferies RSS 已降级（2026-09-14）**，在招/官方均为 158，Oracle 为完整源；TAL 独有岗位已按完整快照关闭。Barclays `/login` 源已停用。
4. **Wave A 已按工厂开工。** Shopify、Airbnb、Lyft、Uber、Cisco、Qualcomm、AMD、Dell、Broadcom、ServiceNow、Salesforce、Oracle、IBM、Workday 覆盖仍 complete。**DoorDash 2026-09-20 已接入**，Greenhouse 五看板唯一 ID 571 / 官方 571，`coverage=complete`，`quality=ok`。Wave A 推荐队列已走完。
5. **Morgan Stanley 仍健康（2026-09-20）。** Eightfold 1,323 / 1,323，`coverage=complete`；Taleo 124 条实习岗仍在招。覆盖工单清空。

已经 `coverage_complete` 的公司不再进覆盖工单。缺描述、缺地点、详情 403 都只进质量/停放队列。

## 2. 为什么会修好几轮

对照现网代码（仓库快照 `output/upstream-connectors.py`、`output/upstream-services.py`）和执行日志，重复劳动来自口径混用，不是执行力不够。

| 看起来像没修好 | 实际已经完成的层 | 仍未完成的层 |
|---|---|---|
| JPMorgan / Lazard / Jefferies | Oracle 列表、美国站字段 canary、关岗保护 | Jefferies RSS 仍参与在招计数；JPMorgan 只是质量缺描述 |
| Apple / Google / Microsoft / Meta | 官方 API/页面、数量对账 | Apple 地点「未注明」待核实；其余少量缺正文 |
| Accenture | 公开 feed 已是 `completeness_source`，Workday 列表已停用 | 无覆盖工作；只观察 |
| Amazon | 国家 × 业务类目分区抓全，22,562 / 22,562 | 观察 3 个成功周期后才允许关岗 |
| Bank of America | 唯一 ID 2,007，官方数已改为去重后的值 | 观察 3 周期；禁止再用 13,853 当官方总数 |
| Citadel / McKinsey | 列表已通（sitemap 61、gateway 593） | 详情 403 / 登录壳，停放，不进覆盖工单 |
| UBS / Goldman / Deloitte | 美国站字段已接入 | 采集器侧只是少量质量缺口 |

以后禁止把“美国站字段完成”写成“采集器完成”。完成只能按下面的状态机。

## 3. 目标与边界

**完成定义（采集器）：**

- 每家活跃公司有且仅有一个 `completeness_source`（完整快照权威源）。
- 覆盖状态和字段质量状态分开，不再共用一个 `partial`。
- 完整快照下：唯一外部 ID 稳定、覆盖率可解释、关闭事件可安全发出。
- 不完整快照、403、429、超时、验证码：**只更新、不关闭**。
- Wave A 按工厂流程一家家接入，不另起 cron。
- 已进入 `regular` 的公司，没有新证据不得重新打开覆盖工单。

**不改变：**

- 主 Feed 游标协议、美国站 `JOBS_AUTO_WORKER`。
- 不绕过验证码、不保存个人 Cookie、不用非官方镜像。
- 不删除岗位历史，不因字段缺失下架。

## 4. 公司状态机（防再进场）

每家公司只允许处于一个主状态。调度和人工看板都必须用这一列，而不是 `success/partial`。

```text
discovery
  → sample_verified          官方源 + 20 条样本通过
  → coverage_incomplete      有列表但不能证明抓全，禁止关岗
  → coverage_complete        唯一 ID 覆盖官方总数（或完整官方列表）
  → quality_partial          数量已齐，只缺描述/部门等
  → regular                  连续 3 个成功/可解释周期
  → parked_blocked_details   列表可用，详情 403/登录/验证码
  → mixed_source             多个列表源争计数，先拆源再谈覆盖
```

**重新打开覆盖工单的唯一条件：**

- 官方源 URL / host / connector 变更
- 官方数量或抓取量单日下降超过 80%
- 连续 3 次 crawl `failed`
- 外部 ID 出现碰撞或大量重复

缺描述、美国站字段空、详情 403，都**不能**把公司从 `regular` 打回 `coverage_incomplete`。

目录接口需要拆开返回，避免美国站再把质量问题当成覆盖失败：

- `coverage_status`: `complete` | `incomplete` | `capped` | `unavailable`
- `quality_status`: `ok` | `partial`
- `completeness_source`
- `block_reason` + `recovery_condition`（仅 parked / mixed）

## 5. 现网分桶（2026-09-11 晚）

### A. 覆盖完成、观察中（禁止重开覆盖工单）

| 公司 | 现网唯一岗位 | 完整源 | 观察要求 |
|---|---:|---|---|
| Amazon | 22,562 | `amazon` 分区抓全 | 连续 3 个 `source_complete` 周期后才允许关岗 |
| Bank of America | 2,007 | `workday`（login 源已停用） | 同上；13,853 只作为重叠桶之和，不可用 |
| Accenture | 865 | `accenture` 公开 feed | Workday 列表保持停用 |

### B. 双源尾巴（配置，不改连接器）

- **Jefferies**：Oracle 已是 `completeness_source`（官方 158），RSS 已降为只补字段；在招 158。TAL 独有校园岗已关闭。
- **Barclays**：`/login` Workday 源已停用（2026-09-14）；职业站点为完整源，在招 984 / 官方 985。

### C. 列表可用、详情停放（不进覆盖工单）

| 公司 | 列表 | 详情阻塞 | 恢复条件 |
|---|---|---|---|
| Citadel | sitemap 63/63，每 5 分钟 | 详情 403；定时 repair 已停放（2026-10-12）。美国站目标地区 39/39 已齐，缺正文走浏览器导入 | 官方公开详情接口，或 `pnpm import:citadel-browser-details` |
| McKinsey | gateway 593/593 | Avature 申请壳 | 非登录官方详情/JSON；禁止写申请页 |
| Morgan Stanley Taleo | Eightfold 主源已完整 | Taleo 人机验证 | 官方非验证码接口；主源保持 Eightfold |

### D. 数量已齐，质量 partial（进 repair 队列，不重做连接器）

Apple 地点「未注明」已回填。Oliver Wyman、BCG 短描述已修完（364/364、904/904 正文≥300）。官方上架日期已接入现有 `posted_at`（采集库 92%、美国站在招 92.6%）；Google/Goldman/Citadel/McKinsey/UBS/Bain 的官网列表没有该字段，保持空。下一步 Apple 剩余约 71 条短描述。NVIDIA/Adobe/Intel 正文已齐。  
目录口径上线后，本桶不再进入覆盖工单。2026-09-18 现网覆盖工单已清空；Microsoft 与 Morgan Stanley 均为 complete。

### E. Wave A

- **已接入：** Shopify（2026-09-16，`completeness_source=shopify`，115 / 115）；Airbnb（2026-09-16，Greenhouse `airbnb`，158 / 158）；Lyft（2026-09-16，Greenhouse `lyft`，179 / 179）；Uber（2026-09-16，Oracle HCM `UberCareers` / `CX_1`，505 / 505，`quality=partial`）；Cisco（2026-09-16，Phenom `careers.cisco.com`，1311 / 1311，`quality=partial`）；Qualcomm（2026-09-16，Eightfold `careers.qualcomm.com`，2003 / 2003，`quality=partial`）；AMD（2026-09-16，Jibe `careers.amd.com/api/jobs`，1226 / 1226，`quality=ok`）；Dell Technologies（2026-09-17，Oracle HCM `careers` / `CX_1`，466 / 466，`quality=partial`）；Broadcom（2026-09-17，Workday `External_Career`，367 / 367，`quality=partial`）；ServiceNow（2026-09-17，SmartRecruiters `ServiceNow`，639 / 639，`quality=partial`）。均观察 3 周期后标 `regular`。
- **已接入补记：** DoorDash（2026-09-20，Greenhouse 五看板 `doordashusa`/`doordashcanada`/`doordashmexico`/`doordashaustralia`/`doordashindia`，唯一 ID 571 / 官方 571，`quality=ok`）。官网 HTML 403 不是列表源；776 是 CMS listing 行，不是唯一岗位。
- **已接入补记：** Salesforce（2026-09-20，Workday `External_Career_Site`，1481 / 1481，`quality=partial`）；Oracle（2026-09-20，Oracle HCM `CX_45001`，唯一 ID 2248 / 官方 2251，`quality=partial`）；IBM（2026-09-20，Falcon `ibm`，唯一 ID 1850 / 官方 1854，`quality=partial`）。
- **已接入补记：** Workday（公司，2026-09-20，Workday CXS `Workday` / `wd5`，365 / 365，`quality=partial`）。
- **停放 / 未进采集器：** 无。

开始门槛已满足。Wave A 推荐队列已走完。一天最多 1 家高风险或 2 家稳定 ATS。

### F. Wave B

- **已接入：** Pinterest（2026-10-12，Greenhouse `pinterest`，唯一 ID 179 / 官方 179，`quality=ok`）。官方 careers `https://www.pinterestcareers.com/`，列表源 `https://boards.greenhouse.io/pinterest`，岗位 URL 全部 `www.pinterestcareers.com`。Greenhouse 列表已带全文，未跑详情 repair。连续 3 周期后标 `regular`。
- **已接入：** Box（2026-10-12，Greenhouse `boxinc`，唯一 ID 127 / 官方 127，`quality=ok`）。官方 careers `https://www.box.com/careers`，列表源 `https://job-boards.greenhouse.io/boxinc`，岗位 URL 全部 `job-boards.greenhouse.io`。Greenhouse 列表已带全文，未跑详情 repair。连续 3 周期后标 `regular`。现网数量随官网自然变动（2026-10-13 为 128 / 128）。
- **已接入：** Instacart（2026-10-12，Greenhouse `instacart`，唯一 ID 119 / 官方 119，`quality=ok`）。官方 careers `https://www.instacart.careers/`，列表源 `https://boards.greenhouse.io/instacart`，岗位 URL 全部 `instacart.careers`。Greenhouse 列表已带全文，未跑详情 repair。连续 3 周期后标 `regular`。现网数量随官网自然变动（2026-10-13 为 117 / 117）。
- **已接入：** Plaid（2026-10-13，Ashby `plaid`，唯一 ID 121 / 官方 121，`quality=ok`）。官方 careers `https://plaid.com/careers/`，列表源 `https://jobs.ashbyhq.com/plaid`，岗位 URL 全部 `jobs.ashbyhq.com`。Ashby posting-api 已带全文，未跑详情 repair。连续 3 周期后标 `regular`。
- **已接入：** Chime（2026-10-13，Greenhouse `chime`，唯一 ID 66 / 官方 66，`quality=ok`）。官方 careers `https://www.chime.com/careers/`（HTML 403 不影响列表 API），列表源 `https://boards.greenhouse.io/chime`，岗位 URL 全部 `boards.greenhouse.io`。Greenhouse 列表已带全文，未跑详情 repair。连续 3 周期后标 `regular`。
- **已接入：** Dropbox（2026-10-13，Greenhouse `dropbox`，唯一 ID 32 / 官方 32，`quality=ok`）。官方 careers `https://www.dropbox.jobs/en/`，列表源 `https://boards.greenhouse.io/dropbox`，岗位 URL 全部 `jobs.dropbox.com`。Greenhouse 列表已带全文，未跑详情 repair。连续 3 周期后标 `regular`。
- **已接入：** GitHub（2026-10-13，Jibe，唯一 ID 73 / 官方 73，`quality=ok`）。官方 careers `https://www.github.careers/careers-home/`，列表源 `https://www.github.careers/api/jobs`，岗位 URL 全部 `www.github.careers`。复用现成 `JibeConnector`，未改连接器代码。列表 JSON 已带全文，未跑详情 repair。连续 3 周期后标 `regular`。
- **已接入：** DocuSign（2026-10-13，Jibe，唯一 ID 270 / 官方 270，`quality=ok`）。官方 careers `https://careers.docusign.com/careers-home/`，列表源 `https://careers.docusign.com/api/jobs`，岗位 URL 全部 `careers.docusign.com`。申请链 iCIMS 登录壳不当 canonical。复用现成 `JibeConnector`，未改连接器代码。列表 JSON 已带全文，未跑详情 repair。连续 3 周期后标 `regular`。
- **已接入：** Snowflake（2026-10-13，Phenom，唯一 ID 364 / 官方 364，`quality=partial`）。官方 careers `https://careers.snowflake.com/us/en`，列表源 `https://careers.snowflake.com/us/en/search-results`，岗位 URL 全部 `careers.snowflake.com`。复用现成 `PhenomConnector`，未改连接器代码。列表是 teaser；有界详情 repair 364/364 成功，正文≥300 为 364。`description_status` 仍为 `listing_teaser_only`（与 Cisco Phenom 相同），不重开覆盖工单。连续 3 周期后标 `regular`。
- **已接入：** Zoom（2026-10-13，Workday，唯一 ID 100 / 官方 100，`quality=partial`）。官方 careers `https://www.careers.zoom.us/`，列表源 `https://zoom.wd5.myworkdayjobs.com/Zoom`（CXS `https://zoom.wd5.myworkdayjobs.com/wday/cxs/zoom/Zoom/jobs`），岗位 URL 全部 `zoom.wd5.myworkdayjobs.com`。复用现成 `WorkdayConnector`，未改连接器代码。列表无 JD；有界详情 repair 100/100 成功，正文≥300 为 100。`quality=partial`（与 Broadcom Workday 相同），不重开覆盖工单。连续 3 周期后标 `regular`。
- **探测停放：** HubSpot（2026-10-13）。官方 careers `https://www.hubspot.com/careers/jobs`，官方 GraphQL `https://wtcfns.hubspot.com/careers/graphql` 已定位；采集器出口底层 REST 全部 404 `Job not found`。Greenhouse / Ashby / Workday / Phenom / Jibe 都不是完整列表。未登记，不写新连接器包 404 后端。
- **已接入：** LinkedIn（2026-10-13，`public_feed`，唯一 ID 416 / 官方 416，`coverage=complete`，`quality=partial`）。官方 careers `https://careers.linkedin.com/` 仍是 AEM 营销站。完整官方列表来自登录后的公司筛选 `https://www.linkedin.com/jobs/search/?f_C=1337&geoId=92000000&sortBy=DD`（JobCards `paging.total`）。本机 Edge 专用配置抓快照，写入采集器 `http://api:8000/static/feeds/linkedin-official-jobs.json`。唯一 `completeness_source`。美国站地点证据已补：目标地区在招 250 条 `location_source=official_payload`，公开 API 不再显示「未注明」。未新写 GraphQL/HTML 连接器，未改主 Feed 游标。连续 3 周期后标 `regular`。
- **下一批：** 先探测 Snap。
- **一天一家大体量：** Anthropic、xAI、Scale AI。
- **先探测：** Snap、HashiCorp、Hugging Face、Mistral。HubSpot 等官方完整 JSON 列表恢复后再回头。Anduril Greenhouse 量约 2493，放到后段。

## 6. 架构一次性修正（所有后续公司受益）

改采集器，不改美国站主 Feed。

### 6.1 一家公司一个完整快照源

在 `company_sources` 增加或明确 `completeness_source=true`（每家公司恰好一行）。

`crawl_company` 聚合规则改为：

- `official_open_jobs` / 关岗快照 **只看** completeness 源
- 其他源只 upsert、只补字段，`source_complete=false` 时不得关闭任何岗位
- 多源 publisher 总数禁止再 `max()` 混用

这会直接收口 Accenture 和 Jefferies，并防止 Wave A 再出现双源打架。

### 6.2 覆盖与质量拆分

当前 `latest_run_status=partial` 把“缺描述”和“没抓全”混在一起。改为：

- 覆盖未验证 → `coverage_incomplete`，`no roles were closed`
- 仅质量缺口 → `success` + `quality_status=partial`
- 目录和告警按覆盖状态，不按质量状态

### 6.3 Amazon：从“报总数”改成“抓全量”

现有 `AmazonJobsConnector` 已能用国家 + 业务类目 facet 得到 22,555，但列表仍只翻未分区的 10,000 条。

补齐：

1. 对每个国家桶、必要时再拆 `business_category`，直到单查询 `< 10,000`
2. 按稳定 `id_icims` 去重
3. `canonical_count >= official_facet_total` 且分页边界完成，才 `source_complete=true`
4. 分区失败或仍触顶 → `capped_unavailable`，只给下限，继续禁止关岗
5. 限流：单 host 串行或低并发，间隔不低于现有 Amazon 请求节奏

验收：唯一 ID 覆盖官方 facet 总数（允许极小动态差，需记录），连续 3 个周期 `source_complete=true`，美国站才能接收 Amazon 关闭事件。

### 6.4 Workday：分区必须互斥，计数必须用唯一 ID

Bank of America 的 11,843 重复说明 facet 桶重叠，官方 13,853 很可能是桶计数之和，不是唯一岗位数。

固定流程（BofA 先锋，随后可复用到其他大体量 Workday）：

1. 只读：抽样 50 个 `jobPostingId` / `externalPath`，确认 ID 是否把不同 posting 压成一条
2. 看当前 `partition_facets`；改成互斥维度（优先单一地点或单一 job family，不要叠两个会交叉的 facet）
3. 官方总数改为：publisher `total`（未分区首页）与去重唯一 ID 对账；禁止用“各桶 count 求和”
4. 分区叶仍触 `partition_cap`（默认 2000）→ 该叶 `complete=false`，整家公司不关岗
5. 同一公司不要配两条 Workday 列表源

Accenture 的 Workday 行：`completeness_source=false`，或停用该源的列表 crawl，只保留公开 feed。

## 7. 执行阶段（当前）

原则：覆盖已齐，先口径、再 Apple 地点、再配置尾巴、再泛质量、最后扩公司。同一时间只允许 1 个高风险连接器改动进入生产。阶段 1–3 的 Amazon / BofA / Accenture 覆盖实现已完成，只保留观察，不再重做。

### 阶段 A：目录口径（已完成，2026-09-14）

`coverage_status` 不得再因 crawl `partial`（缺描述/缺地点）变成 `incomplete`。只看 `official_count_status` / `source_complete` / capped。缺字段走 `quality_status=partial`。

验收（已通过）：质量缺口公司显示 `coverage=complete`。Apple 不进覆盖工单。只改采集器目录映射，不改岗位生命周期。现网 74/75 complete，剩余 Microsoft 为真实覆盖缺口（3 条重复 ID）。

### 阶段 B：Apple 地点「未注明」（先核实，再修）

禁止猜城市。先只读对照采集器空地点、`raw_payload.locations` key、官方 `jobDetails/{id}`、美国站 `region=未注明`。

按证据只选一条修：

- 列表已有 `name`/`city` → 扩 `AppleCareersConnector._location()`
- 列表空、详情有 → crawl/repair 把 `detail_location` 写回；定时 repair 对 Apple 打开 `include_structured_missing`
- `positionId` 去重吞掉 `200671417-0836` / `200671417-0365` 这类地点变体 → 用完整 job number
- 官网原文是 “Various Locations within United States” → 原样写入，不是「未注明」

美国站只在采集器有地点之后，对仍为「未注明」的行做官方 jobDetails 只补地点回填（对齐 Amazon listing location 脚本：dry-run、独立写入开关、不改上下架）。

### 阶段 C：Jefferies RSS + Barclays login（已完成，2026-09-14）

RSS 降级为只补字段；Barclays `/login` 源停用。回归：其他公司 `official_open_jobs` 不变。

**Barclays `/login` 已停用**：职业站点为 `completeness_source`，完整抓取 985/985 success，在招 984。  
**Jefferies RSS 已降级**：Oracle 158/158，在招 158；RSS 只补字段。

### 阶段 D：质量 repair

复用现有 `repair-job-details` beat。Apple 地点稳定后才全面铺开。  
2026-09-14 现网：NVIDIA 2665 仅 2 条空描述、Adobe 1 条、Intel 0 条，不再是高量缺口。**Oliver Wyman、BCG 已修完**（364/364、904/904 正文≥300，在招未变）。根因：列表 teaser 被标成 `fetched_json`，定时 repair 跳过；官网 `phApp.ddo.jobDetail` 实际有完整正文。已改为 teaser 不视为已抓详情，并解析 Phenom 详情包。下一步 **Apple 剩余约 71 条短描述**。401/403/404 有界重试后停放。

### 阶段 E：Wave A 工厂

已开始。Shopify、Airbnb、Lyft、Uber、Cisco、Qualcomm、AMD、Dell、Broadcom、ServiceNow、Salesforce、Oracle、IBM、Workday、DoorDash 工厂 7 步已走完首轮；连续 3 周期后才标 `regular`。现网约 Shopify 107、Airbnb 168、Lyft 178、Uber 531、Cisco 1320、Qualcomm 2013、AMD 1223、Dell 463、Broadcom 370、ServiceNow 646、Salesforce 1481、Oracle 2248、IBM 1850、Workday 365、DoorDash 571，均为 `coverage=complete`。  
开始门槛见第 5 节 E。每家固定 7 步，一天最多 1 家高风险或 2 家稳定 ATS：

1. 查重（上游 `/companies` + 美国 `job_company_sources`）
2. 官方 careers URL / ATS / 外部 ID / 地区 scope
3. 登记 `companies` + `company_sources`，指定 `completeness_source`
4. ≤20 条样本
5. 全量直到 `reported_total` 对账；提前结束必须 `incomplete`
6. 有界详情 repair
7. 3 周期后标 `regular`

推荐顺序：Shopify、Airbnb、DoorDash、Lyft → Uber、Cisco、Qualcomm、AMD、Dell、Broadcom、ServiceNow、Salesforce、Oracle → IBM、Workday（公司）。  
每 5 家出一份报告。Wave A 已走完。当前执行 Wave B，见第 5 节 F。

## 8. 并行方式（稳中求快）

```text
轨道 1 连接器（串行，当前只允许 Apple 地点）
  目录口径 → Apple 地点核实/修复

轨道 2 配置（可与轨道 1 观察期并行）
  Jefferies RSS 降级、Barclays login 停用

轨道 3 质量 repair（只吃 coverage_complete；Apple 地点验收后铺开）
  现有 beat，低并发

轨道 4 Wave A（阶段 E 门槛全部满足后）
  稳定 ATS 一家家接入
```

禁止：轨道 1 同时改两个连接器；禁止为赶进度提高同一 ATS 并发；禁止美国站 systemd timer 和应用内 worker 同时开。

## 9. 每日只回答这 6 个问题

1. 主目录是否 200，101 家是否都在？Pinterest / Box / Instacart / Plaid / Chime / Dropbox / GitHub / DocuSign / Snowflake / Zoom / LinkedIn 是否仍为 coverage=complete？HubSpot 是否仍未误登记？
2. `coverage_incomplete` 是否已不再包含「只是缺描述/缺地点」的公司？
3. Amazon 是否仍约 22,562 且 `source_complete`，而不是掉回 10,000？
4. 今天有没有错误关闭（不完整快照关岗必须为 0）？
5. Apple「未注明」是否已按官方 jobDetails 对照，而不是被当成覆盖失败？
6. Wave A 是否已按工厂接入且没有跳过样本？Shopify / Airbnb / Lyft / Uber / Cisco / Qualcomm / AMD / Dell / Broadcom / ServiceNow / Salesforce / Oracle / IBM / Workday / DoorDash 是否均为 coverage=complete？Qualcomm 不得再掉回 incomplete。IBM 不得加入 HTML 详情源。DoorDash 不得把官网 776 listing 行或 HTML 403 当成覆盖缺口。

## 10. 回滚

- 只回滚单个 connector 或单家 `CompanySource`
- 改前备份 `/opt/global-jobs/app/connectors.py` 和 `services.py`，带 UTC 时间戳
- 不回滚采集器数据库，不删岗位
- 分区抓取若 429/数量骤降：停该公司源，保留已写入，状态回到 `coverage_incomplete`

## 11. 总验收

采集器本轮完成，当且仅当：

- Amazon、BofA、Accenture 保持 `coverage_complete` 并观察 3 周期，美国站才接收这三家关闭事件
- Jefferies 不再用 RSS 关岗或报官方总数
- 质量 `partial` 不再出现在覆盖工单
- Apple 空地点/「未注明」已用官方 jobDetails 核实；能补的已补，官网未发布城市的保持官方原句
- 详情阻塞公司有停放原因，不占用重试槽
- Wave A 至少完成工厂验证（建议先 2 家稳定 ATS），其余按队列继续
- 任意不完整快照关闭数 = 0
- 美国站主 Feed 仍正常增量；不因本轮采集器改动重置游标

## 12. 其它文档怎么用

本文已经是仓库唯一采集器执行入口。

- 规范继续看 `docs/job-sync-operations.md`、`docs/job-company-field-connector-runbook.md`、`docs/job-company-onboarding-runbook.md`
- 新鲜度规则看 `docs/job-freshness-and-link-reliability-solution.md`
- 流水账只追加 `docs/job-company-field-execution-log.md`
- `docs/job-sync-master-roadmap.md`、`docs/job-sync-fast-track-completion-plan.md`、`docs/job-sync-discovery-resolution-plan.md`、`docs/north-america-tech-company-capture-plan.md` 已加移交说明，不再当开工清单
