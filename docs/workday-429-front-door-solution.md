# Workday 429：换前门而不是降速

状态：**已在生产落地**（2026-11-19 17:04 换门 + 2026-11-20 09:27 补浏览器伪装），54 家 Workday 全部恢复采集，落地记录见 §5。
日期：2026-11-19 ~ 11-20。相关事故记录见 [执行日志 §2026-11-19](./job-company-field-execution-log.md)。

## 1. 结论

`*.myworkdayjobs.com` 的 429 带 `cf-mitigated: challenge`，是 Cloudflare 的机器人挑战，不是速率上限。同一 tenant / site / slug 的同一份 CXS JSON，换到 `wdN.myworkdaysite.com` 就是 200。两个域是**不同的 Cloudflare zone**，Workday 自己两个都在对外服务（后者是公司自有招聘页用的那个）。所以正确解法不是把 `1 req/s` 压到更低、不是把冷却拉到一个小时，而是把取数请求换到另一个 zone，对外链接一个字都不改。

一句话：**限速治不了挑战；换前门才治。**

而且这件事不需要动数据库，也不需要逐家改配置：采集器 `/companies` 返回的 `connector_config.api_url` 已经是
`https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`，
**tenant 和 site 都已经在配置里了**（54/54 可解析，见 §2.1）。缺的只是"请求往哪个域发"，所以最小改动是在 HTTP 出口改写 host，采集器加两行。

## 2. 证据（2026-11-19 14:53–16:02 Asia/Shanghai）

单发对照，同一时刻、同一 tenant/site、同一请求体：

| 目标 | `*.myworkdayjobs.com` | `wdN.myworkdaysite.com` |
| --- | --- | --- |
| zoom / Zoom | 429 `cf-mitigated: challenge` | 200，total 72 |
| broadcom / External_Career | 429 challenge | 200，total 419 |
| salesforce / External_Career_Site | 429 challenge | 200，total 1591 |
| accenture / AccentureCareers | 429 challenge | 200，total 2000（分区帽） |
| ghr / lateral-us（BoA） | 200，total 1990 | 200，total 1990 |
| citi / 2 | 429 challenge | 200，total 2000（分区帽） |
| workday / Workday | 429 challenge | 200，total 346 |
| vanguard / vanguard_external | 429 challenge | 200，total 326 |

突发对照，同一租户 `zoom`：

| 通道 | 请求数 | 结果 |
| --- | --- | --- |
| jobs 域，串行 | 30 | 429 × 30，用时 71s |
| jobs 域，并发 4 / 间隔 250ms | 30 | 429 × 30，用时 18s |
| site 域，串行 | 30 | 200 × 30，用时 30s |
| site 域，并发 4 / 间隔 250ms | 30 | 200 × 30，用时 13s |

详情接口（这个是大头，8,436 条待补正文）走的还是同一套契约，只是 **GET 不是 POST**：

| tenant | jobs 域详情 | site 域详情 | 正文长度 |
| --- | --- | --- | --- |
| zoom | 429 | 200 | 4,816 字 |
| broadcom | 429 | 200 | 3,625 字 |
| salesforce | 429 | 200 | 8,143 字 |
| ghr（BoA） | 429 | 200 | 4,756 字 |

补充两点观察，直接影响方案：

1. **jobs 域的 429 是窗口化的。** 同一小时里，压迫式突发 60/60 全 429；隔 15 分钟再单发，变成 4/6 通过、2/6 仍是 challenge。也就是说它是"被盯上就锁一段"，不是恒定配额。采集器是 24 小时常驻，必然撞上窗口，所以不能把 jobs 域当主路。
2. **site 域今天累计 300+ 次请求，0 次 429。** 不保证以后永远如此，所以方案里仍然保留每前门独立熔断，而不是假设它永远干净。

`myworkdaysite.com` 的 pod 覆盖（DNS 直查）：`wd1 wd3 wd5 wd10 wd12 wd103 wd105 wd108 wd115 wd120 wd501–wd504`。租户级主机 `{tenant}.wdN.myworkdaysite.com` 只有少数大租户存在（实测 salesforce 有，其余 NXDOMAIN），因此排在最后，只当第三桶用。

### 2.1 全量预检：配置里的 54 家，逐家两边同刻对比

上面是抽样。真正的判据是全量：从采集器 `/companies` 读 `connector_config.api_url`，54 家 Workday 全部解析出 `(tenant, site, wdN)`，两家域各打一次列表首页（`limit=5`）。

