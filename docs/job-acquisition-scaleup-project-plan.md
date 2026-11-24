# 海外岗位规模化采集与实时更新项目计划

更新时间：2026-11-24
状态：待评审（本文件只做规划，不改生产配置、不改岗位状态）
适用范围：上游采集器 `/opt/global-jobs`、美国站 Feed 消费、Supabase `jobs` 与后台同步大屏

关联文档：

- [`job-sync-master-roadmap.md`](job-sync-master-roadmap.md)：岗位同步长期治理
- [`upstream-collector-steady-plan.md`](upstream-collector-steady-plan.md)：采集器当前执行入口
- [`job-freshness-and-link-reliability-solution.md`](job-freshness-and-link-reliability-solution.md)：新鲜度与链接可靠性
- [`job-company-onboarding-runbook.md`](job-company-onboarding-runbook.md)、[`job-company-field-connector-runbook.md`](job-company-field-connector-runbook.md)：单家公司接入与字段证据规范

---

## 0. 一页结论

**现在的瓶颈不是“抓得不够快”，而是“接入单位选错了”。**

当前是“一家公司一家公司接”：确认官网 → 找 ATS → 写/配连接器 → 20 条 dry-run → 20 条 canary → 全量 → 观察 3 个周期。按现有节奏一天 1～2 家，169 家已经花了约三个月；照这个速度到 1,000 家需要约两年，到 5,000 家不现实。

**更快的办法是把接入单位从“公司”换成“ATS / job board”。**

一个 Greenhouse 适配器可以覆盖 7,500+ 家公司，一个 Ashby 适配器覆盖数千家；board token 可以从公开的 Common Crawl URL 索引批量枚举，再逐个探测官方 JSON。这样“接入一家公司”的成本从 4～8 人时降到“一次配置 + 自动 canary”，吞吐量由工程能力决定，而不是由人工验收决定。

本计划推荐三路并用：

| 路线 | 上线速度 | 覆盖 | 数据质量 | 法律/合规 | 结论 |
|---|---|---|---|---|---|
| A. 继续逐家接入 | 1～2 家/天 | 只能覆盖重点公司 | 最高（完整快照+字段证据） | 低 | 保留，只用于 Tier S/A |
| B. 采购聚合 API | 1～3 天 | 广，但以摘要为主 | 中（多为 snippet，需跳转） | 中（授权、署名、禁止反向直连） | 只做缺口兜底 |
| C. ATS 批量接入 + 泛化 JSON-LD | 2～4 周见规模 | 数千家，官方源 | 高（官方 JSON、可回链） | 低（公开 API + 遵守 robots） | **主线** |
| D. 抓 LinkedIn / Indeed / Glassdoor | 1 周 | 最广 | 中 | **高**（合同、封禁、诉讼风险） | **不做** |

**90 天目标（承诺值 / 冲刺值）：**

- 接入 board：1,000（D30）→ 3,000（D60）→ 6,000（D90，冲刺 8,000）
- 在招岗位：8 万（D30）→ 18 万（D60）→ 25 万+（D90）
- 新增岗位端到端延迟：Tier S ≤ 15 分钟，Tier A ≤ 30 分钟；按岗位量加权的 P95 ≤ 30 分钟（Tier S/A 覆盖 90% 以上新增岗位）
- 轮询成功率 ≥ 99%，错误关岗率 < 0.1%，核心字段有官方证据的比例 ≥ 95%
- 增量基础设施成本控制在 $500～$2,000/月（不含人工）

**如果只给两周，最快的落地路径：**

1. 第 1 周：GH/Ashby/Lever 各 100～200 个 board（直接从公开 board 清单 + 现有公司域名解析），列表级上线；美国站加 `last_seen_at` + TTL 软隐藏（默认行为不变）。
2. 第 2 周：扩到 1,500 board，GH 用 `content=false` 浅轮询 + 变化拉正文，详情队列异步补；上线新鲜度看板。
3. 不做：Workday 扩量、SmartRecruiters/Personio、聚合 API 采购、任何 LinkedIn/Indeed 抓取。

两周后可达到约 1,500 board、8～12 万在招岗位、新增 P95 ≤ 60 分钟。这比“再逐家接 20 家公司”快一个数量级，而且不引入新的合规风险。

需要投入：后端 2 人 + 数据/运维 1 人（0.5～1 FTE），约 20 人周；P0 只用 2 人 1 周即可跑出第一批 500 个 board。

**需要拍板的四件事：**

1. 是否按本计划的 90 天目标投入 2 名后端 + 1 名数据/运维？
2. 是否允许 P0/P1 接入 Greenhouse / Ashby / Lever / Breezy / Recruitee / Teamtailor（robots 允许的六类）？
3. 是否接受“列表级先上线、详情异步补、TTL 软隐藏”的产品口径？（这是提速的关键，不放宽就快不起来）
4. 是否采购 Adzuna 作为缺口兜底？（需 licence 询价；不采购也能跑，只是新市场冷启动慢 2～4 周）

---

## 1. 现状与瓶颈（用现有事实说话）

### 1.1 当前盘子

| 指标 | 数值 | 时间/来源 |
|---|---:|---|
| 上游采集公司 | 101 家（10 月）→ 169 家（11 月盘点） | `upstream-collector-steady-plan.md`、`job-company-field-execution-log.md` |
| 美国站在招岗位 | 36,796 条 | `north-america-tech-company-capture-plan.md`（2026-08-17） |
| 上游岗位总量 | 97,906 条 | 同上 |
| Workday 公司 | 54 家，66,542 条 `source_url` | `workday-429-front-door-solution.md`（2026-11） |
| 主 Feed 增量周期 | 2～15 分钟（目标） | `job-freshness-and-link-reliability-solution.md` |
| 单家接入人工成本 | 4～8 人时（探测 + dry-run + canary + 观察） | 运行手册流程推算 |
| 采集节奏上限 | 一天最多 1 家高风险 / 2 家稳定 ATS | `upstream-collector-steady-plan.md` §5 |