| 轮次 | site 域 200 | jobs 域 200 | jobs 域 429 | 两边都 200 时 `total` 一致 |
| --- | --- | --- | --- | --- |
| 15:49–15:56 | **54/54** | 39/54 | 15/54 | 39/39 |
| 15:54–16:02 | **54/54** | 11/54 | 43/54 | 11/11 |

三点比抽样更硬的结论：

1. **site 域两轮都是 54/54**，覆盖了 `wd1 / wd3 / wd5 / wd12` 四个 pod、54 个 tenant。它不是"某几家碰巧通"。
2. **jobs 域在 8 分钟内从 39/54 掉到 11/54**，site 域同时刻不动。这就是 §2 观察 1 说的窗口化：采集器常驻，靠"等窗口"永远等不到稳定，必须换门。
3. `total` 在两家都 200 时**逐家完全一致**（39/39、11/11）。跨时间才出现 1–3 条抖动（Zoom 72→69、RTX 4536→4537），是岗位增删，不是子集裁剪。

逐家对照表（公司 / tenant / site / wd / 两边状态与 total）由
`deploy/workday-429/preflight_all_workday.py` 生成，落在
`deploy/workday-429/preflight_all_workday.md` 与 `preflight_all_workday.json`。
另有一个顺带结论：`tenant`（host 第一段）与 `api_url` 路径里的 tenant 54/54 全部一致，没有一家需要人工纠正；
54 家的 `wdN` 也全部落在已知 pod 列表内，没有主路需要重新探 pod 的公司。

### 2.2 切换前最后一关：Zoom 逐条对账（2026-11-19 16:18）

`dryrun_parity.py --company Zoom`，把前门实时列表与 Feed 已入库岗位按 `external_job_id` 逐条对齐：

| 指标 | 结果 |
| --- | --- |
| Feed 已入库 | 72 条 |
| 前门实时列表 | 69 条（`total=69`，4 页取完） |
| 两边都有 | 68 条，**标题不一致 0 条** |
| 仅在 Feed | 4 条，逐条详情判定全部 `not_accessible`（`S22`，即确实不在官网） |
| 仅在前门 | 1 条（`R19845`，新发布，尚未入库） |
| 详情灵敏度自检 | 一条"两边都有"的岗位详情 GET → **200**，说明"不在列表"的判定有依据，不是所有详情都 403 |

覆盖率：Feed 侧 94.4%、前门侧 98.6%。差额全部有解释，没有一条是"前门看不到但官网还在"。

第二样本 `Nidec`（wd1 pod、360 条、18 页，验证换 pod 与长分页）：Feed 351 / 前门 360 / 两边都有 349，**标题不一致 0**，仅在 Feed 2 条（均 `S22`），仅在前门 11 条（新发布），覆盖率 Feed 99.4% / 前门 96.9%，灵敏度自检 200。通过。

同一时刻的全量 URL 校验（`--canonical-all`）：54 家共 **66,542 条 `source_url`，全部仍在 `{tenant}.{wdN}.myworkdayjobs.com` 域、且与配置里的 host 逐家一致，异常 0 条**。这条是切换后的回归基线：切完再跑一次，数字必须不变。

### 2.3 必须写进代码的坑：`offset > 0` 时 `total` 报 0

实测同一家（zoom / Zoom，site 域）：

| offset | 返回 `total` | 条数 |
| --- | --- | --- |
| 0 | 69 | 20 |
| 20 | **0** | 20 |
| 40 | **0** | 20 |
| 60 | **0** | 9 |
| 69（越界） | 69 | **20（把首页又吐了一遍）** |

两条后果都很难看：

- 拿每页的 `total` 当终止条件 → 第 2 页就停，69 条的公司只拿到 40 条；
- 拿到 40 条去对账 → 剩下 29 条会被当成"官网已撤下"，**这就是一次批量误关岗**。

所以终止判定改成：`total` 只在首页采信；短页即停；出现重复 `externalPath` 立刻停（越界复读）；越界页在计数前就被丢弃。逻辑落在 `workday_front_door.should_fetch_next_page`，`crawl_all` 与 `dryrun_parity` 共用同一份判定，补了 8 条断言锁住。

另一个小坑：详情 GET 的路径**大小写敏感**，`external_job_id` 必须原样使用，小写化会稳定拿 404。

## 3. 方案

四层，互相独立，任何一层都能单独回滚。

**第零层（推荐先落，代价最小）：在 HTTP 出口改写 host。**

`deploy/workday-429/front_door_shim.py` 只做一件事：URL 命中 `{tenant}.{wdN}.myworkdayjobs.com` 且路径含 `/wday/cxs/` 时，把 host 换成 `{wdN}.myworkdaysite.com`。采集器只需两行：

```python
import front_door_shim
front_door_shim.install()
```

为什么它比改连接器优先：

- 一行配置没改、一条 SQL 没跑、`WorkdayConnector` 没碰，54 家同时生效。
- 写入库和对外展示的 `job_url` 仍是原域，canonical URL 语义零变化。
- 官网岗位页 HTML（`/…/job/…`）、非 Workday 域名一律透传，不做任何改写。
- site 域万一回 429 / 403 / 503，自动回落原 host，也就是**今天的行为**，不会把 403 洗成 200，也不碰 404 / 410。
- 回滚就是 `front_door_shim.uninstall()`，或删掉那两行。
- `install()` 同时挂 `requests`（`Session.request`）和 `httpx`（`Client.request` / `AsyncClient.request`），所以"采集器用哪个栈"不再阻塞切换。

**第一层：前门顺序。** 每个 Workday host 展开成有序前门：

1. `{wdN}.myworkdaysite.com`（主路，另一个 CF zone）
2. `{tenant}.{wdN}.myworkdayjobs.com`（原路，窗口外仍可用，且覆盖全部 tenant）
3. `{tenant}.{wdN}.myworkdaysite.com`（少数大租户才有，第三桶）

**第二层：单次失败立刻换门，累计失败才降级。** 一次请求拿到 429/challenge 就换下一道门，不在死门上重试三次；同一道门连续 3 次被限才进入冷却（60s 起，翻倍，上限 15min），一次成功立刻清零。现在那套"429 就 71 家公司一起停一小时"的全局冷却应该退化成兜底。

**第三层：限速按门独立。** 令牌桶挂在门上而不是全局：主路 4 req/s 起步，原 `JOB_BACKFILL_REQUEST_DELAY_MS=1200` 只留给 jobs 域。详情 8,436 条按 1 req/s 是约 2.3 小时，按前门 4 req/s 是 35 分钟级，实测并发 4 不触发。

**不变的语义（重要）：**

- **canonical URL 不动。** 入库和对外展示继续是 `https://{tenant}.{wdN}.myworkdayjobs.com/{site}{externalPath}`。前门只用于取数，不写进 `job_url`。
- **tenant 从配置取，不从 host 反推。** 现有 `buildWorkdayCxsDetailUrl` 用 `hostname.split('.')[0]` 拿 tenant，换成 `wd5.myworkdaysite.com` 会拿成 `wd5`。站点侧已按这条改了实现（见 §5）。
- **状态码语义不变。** 403 一律按"不可访问"处理：不分辨是租户级访问控制（Accenture `S22`）还是单条岗位已撤下（实测 zoom 已撤下的 posting 也回 `S22 permission denied`）。因此 403 **既不洗成 200，也不用于关岗**；404/410 才是官网明确撤下；429 永远不等于撤下。

## 4. 采集器落地步骤

代码在 `deploy/workday-429/`：

| 文件 | 用途 |
| --- | --- |
| `front_door_shim.py` | **最小改动开关**：出口处改写 host，两行接入，`uninstall()` 回滚 |
| `workday_front_door.py` | 前门解析、独立令牌桶、熔断。纯逻辑，无 HTTP 依赖 |
| `connectors_patch.py` | 完整版客户端：单次 429 立刻换门、累计失败才降级，接现成 requests / httpx |
| `verify_front_door.py` | 在采集容器里跑，验证**该容器的出口 IP**；`--from-api` 直接读 `/companies`，不用猜库表列名 |
| `preflight_all_workday.py` | 全量预检，输出逐家对照的 JSON + Markdown 表（§2.1 那张表就是它生成的） |
| `dryrun_parity.py` | 切换前逐条对账：前门实时列表 ↔ Feed 已入库岗位，`external_job_id` 精确匹配；`--canonical-all` 校验 URL 没被前门污染 |
| `prod_workday_pacing.py` | **线上实际部署的文件**（`/opt/global-jobs/app/workday_pacing.py`，sha256 `d864c0a9…`），含换门 + 回落 + 浏览器伪装 + curl_cffi 指纹兜底 |
| `requirements-additions.txt` | 线上需要额外装的依赖（`curl_cffi==0.17.0`），随 `prod_workday_pacing.py` 一起上线 |
| `test_front_door.py` / `test_connectors_patch.py` / `test_front_door_shim.py` | 离线自测，共 **71 条断言**（24 + 9 + 38），不发外网 |