> 以上数量是历史快照，执行前必须先在目标环境重新查询；不要把这里的 36.8k / 97,906 当作当前生产值。

### 1.2 真正的五个瓶颈

1. **接入单位是公司，不是 ATS。** 大多数公司只是某个 ATS 的一个 tenant；为每家公司重复探测、重复验收，是线性人力成本。
2. **“完整快照 + 三周期观察”才能上线。** 这套规则对“关岗”是必要的，对“展示新岗位”过度了。新岗位本来可以先展示、后补证据。
3. **刷新方式是“定时全量”，不是“变化驱动”。** 大 board 全量抓一次几 MB 到十几 MB，Workday 全量要翻几十页；为了拿新岗位而全量重扫，既慢又容易触发 429/Cloudflare。
4. **发现方式是人工找 careers 页。** 没有“公司 → ATS board token”的批量发现，长尾公司永远进不来。
5. **字段质量门槛和展示门槛绑在一起。** 缺薪资、缺截止日期、缺正文的岗位被挡在外面；其实可以先以“列表级”上线，详情异步补。

> 结论：需要一条“批量快车道”，与现有“权威慢车道”并行。快车道负责“有没有、新不新”，慢车道负责“准不准、关不关”。

---

## 2. 目标、SLA 与边界

### 2.1 目标

| 指标 | 现状 | D30 | D60 | D90 |
|---|---:|---:|---:|---:|
| 活跃 board 数 | ~169 公司 | 1,000 | 3,000 | 6,000（冲刺 8,000） |
| 在招岗位（目标地区） | 36.8k | 80k | 180k | 250k+ |
| 新增岗位 P95 延迟（按岗位量加权） | 受日爬限制 | ≤ 60 min | ≤ 30 min | ≤ 30 min（Tier S ≤ 15 min） |
| 轮询成功率 | 未统一度量 | ≥ 98% | ≥ 99% | ≥ 99.5% |
| 错误关岗率 | 目标 0 | < 0.5% | < 0.2% | < 0.1% |
| 核心字段官方证据率 | 部分公司 | ≥ 90% | ≥ 95% | ≥ 95% |
| 单岗位月成本 | 未核算 | — | — | ≤ ¥0.05 |

### 2.2 新鲜度分级

| Tier | 范围 | 浅轮询（发现新岗/变化） | 深快照（关岗证据） |
|---|---|---|---|
| S | 目标用户最关心的 300 家（大厂、投行、咨询、AI 公司） | 5～10 分钟 | 每日 1 次 |
| A | 高价值 2,000 家（sponsoring 友好、校招量大） | 15～30 分钟 | 每 3 天 |
| B | 长尾 3,000～6,000 家 | 2～6 小时 | 每周 |
| C | 休眠/低活跃 board | 24 小时 | 每两周 |

轮询间隔不是固定值：连续 N 次无变化的 board 指数退避到该 Tier 上限；出现变化立即回到基准间隔。这就是“自适应轮询”，比统一 5 分钟省一个数量级的请求。

### 2.3 明确不做

- 不抓 LinkedIn / Indeed / Glassdoor 的登录态页面，不绕验证码，不用个人 Cookie，不用非官方镜像。
- 不采购 LinkedIn/Indeed 来源的数据集做公开重展示（合同与来源风险）。
- 不用模型猜测薪资、截止日期、经验要求；没有官方证据就留空。
- 不因为字段缺失、解析失败、403/429/超时改变岗位上下架状态。
- 不为“覆盖数”接入明显不相关的 staffing agency / 垃圾 board；先做公司相关性评分。

---

## 3. 路线对比与关键事实

### 3.1 为什么 ATS 批量是当前最优解

2026-11-24 本次调研与实测确认了以下事实（可作为选型依据）：

- **Greenhouse**：`GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs` 公开、无需鉴权；`?content=true` 直接返回完整正文；单 board 全量约 0.2～6 MB（本次实测 Stripe 6.07 MB；公开测量中 GitLab 177 KB / 251 条）。列表带 `updated_at`、`first_published`；只返回在招岗位；有 `ETag`（弱）；webhook 仅租户可用。供应商自称 7,500+ 客户。
- **Ashby**：`GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true`，无需鉴权，返回正文与薪酬；强 `ETag`，`Cache-Control: public, max-age=60`；大 board 可达 14 MB（OpenAI）。
- **Lever**：`GET https://api.lever.co/v0/postings/{site}?mode=json`，无需鉴权，返回 `descriptionPlain`；只有 `createdAt`，没有 `updated_at`；robots 允许但要求 `Crawl-delay: 1`。
- **SmartRecruiters**：`GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings`，公开；但 `api.smartrecruiters.com` 的 robots 对通用 UA 是 `Disallow: /`，只对 LinkedInBot 放行 `/v1/companies/`。**商用前必须获得许可，不能默认可用。**
- **Personio**：`https://{tenant}.jobs.personio.de/xml` 可读；但部分租户 robots 明确 disallow `/xml`；CDN `s-maxage=3600`，天生 1 小时延迟。**默认不纳入批量接入。**
- **Workable**：`https://apply.workable.com/api/v1/widget/accounts/{sub}?details=true` 可读，但高并发会被限流；没有 `updated_at`。
- **Workday**：CXS 接口工作正常，20 条/页，只有相对时间 `postedOn`（“Posted Today”），没有可靠的绝对发布时间；适合“首页浅轮询 + 周期深快照”，且现有 `myworkdaysite.com` 前门方案已验证 54/54 可用。
- **Breezy / Recruitee / Teamtailor**：公开 feed 已由公开审计逐路径确认（Breezy `{token}.breezy.hr/json`、Recruitee `{token}.recruitee.com/api/offers/`、Teamtailor `{token}.teamtailor.com/jobs.json`），robots 允许。