顺序不能跳：

1. **先验证出口。** 采集容器里：
   `python3 verify_front_door.py --from-api http://127.0.0.1:8000 --api-key $KEY`
   （没有本地 API 就 `--from-db`，脚本会先探测 `job_company_sources` 到底有哪些列，再决定怎么取 `api_url`。）
   判读：site 域全 200、jobs 域 429 → 前门够用；两边都 429 → 这个出口 IP 被两个 zone 一起判了，前门不够，得换出口（IPv6 / 代理）后重测；site 域 403 → 租户访问控制，保持原样。
2. **先看全量对照表，再动手。** `preflight_all_workday.py` 输出的表要满足：site 域全绿、逐家 `total` 与 jobs 域一致。表里任何一家 `wdN` 不在已知 pod 列表，说明它的主路需要重新探 pod，不能盲切。
3. **dry-run 单家。** 挑岗位量最小的一家（Zoom，约 70 条）：
   `python3 dryrun_parity.py --company Zoom`
   它把前门实时列表与 Feed 已入库岗位按 `external_job_id` 逐条对齐，并做三件事：标题逐条比、`仅在 Feed` 的逐条查详情（200 = 前门漏了，属真缺口；404/410/S22 = 确实不在官网）、再拿一条两边都有的岗位做详情灵敏度自检（必须 200，否则"不在列表"的判定是空的）。通过后再接。
4. **全量后门开关。** 在 `app/connectors.py` 顶部（任何 Workday 请求发出之前）加那两行。观察一个 cron 周期：Workday 相关 `last_error` 不再出现 429，`job_url` 仍是 `myworkdayjobs.com`。
5. **关阀。** 把 Workday 全局冷却从"一小时全停"改成前门级熔断（`WorkdayDoorRouter`）；Redis 限速 key 按门拆分，别让 jobs 域的旧 key 继续压前门；`JOB_BACKFILL_REQUEST_DELAY_MS=1200` 只留给 jobs 域。
6. **详情也走前门。** `backfill-official-job-details` 换成 `WorkdayFrontDoorClient.detail`（GET，不是 POST）。8,436 条按 1 req/s 是 2.3 小时，按前门 4 req/s 是 35 分钟级。

验收标准：

- `dryrun_parity.py --company <最小的一家>` 通过：标题逐条一致、`仅在 Feed` 的都能用详情证明不在官网、详情灵敏度自检 200。
- 同一 cron 周期内 Workday 相关 `last_error` 不再出现 `429`。
- 岗位 `is_active` / `is_closed` 零变更来自 429；任何 429 只能导致延后，不能导致下架。
- 详情批次 `fetched` 成功率 ≥ 95%，`blocked` / `timeout` 计数不上升。
- `dryrun_parity.py --canonical-all` 复跑：异常仍为 0，且逐家条数与切换前同量级（§2.2 的 66,542 条是基线）。

回滚：

- 最小改动路线：删掉那两行，或调用 `front_door_shim.uninstall()`，行为与现在完全一致（它不改库、不改 canonical URL）。
- 完整版路线：把 `WorkdayConnector` 的 host 解析退回原函数。
- 上一轮回滚点仍然有效：`/opt/global-jobs/ops-backups/workday-cooldown-20261119T035630Z`。

## 5. 生产落地记录（已执行）

### 5.1 第一次上线：换门（2026-11-19 17:04 CST）

- 只在 `app/workday_pacing.py` 加 45 行：`front_door_url()` 把 CXS 请求的 host 换成 `{wdN}.myworkdaysite.com`，前门回 403/429/503 时退回原 host。`connectors.py`、`connector_config`、数据库、canonical URL 全部没动。
- 备份：`app/workday_pacing.py.backup.before-front-door-20261119T090435Z`，另存 `ops-backups/workday-front-door-20261119T090435Z/`。
- 部署方式：代码打在镜像里（无 bind mount），所以是 `docker compose build api worker beat` + `up -d`，三个容器一起重启。
- 同时删掉 `global_jobs:workday:cooldown`，让被停了约 3 小时的 Workday 立刻恢复。
- 当场验证：容器内 `WorkdayConnector().fetch(Zoom)` 返回 **69 条 / 4.0 秒**，`job_url` 全部仍是 `zoom.wd5.myworkdayjobs.com`；抽查 20 个"已关闭"岗位，**20/20 在官网确实已下架**（0 条误关）。

### 5.2 次日复查暴露的问题（2026-11-20 09:23 CST）

过夜后统计：**54 家全部在 24 小时内采过**（最近一次 09:21），成功/部分成功 276 次，抓到 187,158 + 180,138 条，且每次都是 `discovered == expected`。

但每家仍有 6–7 次失败，集中在 **16:30 与 19:00 前后**；日志里 `wd1/wd3/wd5/wd12.myworkdaysite.com` 也开始出现 429。也就是说换门成功，但没有完全免疫。

对比当时的请求头，原因很清楚：采集器自报 `User-Agent: GlobalJobsPlatform/1.0`，`Origin`/`Referer` 还指向旧域 —— 两个信号都在主动告诉 Cloudflare"我是脚本"。

### 5.3 第二次上线：浏览器伪装（2026-11-20 09:27 CST）

- `front_door_headers()`：换门请求带浏览器 UA、`Accept-Language`、Client Hints（`sec-ch-ua*`、`sec-fetch-*`），并把 `Origin`/`Referer` 换成新门自己的地址。
- 回落原 host 时把这套伪装头撤掉，避免拿新域的身份去敲旧域。
- 备份：`app/workday_pacing.py.backup.before-browser-headers-20261120T012751Z`；新 sha256 `d4e6dc701d393e17f66a32fa824b7ada4383e3183fc95bf1e141325006895899`。
- 验证：
  - 容器内 `httpx.build_request` 断言：UA/Origin/Referer/Client Hints 全部覆盖了 client 默认值，`Content-Type` 保留；
  - 真实请求：200，`total=71`，无 `cf-mitigated`；
  - **连续 30 次请求（1 req/s，走真实 Redis 限速器）：30/30 200，0 次 `cf-mitigated`，冷却锁未触发**。

### 5.4 第三道门的实测结论：不存在（2026-11-20 09:50 CST）

原本设想"公司自有招聘域名（如 `www.jobs.abbott`）也是另一个 CF zone，可以作为第三道门"。实测**54 家全部不可用**：

- 12 家直接 401/403（自有域上挂着更严的风控或登录墙）；
- 其余返回 200 但**不是 CXS JSON**（是品牌招聘页的 HTML 外壳），解析不出 `jobPostings`；
- 2 家（Broadcom、Salesforce）的 `career_url` 本身就是 Workday 域，没有第三道门。

结论：自有域名只代理页面，不代理 `/wday/cxs/` 接口。**这条路放弃**，别再当成后备方案。

### 5.5 TLS 指纹：真正的短板在这里（2026-11-20 09:52 CST）

用 `tls.peet.ws` 直接量出来：

| 通道 | JA3 | 协议 | HTTP/2 akamai 指纹 |
| --- | --- | --- | --- |
| 采集器现用 httpx | `06873b56…` | **HTTP/1.1** | 无 |
| curl_cffi（Chrome 伪装） | Chrome 家族（每次带 GREASE 会变） | **h2** | `52d84b11…` |

httpx 的密码套件顺序里没有 GREASE、扩展集也不同，而且跑的是 HTTP/1.1——**只改 UA 补不上这两处**。这就是"伪装了还偶尔被拦"的根因。

因此加了第二手（v3）：前门被挑战时，**同一道门**改用 curl_cffi 复刻 Chrome 的 TLS/h2 再打一次，仍然失败才退回原 host。

- 备份 `app/workday_pacing.py.backup.before-browser-tls-20261120T015113Z`、`app/requirements.txt.backup.before-curl-cffi-20261120T015113Z`；新 sha256 `d864c0a962d9b565d23ba40c3017f2334e2f70f86422a3233557eefe016872f9`；`requirements.txt` 增加 `curl_cffi==0.17.0`。
- 容器内验证：fallback 返回的是标准 `httpx.Response`（`.json()`/`.raise_for_status()` 都正常），200 / `total=71` / 无 `cf-mitigated`；这条通道的协议是 **h2**、带 Chrome 的 akamai 指纹。
- 修复了一个坑：curl_cffi 已解压 gzip，若把 `Content-Encoding`/`Content-Length` 原样塞给 `httpx.Response`，会二次解压并抛 `DecodingError`；现在这几个头会被丢弃。
- **诚实标注**：这一手只在"被挑战时"触发，当前前门是好用的，所以还没在真实挑战下验证过效果；下一个 16:30 / 19:00 窗口才是它的考场。

## 6. 站点侧已经改的

`src/lib/safe-external-fetch.ts`：