> 这六类（Greenhouse、Ashby、Lever、Breezy、Recruitee、Teamtailor）已被公开测量项目 [`open-ats-feed`](https://github.com/veresk06/open-ats-feed) 枚举：**32,545 个候选 token → 18,164 个 live board → 439,867 条在招岗位**（2026 年数据，MIT，测量结果公开）。这直接证明“数千家公司可以在数周内接入”，而不是两年。

> 数据置信度：以上端点、robots、ETag、体积为 2026-11-24 实测或厂商文档；供应商客户数（如 7,500+）和第三方测量数字只用于容量规划，正式接入前需用自己的探测复核。`open-ats-feed` 的读数是 2026-09-03 的，**距今约 3 个月，必须重新探测**，不能直接当当前在招数使用。

### 3.2 聚合 API 只能做兜底

- **Adzuna**：明确允许“publishing listings”，但要求每个岗位展示 116×23 px 的 “Adzuna” 链接署名；返回的是 snippet，申请链接是 Adzuna 跳转；商业使用需要 licence；**明确禁止用 API 发现雇主后绕开它直连**。
- **Careerjet**：publisher API 按终端用户 IP/UA 调用，设计上不允许批量采集；批量只能走单独审批的 XML feed。
- **Jooble / TheirStack / JobsPikr / Coresignal**：授权与价格需逐家谈，且多为内部分析授权，公开重展示受限。
- **Google Jobs / SerpApi**：可以“看到”，但不能把 Google 索引内容重展示到自己的站点。
- **Bright Data 等数据集**：一次性快照约 $0.0025/条，1M 条约 $2.5k；30 天后就过时，且 LinkedIn/Indeed 来源不适合公开重展示。

结论：聚合 API 适合“新市场冷启动的 2～4 周兜底”或“长尾地区补缺”，不适合做长期主数据源。**主数据源必须是官方 ATS。**

### 3.3 LinkedIn / Indeed 不是捷径

- LinkedIn 没有公开的职位读取 API；Job Posting API 是写入型，且当前不开放新合作。
- hiQ 案之后，抓公开页面在 CFAA 上的风险下降，但**合同违约**风险仍在；2024～2025 年已有针对 scraping 供应商的禁令与关停案例（如 LinkedIn v. Proxycurl）。
- 登录、换号、绕验证码会从民事争议升级为 CFAA/DMCA §1201 风险。
- 对留学生平台，数据“看起来多”但真实性、可申请性、下架及时性都不可控，反而伤害 AI 选岗口碑。

**结论：不做。** 把这部分预算换成 ATS 批量接入的工程投入，6 周后的覆盖更大、更稳。

---

## 4. 目标架构：双平面 + 六条流水线

```text
┌───────────────────────────── 发现平面（一次性/每周） ─────────────────────────────┐
│ 公司宇宙（域名/榜单/VC portfolio/学校名单）                                        │
│        │                                                                          │
│        ▼                                                                          │
│ W1 发现工厂：careers URL 解析 → ATS 指纹 → token 探测 → robots/ToS 判定 → ats_boards │
└───────────────────────────────────────────────────────────────────────────────────┘
                                   │
┌───────────────────────────── 采集平面（常驻） ─────────────────────────────────────┐
│ W3 调度器：Tier S/A/B/C + 自适应退避 + 单 host 令牌桶 + 熔断                        │
│        │                                                                          │
│        ▼                                                                          │
│ W2 连接器 SDK：GH / Ashby / Lever / Breezy / Recruitee / Teamtailor / Workday      │
│                 + JSON-LD 泛化连接器（sitemap 发现）                               │
│        │  raw payload → S3（压缩、90 天）                                          │
│        ▼                                                                          │
│ W4 标准化/去重：source_key + external_job_id、canonical apply URL、地区/岗位族      │
│        │                                                                          │
│        ▼                                                                          │
│ 上游 Postgres（job_source_records + 聚合后的 jobs）                                │
└───────────────────────────────────────────────────────────────────────────────────┘
                                   │ 增量 Feed（source_key + updated_since + snapshot_id）
                                   ▼
┌───────────────────────────── 美国站（消费/展示） ─────────────────────────────────┐
│ 主 Feed worker → Supabase jobs（列表级立即可见，详情异步补）                        │
│ W5 生命周期：完整快照关岗（权威线） + last_seen TTL 软隐藏（长尾线）                 │
│ W6 观测：覆盖、延迟、成功率、重复、错误关岗抽样、成本                               │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 五条设计原则

1. **接入单位 = ATS 族 + board**，公司只是 board 的属性；新 ATS 才写代码，新公司只加一行配置。
2. **两级抓取**：浅轮询只看“最新一页/ID 集合哈希”，深快照按 Tier 周期跑；新岗位靠浅轮询，关岗靠深快照。
3. **展示与关岗解耦**：列表级岗位可以 T+0 上线；关岗必须有完整快照或 404/410 证据。
4. **变化驱动**：优先用 `ETag/If-None-Match`、ID 集合哈希、`updated_at`；只对新增/变化的岗位拉详情。
5. **自动 canary 替代逐家人工 dry-run**：新 board 自动跑 5～20 条真实样本 + 结构校验；失败进隔离队列，人工只看失败和 1% 随机抽样。

---

## 5. W1：公司/ATS 发现工厂（第 1～2 周）

### 5.1 输入

1. 现有 169 家上游公司 + 美国台账 75 家。
2. 公开公司清单：Fortune Global 2000、目标地区上市公司、VC portfolio（a16z/Sequoia/Index/YC）、学校 career fair 名单、现有用户投递去向。
3. **`open-ats-feed` 的 18,164 个 live board 清单**（公开 CSV，读取日 2026-09-03；只作候选 token，不直接使用它的岗位数据）：每个 token 仍要自己探测官方 API、检查 robots、验证当前岗位。优先用 `engineering.csv`（500 个按工程岗位量排序的 board）做 P0 种子。
4. 已知 ATS host 的 Common Crawl CDX 前缀枚举（Greenhouse/Ashby/Lever/Breezy/Recruitee/Teamtailor），用于每周发现新 board。

### 5.2 处理流程

```text
domain → https://{domain}/careers、/jobs、/careers/jobs、sitemap.xml
       → 跟随 301/302，记录最终 host
       → 匹配 ATS 指纹（host + 路径 + meta generator）
       → 提取 token/site/tenant
       → 探测官方 API 首页（limit=5）
       → 校验：HTTP 200、JSON 结构、岗位数 > 0、岗位 URL 可回链
       → 判定 robots/ToS（Allow / Disallow / Unknown）
       → 写入 ats_boards（status=candidate/active/quarantined）
```

### 5.3 `ats_boards` 表（上游新增）

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `vendor` | greenhouse / ashby / lever / breezy / recruitee / teamtailor / workday / jsonld |
| `token` | board token / site / tenant |
| `site` | Workday 的 site；其他为空 |
| `company_name` | 规范化公司名（可空，待人工确认） |
| `company_domain` | 官网域名 |
| `careers_url` | 官方 careers URL（证据） |
| `region_scope` | 目标地区范围（US/CA/UK/EU/SG/AU） |
| `robots_verdict` | allow / disallow / unknown（附证据 URL 和时间） |
| `status` | candidate / active / paused / quarantined |
| `confidence` | 0～1（探测结果 + 公司匹配度） |
| `posting_count` | 最近一次探测到的在招数 |
| `first_seen_at` / `last_ok_at` | 生命周期 |
| `last_error` | 最近失败原因 |

### 5.4 验收

- 200 个域名的 pilot：ATS 识别准确率 ≥ 85%，误判全部进 `quarantined`，不直接上线。
- 第 1 周产出 ≥ 500 个可探测 board；第 2 周 ≥ 1,500 个。
- 每个 board 都有 `careers_url` + `robots_verdict` 证据；没有证据的不进 `active`。

---

## 6. W2：通用连接器 SDK（第 1～3 周）

### 6.1 统一接口

```ts
interface BoardAdapter {
  vendor: string;
  capabilities: {
    listIncludesContent: boolean;   // GH/Ashby/Lever = true
    hasUpdatedAt: boolean;          // GH/Recruitee = true
    hasPostedAt: boolean;           // GH/Ashby/Lever = true
    supportsETag: boolean;
    supportsWebhook: boolean;       // 仅租户可用
    listIsComplete: boolean;        // 只返回在招岗位 = true
  };
  list(board: Board, opts: { since?: string; page?: number }): Promise<ListResult>;
  detail?(board: Board, id: string): Promise<JobDetail>;
  health(board: Board): Promise<HealthResult>;
}
```

`ListResult` 至少包含：`jobs[]`、`reported_total`、`page_info`、`etag`、`fetched_at`、`raw_payload_key`。

### 6.2 适配器优先级

| 批次 | ATS | 理由 |
|---|---|---|
| P0 | Greenhouse、Ashby、Lever | 公开、无需鉴权、列表即正文、覆盖最大；robots 允许 |
| P1 | Breezy、Recruitee、Teamtailor | 公开 feed、robots 允许，补齐长尾 |
| P2 | Workday | 已有 54 家与 429 前门方案；扩量即可 |
| P3 | Workable、SmartRecruiters、Personio | 有限流/robots 限制，先谈许可或只做已授权客户 |
| P4 | JSON-LD 泛化 | 无 ATS 的自建 careers 页，靠 sitemap + schema.org/JobPosting |

### 6.3 每个适配器必须通过的测试

1. 20 条脱敏 fixture（普通/实习/校招/多地点/远程/无经验/字段缺失）。
2. 100 条真实岗位 canary：标题、外部 ID、URL、地点、岗位类型、正文长度可解释。
3. 分页/终止条件测试：短页即停、重复 ID 即停、越界页丢弃（Workday 的 `offset>0 total=0` 坑必须覆盖）。
4. 429/403/超时/空 JSON/HTML 错误页：只记录 health，不产生关闭事件。
5. 幂等：同一 board 连续抓两次，不产生重复岗位。

---

## 7. W3：调度与新鲜度（第 2～3 周）

### 7.1 调度模型

- 每个 board 一行调度状态：`next_poll_at`、`poll_interval`、`consecutive_unchanged`、`consecutive_failures`、`circuit_state`。
- 单 host 令牌桶：Greenhouse/Ashby/Lever 各自独立限速，默认 2～4 req/s，遇到 429 降到 1 req/s 并熔断 60s 起指数退避。
- 全局并发上限与按 vendor 的并发上限分开；不允许一个 vendor 拖停全部。
- 任务队列：`list_poll`（高频、短）、`detail_fetch`（只对新增/变化）、`deep_snapshot`（低频、长）、`discover`（每周）。

### 7.2 变化检测

1. 优先 `If-None-Match`；304 直接记为“无变化”，更新 `last_ok_at`。
2. 没有 ETag 的 vendor：计算 `board_id_hash = sha1(sorted(external_ids))` + `content_hash`（列表字段）。
3. 有 `updated_at`（Greenhouse）：只对 `updated_at > last_poll_at` 的岗位拉详情。
4. 没有 `updated_at`（Lever/Ashby/Workable/Rippling/Personio）：ID 集合 diff + 逐条 content hash；新增/变化的才拉详情。
5. **不要用“发布时间”判断新旧**：Workday 只有相对时间，Lever 只有 createdAt；以“首次见到”为准。

### 7.3 请求预算（按 6,000 board 估算）

| 项 | 估算 | 说明 |
|---|---:|---|
| 浅轮询请求/天 | 15～20 万 | 平均 24～32 次/board/天；自适应退避后低于固定 30 分钟 |
| 深快照请求/天 | 1～2 万 | 按 Tier 周期分散 |
| 详情请求/天 | 1～3 万 | 只对新增/变化；GH/Ashby/Lever 列表已带正文，可再降 |
| 带宽/天 | 20～60 GB | 取决于大 board 比例；ETag + 浅列表可压到下限 |
| 峰值并发 | 20～40 | 按 host 令牌桶与队列控制 |

> 关键优化：**Greenhouse 轮询用 `content=false`，只有 ID 集合或任一 `updated_at` 变化时才拉 `content=true`（或按变化 ID 逐条拉详情）。** 这样 Stripe 这类大 board 的轮询体积从 6 MB 降到约 0.5 MB，同时仍能拿到完整正文。若描述被修改但 `updated_at` 未变（少数 ATS），只能靠周期深快照兜底。

### 7.4 Webhook（可选加速）

Greenhouse/Ashby/Recruitee/Workable 都有租户级 webhook，但需要客户授权，不能用于“别人的 board”。因此 webhook 只作为“已合作客户”的加速通道，不作为主路径。

---

## 8. W4：标准化、去重与入库（第 3～4 周）

### 8.1 身份与去重

- 上游 source record 主键：`(vendor, board_token, external_job_id)`。
- 对美国的 `external_job_id` 统一加前缀：`{vendor}:{token}:{id}`，避免不同 ATS 的数字 ID 冲突；现有 `jobs(source_system, external_job_id)` 唯一索引保持不变。
- 多 board 同公司（如 DoorDash 5 个 Greenhouse board）：按 `company_id + normalized_title + location + content_hash` 生成 `dedupe_group_id`，展示层只出一条，来源保留多行。
- URL 只作为属性：同一岗位换 URL 不新建记录；`apply_url` 取官方 ATS 申请链接，`source_url` 保留官方岗位页。

### 8.2 字段分级

| 层级 | 字段 | 上线时机 |
|---|---|---|
| L1 列表级 | 标题、公司、地点、岗位链接、申请链接、发布时间（有则用） | 首次抓取即可展示 |
| L2 详情级 | 正文、部门、岗位类型、经验、薪资、截止日期 | 详情队列异步补，有证据才写 |
| L3 派生级 | 地区标准化、岗位族、visa 信号、相关性评分 | 规则/模型辅助，但不伪造官方字段 |

每个字段保留 `field_status`：`official_payload` / `listing_only` / `unavailable_on_official_source` / `not_fetched`。前端与 AI 选岗按状态使用，不把空值当“没有要求”。

**入库约束（容易漏掉的坑）：**

- `jobs.region / direction / audience` 是 `NOT NULL`，但**不是批量入库的阻塞项**：`normalizeFeedItem` 会从 `location` 推 region，从 `job_function / department / title` 推 direction，`audience` 固定为“留学生”。
- 真正的风险是 `inferDirection` 的兜底值是 `Finance`：护士、销售、行政也会被算成金融。批量来源必须让上游输出可靠的 `job_function`；美国站要加“其他”兜底并做方向抽检，不能为了满足约束把未知岗位伪装成 Finance。
- `company` 解析不出的 board 进 `quarantined`，不写岗位；不能把 token 当公司名写进生产。
- `description` 可以为空；`posted_at` 只在官方字段存在时写，不用 `created_at` 冒充发布时间。

### 8.3 数据库改造（美国站）

```sql
alter table public.jobs
  add column if not exists source_key varchar(120),
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists detail_fetched_at timestamptz,
  add column if not exists display_status varchar(20) not null default 'listed',
  add column if not exists dedupe_group_id text,
  add column if not exists source_tier char(1) not null default 'B';

create index if not exists jobs_last_seen_active_idx
  on public.jobs(last_seen_at) where is_active = true;
create index if not exists jobs_dedupe_group_idx
  on public.jobs(dedupe_group_id) where dedupe_group_id is not null;
```

存量回填规则（避免默认值改变现有展示）：

- 现有 `collector_feed` 且已有关联详情/正文的岗位 → `display_status='enriched'`，`last_seen_at=coalesce(last_verified_at, updated_at)`。
- 现有 `collector_feed` 但只有列表字段的岗位 → `display_status='listed'`。
- 迁移脚本必须支持 `--dry-run` 与按 `source_system` 分批，不改变 `is_active` / `is_closed`。

`display_status`：`listed`（列表级可见）/ `enriched`（详情已补）/ `stale`（超过 TTL 未见）/ `closed`（有证据关闭）。默认列表只展示 `listed/enriched`，`stale` 降权或折叠，`closed` 不展示。

### 8.4 Feed 契约 v2（上游 → 美国站）

新增字段：

```json
{
  "source_key": "greenhouse:stripe",
  "external_job_id": "greenhouse:stripe:7891234",
  "apply_url": "https://boards.greenhouse.io/stripe/jobs/7891234",
  "source_updated_at": "2026-11-24T06:12:00Z",
  "first_seen_at": "2026-11-24T06:15:00Z",
  "snapshot_id": "stripe-2026-11-24T06:00:00Z",
  "is_list_only": false
}
```

Feed 必须支持：`since`（按 `source_updated_at`/变更时间）、`company_id`（现有）、`source_key`（新增）、`include_closed`（现有）。每页成功后持久化游标；页面级失败不推进；行级失败进失败队列。

> 现有全局游标在 3.6 万岗位下够用；到 25 万岗位时，增量只处理“变化”，但**每页处理量、批量 upsert、失败隔离**必须提前压测。建议在 P1 结束前做一次 10 万条变更的回放压测。

---

## 9. W5：生命周期——两条轨道（第 4～5 周）

### 9.1 权威线（Tier S/A）

沿用现有规则：

- 完整快照缺失 + 连续 2 次独立成功确认 → 关闭。
- 官方详情 404/410 → 关闭；403/429/超时 → 不关闭。
- 关闭前生成可恢复清单，保留岗位 ID 与用户关联数据。

### 9.2 长尾线（Tier B/C）

新增 **TTL 软隐藏**：

- 每次成功轮询更新 `last_seen_at`。
- `last_seen_at` 超过 `max(3 × poll_interval, 24h)`（S/A）或 7 天（B/C）→ `display_status='stale'`。
- `stale` 不写 `is_closed=true`，不出现在默认列表；详情页显示“该岗位近期未在官网列表出现，可能已关闭”，并提供官方链接。
- 只有连续 3 次成功“完整列表轮询”都缺失，才进入 `closed` 候选，且仍需 404/410 或完整快照确认。

**为什么这样做：** 长尾 board 的列表是完整的（只返回在招），但单次失败、CDN 缓存、分页中断都会造成“假缺失”。TTL 软隐藏既保证用户看不到过期岗位，又不会因一次抖动误关。

### 9.3 关闭预算与审计

- 每个 source 每天关闭率 > 5% → 自动暂停并告警。
- 每天随机抽 20 条已关闭岗位，用官方详情/列表复核；错误率 > 0.1% 立即回滚当天关闭批次。
- 任何关闭都记录：证据类型、证据 URL、快照 ID、运行 ID、操作者（自动/人工）。

---

## 10. W6：观测、告警与验收（贯穿）

### 10.1 必看指标

| 类别 | 指标 | 目标 |
|---|---|---|
| 覆盖 | active board / 发现 board；有岗位公司数；目标地区岗位数 | 周环比增长 |
| 新鲜度 | `first_seen_at - posted_at` P50/P95；`last_seen_at` 年龄 | P95 ≤ 30 min |
| 可靠性 | 每 vendor 轮询成功率、429 率、超时率、熔断次数 | ≥ 99% |
| 质量 | 外部 ID 重复率、正文覆盖率、字段证据率、死链率 | 重复 0；证据 ≥ 95% |
| 生命周期 | 每日关闭数、关闭审计错误率、stale 比例 | 错误 < 0.1% |
| 成本 | 请求数/天、带宽/天、存储 GB、$/1k 岗位 | 月度下降 |

### 10.2 告警

- 单 board 连续 3 次失败 → 降级该 board，不影响同 vendor 其他 board。
- 单 vendor 成功率 < 95% → 暂停该 vendor 的新增接入，先修适配器。
- 某 board 新岗位率突然下降 80% → 检查 ATS 改版/robots/限流。
- 全局 Feed 延迟 > 15 分钟 → 告警（沿用现有）。
- 单日关闭率 > 5% → 自动暂停关闭 + 人工复核。

### 10.3 每周报告（固定模板）

`新增 board / 新增岗位 / P95 延迟 / 失败 Top 10 / 关闭审计 / 重复率 / 成本 / 下周计划`

---

## 11. 路线图（8 周，按周排）

| 阶段 | 周 | 交付物 | 退出标准 |
|---|---|---|---|
| P0 试点 | W1 | 200 域名发现 pilot；GH/Ashby/Lever 各 100 board canary；TTL 软隐藏开关；新鲜度看板第一版 | 500 board active；P95 ≤ 60 min；错误关岗 0 |
| P1 起量 | W2～W3 | 1,000 board；GH 浅轮询 + 变化拉正文；详情队列；Feed v2 设计 + 20 条 canary；去重规则 | 8 万岗位；轮询成功率 ≥ 98%；重复率 < 0.5% |
| P2 扩族 | W4～W6 | 3,000 board；Breezy/Recruitee/Teamtailor 适配器；Workday 扩量；JSON-LD 泛化连接器；关闭审计 | 18 万岗位；P95 ≤ 30 min；错误关岗 < 0.2% |
| P3 规模化 | W7～W8 | 6,000 board（冲刺 8,000）；自适应退避；成本优化；区域扩围；运营手册 | 25 万+ 岗位；成功率 ≥ 99.5%；错误关岗 < 0.1% |
| P4 常态化 | 持续 | 每周发现新 board；每月新增 1 个 ATS 适配器；季度审计 | 覆盖与新鲜度不倒退 |

### 11.1 关键依赖（顺序不能反）

1. `ats_boards` + 发现工厂 → 才有批量来源。
2. `source_key` + Feed v2 → 才能安全承载 6,000 个来源。
3. TTL 软隐藏 → 才能让长尾先上线而不误关。
4. 去重 → 才能避免多 board 公司刷屏。
5. 观测 → 才能在扩量时及时止损。

---

## 12. 团队、工作量与成本

### 12.1 角色与投入

| 角色 | 职责 | 人周 |
|---|---|---:|
| 后端工程师 A（连接器） | W2 适配器、W1 探测、canary | 8 |
| 后端工程师 B（数据/Feed） | W3 调度、W4 入库、Feed v2 | 7 |
| 数据/运维（0.5～1 FTE） | 队列、监控、S3、告警、日报 | 4 |
| 产品/QA（0.5） | 验收样本、相关性规则、关闭审计 | 2 |
| **合计** | | **约 21 人周** |

### 12.2 增量成本（估算，按现有服务器之外）

| 项 | 月成本 | 说明 |
|---|---:|---|
| Worker/VPS（1～2 台） | $40～$120 | 现有采集器可先复用 |
| S3 原始 payload（90 天） | $30～$80 | 压缩后约 0.5～2 TB |
| 代理池（可选） | $0～$1,500 | 优先不用；只在个别被误伤的 host 上做出口隔离 |
| 聚合 API（可选兜底） | $0～$3,000 | Adzuna licence 需询价；不买 LinkedIn 来源 |
| 监控/日志 | $0～$50 | 复用现有 |
| **合计** | **$70～$4,750** | 主推方案（无代理、无聚合）约 $100～$250/月 |

> 成本纪律：单岗位月成本目标 ≤ ¥0.05；超过时优先降大 board 轮询频率，而不是降覆盖率。

---

## 13. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| robots/ToS 限制（SmartRecruiters、Personio） | 高 | 中 | 默认不接入；走官方合作/授权；`robots_verdict` 作为上线硬门槛 |
| ATS API 改版/字段变化 | 中 | 高 | 适配器契约测试 + 每周 canary；单 vendor 熔断，不拖停全站 |
| 429 / Cloudflare 挑战 | 高 | 中 | 令牌桶、ETag、退避、前门（Workday 已有）；不无限重试 |
| 误关岗位 | 中 | 高 | 权威线 + TTL 软隐藏 + 关闭预算 + 每日抽样审计 |
| 多 board 重复 | 高 | 中 | `dedupe_group_id` + 展示层合并 |
| 垃圾/无关岗位（staffing agency） | 高 | 中 | 公司相关性评分、域名 allowlist、岗位族过滤 |
| Feed 吞吐不足 | 中 | 高 | Feed v2 + 批量 upsert + 10 万条回放压测 |
| 岗位量 10 倍后查询/AI 检索变慢 | 高 | 中 | `(region, direction, is_active)` 等复合索引 + 分页上限 + 25 万行影子表压测；AI 匹配先按地区/方向预过滤 |
| 团队被现有治理占满 | 高 | 中 | P0 只做 500 board 试点；不碰 Tier S 现有流程 |
| 法律争议 | 低 | 高 | 不做登录/验证码/聚合站重展示；保留来源链接与删除通道 |

### 13.1 合规红线（写进代码与 runbook）

1. 请求前检查 `robots.txt`（含归档版本），`Disallow` 的路径不抓；`Crawl-delay` 必须遵守。
2. 使用真实、可联系的 User-Agent；不伪装成浏览器去访问被禁止的路径。
3. 不登录、不绕验证码、不使用个人 Cookie、不使用非官方镜像。
4. 展示时保留“来源：公司官网/ATS”链接；收到雇主或 ATS 的下架/删除请求，24 小时内处理。
5. 不把聚合 API 的 snippet 伪装成官方正文；不绕过聚合商的跳转链接。
6. 不采购 LinkedIn/Indeed 来源数据做公开重展示。

---

## 14. 本周就能做的 7 件事（P0）

| # | 动作 | 产出 | 负责人 |
|---|---|---|---|
| 1 | 冻结基线：跑 `pnpm run audit:p0-feed`、`check:jobs-feed`、`audit:company-source-matrix`，记录当前延迟/失败/数量 | 基线报告 | 运维 |
| 2 | 导入 `open-ats-feed` 的 board 清单 + 现有 169 家，生成 5,000 个候选 token | `board_candidates.csv` | 后端 A |
| 3 | 对候选 token 做 robots + API 探测（GH/Ashby/Lever 优先），自动打分 | 500 个 `active` board | 后端 A |
| 4 | 上线 GH 浅轮询（`content=false`）+ 变化时拉正文；100 board canary | 首批真实岗位 | 后端 A |
| 5 | 美国站加 `last_seen_at`/`display_status` 迁移（dry-run + 开关），默认行为不变 | 迁移与回滚脚本 | 后端 B |
| 6 | Feed v2 契约草案 + 20 条 canary（`source_key`/`apply_url`/`snapshot_id`） | 契约文档 + canary 结果 | 后端 B |
| 7 | 新鲜度看板第一版：新增 P95、stale 比例、active board、失败 Top 10 | 看板链接 | 运维 |

**P0 验收：** 500 board active；新增岗位 P95 ≤ 60 分钟；错误关岗 0；现有 75 家 Tier S/A 行为不变。

---

## 15. 总验收标准（Definition of Done）

- [ ] 6,000 个 board 有 `careers_url`、`robots_verdict`、`last_ok_at` 证据，状态可追溯。
- [ ] 每个 vendor 有契约测试 + 100 条真实 canary；新 ATS 接入 ≤ 3 天。
- [ ] 新增岗位 `first_seen_at - posted_at` 按岗位量加权 P95 ≤ 30 分钟（Tier S ≤ 15 分钟）。
- [ ] `last_seen_at` 超过 TTL 的岗位自动 `stale`，默认列表不可见，但可回链官方。
- [ ] 关闭岗位 100% 有证据类型/URL/快照 ID；每日 20 条审计错误率 < 0.1%。
- [ ] 多 board 公司只展示一条；外部 ID 重复率 0。
- [ ] Feed 在 10 万条变更回放压测下不丢、不重、不阻塞；页面级失败不推进游标。
- [ ] 后台大屏能看到：当前 board、轮询间隔、最后成功、失败原因、stale 比例、今日新增/关闭。
- [ ] 单岗位月成本 ≤ ¥0.05；请求/带宽/存储月度报表可查。
- [ ] 现有 Tier S/A 公司的完整快照、字段证据、关岗规则未被削弱。

---

## 16. 与现有治理体系的关系

本计划不是推翻现有治理，而是**新增一条“批量快车道”**：

1. 现有 [`job-sync-master-roadmap.md`](job-sync-master-roadmap.md) 的“完整快照 → 关岗”“字段证据 → 展示”“失败隔离”原则继续有效，适用于 Tier S/A 和关岗判定。
2. 新增的 `listed` 层级允许“列表级先上线、详情后补”，但**字段仍只写有证据的值**；没有证据就显示“官网未提供”，不猜测。
3. 新 board 的接入从“逐家人工 runbook”改为“自动 canary + 抽样人工”；单家 runbook 仍用于 Tier S/A、字段回填和新 ATS 适配器开发。
4. 需要同步修订的文档（评审通过后）：
   - `job-company-onboarding-runbook.md`：增加“批量 board 接入”分支与自动 canary 标准。
   - `upstream-collector-steady-plan.md`：把“一天 1～2 家”改为“按 vendor 批量 + Tier 分层”。
   - `job-freshness-and-link-reliability-solution.md`：补充 TTL 软隐藏与 `display_status`。
   - `job-company-field-execution-log.md`：按周记录批量接入执行结果。

---

## 附录 A：ATS 能力矩阵（2026-11-24 实测/文档）

| Vendor | 列表是否含正文 | 变更时间戳 | 完整列表（仅在招） | ETag | 认证 | robots/限流 | 建议 |
|---|---|---|---|---|---|---|---|
| Greenhouse | 是（`content=true`） | `updated_at` | 是 | 弱 | 无 | 允许（禁 `/embed`） | P0 |
| Ashby | 是 | `publishedAt`（非修改时间） | 是 | 强 | 无 | 允许 | P0 |
| Lever | 是（`descriptionPlain`） | 仅 `createdAt` | 是 | 弱 | 无 | 允许，Crawl-delay 1 | P0 |
| Breezy | 是（`/json`） | 待验证 | 是 | 未见 | 无 | 允许（禁静态资源） | P1 |
| Recruitee | 是 | `updated_at` | 是 | 未见 | 无 | 允许（禁 `/v/`） | P1 |
| Teamtailor | 是（`/jobs.json`） | 未见 | 是 | 未见 | 无 | 允许（禁 `/app` 等） | P1 |
| Workday | 否（摘要） | 仅相对 `postedOn` | 是 | 无 | 无 | 允许；有 429 窗口 | P2（已有前门） |
| Workable | 是 | 无 | 是 | 未见 | 无 | 非权限问题，并发下被限流 | P3（需限额） |
| SmartRecruiters | 否（需详情） | `releasedDate`（格式歧义） | 是 | 无 | 无 | **API robots Disallow /**，仅 LinkedInBot 例外 | P3（需许可） |
| Personio | 是（XML） | 仅 `createdAt` | 是 | 无 | 无 | **归档 robots 明确 disallow `/xml`**（现网 404，不能只看 live） | 默认不接 |
| iCIMS / Taleo / SuccessFactors | 多为 HTML/需认证 | 不确定 | 不确定 | — | 有 | 复杂 | 只做重点客户 |
| JSON-LD（自建站） | 是 | `datePosted`/`validThrough` | 不一定 | 视站点 | 无 | 按站点 | P4 泛化 |

## 附录 B：种子来源清单

1. 现有上游 169 家 + 美国台账 75 家。
2. `open-ats-feed` 的 18,164 个 live board（MIT，公开测量；仅作候选 token）。
3. Fortune Global 2000 / 目标地区上市公司名单。
4. VC portfolio：YC、a16z、Sequoia、Index、General Catalyst、Lightspeed 等公开 portfolio。
5. 学校 career fair / 校友去向公司名单（对留学生最相关）。
6. Common Crawl CDX 前缀枚举（每周增量发现新 board）。

## 附录 C：成本模型假设

- 6,000 board，平均 24 次浅轮询/天；30% 的 board 有 ETag 或连续无变化退避。
- GH 浅列表平均 0.3 MB，Ashby/Lever 平均 1 MB；大 board 单独限频（6～12 小时）。
- 详情只对新增/变化岗位拉取，日增约 2～5%。
- S3 压缩后 0.5～2 TB（90 天生命周期）。
- 不含人工成本；不含 Adzuna 许可费（需询价）。

---

## 附录 D：三句话总结

1. **不要继续用“公司”做单位，用“ATS board”做单位。**
2. **不要等完整快照才上线，列表级先上，TTL 软隐藏兜底，完整快照只管关岗。**
3. **不要用 LinkedIn 的“快”换法律和稳定性风险，官方 ATS 的 18,000 个 board 已经足够大。**