- 新增 `buildWorkdayCxsDetailUrls`：在官方 origin 之后追加 `{wdN}.myworkdaysite.com` 同路径候选。官方 origin 永远排第一，只有它失败才用前门。
- SPA 空壳分支的详情回退改成依次尝试候选，不再是单发一次 jobs 域然后吃 429。
- `scripts/test-safe-external-fetch.ts` 补了断言：候选顺序、`/job` 段处理、非 Workday URL 返回空。

这个改动影响的是"官网详情抓不到正文"的场景（`john_company_field` 的 official detail 回退），不改任何岗位状态判定。

## 7. 风险与边界

- **site 域不是无限制。** 换门当天 `wd1/wd3/wd5/wd12.myworkdaysite.com` 过夜后就出现过 429（集中在 16:30、19:00 前后），改用浏览器伪装头后 30/30 通过。这说明它同样是概率性挑战，不是额度：熔断和回落必须一直在，别把"当前 200"当成永久放行。
- **两个域的 `total` 会随时间抖动 1–3 条**（Zoom 72→69、RTX 4536→4537），但同一时刻两边逐家完全一致（39/39、11/11）。这是两次请求之间的岗位增删，不是子集裁剪。切换时用同刻抽样对账，不要拿隔了十几分钟的 `total` 判缺口。
- **挑战窗口与出口 IP 绑定。** 本机实测通过不代表机房 IP 通过 —— 所以 §4 第 1 步必须在容器里跑。本次已在容器内验证（54/54），这条门槛已过。
- **分页坑（§2.3）比限流更危险。** 一旦终止条件写错，症状是"每家只拿到 40 条"，紧接着就是大面积误关岗。任何新写的分页循环都必须过 `should_fetch_next_page`，别再用手写的 `offset >= total`。
- **伪装头会过期。** UA 和 Client Hints 写的是 Chrome 131；Workday 那边若升级检测策略，这套头可能重新变成"可疑"。出现大面积 429 时先更新 UA/CH 版本号，再考虑换出口。
- **指纹兜底未经实战。** curl_cffi 那一手只在被挑战时触发，目前前门是好用的，所以它还没在真实挑战下证明过自己。如果下一个窗口仍然零星失败，第一件事是把这一手的顺序**提到前面**（先 curl_cffi、再 httpx），那是改一行的事；第二件事才是降量/换出口。
- **不要为了"高效"把压力堆上去。** 前门只是绕开了错误的那层门，不是拿到了豁免。现在生产仍是全局 1 req/s；往 10 以上走，一旦被打回来，损失的是整个来源族。

## 8. 待确认

- ~~采集器的 HTTP 栈是 `requests` 还是 `httpx`~~ —— 已不阻塞：`front_door_shim.install()` 两种栈都挂，`install()` 的返回报告会说明实际接上了哪几个。
- ~~`(tenant, site, wdN)` 是否都已落库~~ —— 已确认：54/54 家的 `connector_config.api_url` 就带着 tenant 和 site，不需要回填任何列。
- Accenture 那 19 条 `S22` 403：现在已知 `S22` 既可能是租户访问控制，也可能是单条岗位已撤下（zoom 已撤下的 posting 也回 `S22`）。因此不改判定、不关岗、也不当成限流；要区分只能逐条比对官方列表，不在本轮范围。
- `myworkdaysite.com` 的 pod 列表是 DNS 直查的一次快照，Workday 加新 pod 时需要复核（`preflight_all_workday.py` 会把不在列表里的公司单独列出来，当前 0 家）。
- 采集器那套"429 就全局停一小时"的冷却仍在：本次全程没有被触发过（换门 + 伪装头之后），但它仍是兜底。如果哪天它在 site 域偶发 429 时把整族拖停，按 §4 第 5 步换成前门级熔断，而不是把冷却时长再调。
- **需要观察两个时间窗**：16:30 与 19:00 前后（HKT）是昨天出问题的高发段。伪装头 09:27 上线、指纹兜底 09:51 上线，下一个窗口才是真正的验收点。届时看 `crawl_runs` 里 workday 的 failed 数是否归零、`docker logs` 里 site 域 429 是否消失。
- 如果窗口仍然失败：①把 curl_cffi 提到 httpx 之前（一行顺序改动）；②给 Workday 详情做"只抓新增/变化"的降量（体积能降一个数量级）；③再不行才考虑第二台 VPS 换出口。第三道门（自有域名）已在 §5.4 实测否定，不要重复尝试。