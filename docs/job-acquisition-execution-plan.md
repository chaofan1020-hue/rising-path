# 海外岗位采集规模化 · 精确执行计划（AI 连续执行版）

更新时间：2026-11-24
状态：待执行（本文件不改生产；每一步都要求 dry-run、验收、可回滚）
配套文件：

- [`job-acquisition-scaleup-project-plan.md`](job-acquisition-scaleup-project-plan.md)：为什么做、路线取舍、成本与风险
- [`job-acquisition-tasks.yaml`](job-acquisition-tasks.yaml)：机器可读任务图（AI 从这里取任务）
- [`job-acquisition-progress.md`](job-acquisition-progress.md)：执行账本（AI 每完成一步必须更新）

适用范围：

- 美国站：本仓库（Next.js + Supabase），生产目录 `/opt/liorvix`
- 上游采集器：`/opt/global-jobs`（FastAPI + Celery + Postgres + Redis），公网 `hfscareer.com/collector-api`

---

## 0. 执行协议（先读这一节，再动任何代码）

### 0.1 角色

| 角色 | 职责 |
|---|---|
| 执行 AI | 按 `tasks.yaml` 取任务、写代码、跑验收、更新账本；一次只做一个任务 |
| 人类（你） | 只在 4 个 Gate 拍板；处理 AI 标记 `blocked` 的事 |
| 生产 | Gate 前只允许 dry-run / staging；Gate 后才允许写生产 |

### 0.2 单任务循环（每一步都按这个走）

1. **取任务**：在 `tasks.yaml` 里找第一个 `status=pending`、依赖全 `done`、所在 Gate 已开的任务。
2. **预检**：读本文件对应小节；`git status` 必须干净；确认当前环境（本地/上游/staging/生产）。
3. **最小改动**：只改任务列出的文件；不顺手重构；不跨任务合并提交。
4. **跑验收**：执行任务里的“验收命令”；全部通过才算完成。
5. **提交**：一个任务一个 commit，消息 `feat(jobs): <task-id> <一句话>`。
6. **记账**：更新 `job-acquisition-progress.md`：状态、commit、时间、关键指标、备注。
7. **失败处理**：同一验收最多重试 2 次；仍失败 → 标 `blocked`，写清原始报错与已尝试方案，跳到下一个无依赖任务。

### 0.3 状态机

`pending → in_progress → done`；失败分支 `in_progress → blocked → in_progress`（人类解除后）。
任何任务不得直接 `pending → done`。

### 0.4 硬护栏（违反即回滚）

1. 不抓 LinkedIn / Indeed / Glassdoor；不登录、不绕验证码、不用个人 Cookie。
2. 不因为解析失败、403/429、超时改变岗位上下架。
3. 不在 Gate 前写生产；所有写操作先 `--dry-run`。
4. 不动主 Feed 游标、不清 `job_sync_state`、不重置 `jobs`。
5. 不猜薪资、截止日期、经验；没有官方证据就留空。
6. 不把密钥、密码、Cookie、完整响应体写进仓库或日志。
7. 不 `git push --force`、不 rebase 共享分支、不删生产数据。
8. 单任务 diff 超过 400 行时，先拆任务，不硬写。

### 给执行 AI 的启动指令（直接复制）

```text
你是 Liorvix 岗位采集项目的执行 AI。工作目录：本仓库；上游在 /opt/global-jobs；
美国站在本仓库，生产目录 /opt/liorvix。

每轮严格按以下顺序：
1. 读 docs/job-acquisition-execution-plan.md 的 §0 和当前任务小节；
2. 读 docs/job-acquisition-progress.md 的环境、Gate、阻塞项；
3. 从 docs/job-acquisition-tasks.yaml 取第一个 status=pending、依赖全 done、
   所在 Gate 已开的任务；
4. 只改该任务列出的文件；先 dry-run；跑该任务的验收命令；
5. 通过后一个 commit，更新 progress 的状态/commit/指标；
6. 失败最多重试 2 次，仍失败标 blocked 并换下一个无依赖任务；
7. 到 Gate 立即停止，等人类开 Gate；不要自己开 Gate。

禁止：跳步、合并任务、Gate 前写生产、动 Feed 游标、抓 LinkedIn/Indeed、
因解析失败关岗、猜薪资/截止日期、把密钥写进日志。
```

---

## 0.5 四个 Gate（只有人类能开）

| Gate | 位置 | 开门条件 | 开门后允许 |
|---|---|---|---|
| G1 | V01 之后 | 50 board canary：0 误关、P95 ≤60 min、抽样 20 条 URL 可回链 | 写生产 500 board |
| G2 | V02 之后 | 500 board 观察 48h：成功率 ≥98%、重复 <0.5%、stale 正常 | 扩到 1,500 + Feed v2 生产 |
| G3 | V03 之后 | 1,500 board：P95 ≤30 min、成功率 ≥99%、误关 <0.2% | 扩到 3,000 + 新适配器 |
| G4 | V04 之后 | 3,000 board：成功率 ≥99%、误关 <0.2%、三家长尾各 ≥100 board | 扩到 6,000 |

---

## 1. 现状事实（这些会直接决定步骤，不是背景介绍）

| 事实 | 位置/证据 | 对计划的影响 |
|---|---|---|
| 上游 `crawl_all` 每 6 小时跑一次，按公司串行排队 | `app/tasks.py` `cron(0 */6)` | 当前新鲜度天花板约 6h；必须新增按 board 的独立调度，不能复用 `crawl_all` |
| 上游已有 Greenhouse/Lever/Ashby/SmartRecruiters 连接器 | `app/connectors.py` `CONNECTORS` | P0 不写新解析器，复用现有类，只加“按 board 轮询”的壳 |
| 上游 `CompanySource` = 公司 + 来源，一家公司可多 source | `app/tasks.py`、`app/models.py` | 批量 board 必须有独立表，否则 6,000 家会把公司轮换拖死 |
| 上游已有 `source_discovery.py` | `app/source_discovery.py` | 单公司发现可复用；批量 token 发现另做离线工具 |
| Feed 端点 `/integrations/v1/jobs`，`limit` 最大 500，参数 `cursor/since/include_closed/company_id` | `src/lib/jobs-feed.ts` | 现有游标可继续用；v2 只加字段与 `source_key`，不换协议 |
| 美国站 `normalizeFeedItem` 要求 title/company/source_url，按 location 过滤目标地区 | `src/lib/jobs-feed.ts:490` | 公司名解析不出来就不能入库；地区不合格直接丢 |
| `direction` 由 `job_function/department/title` 推断，兜底是 `Finance` | `src/lib/jobs-feed.ts:440` | 批量岗位必须带可靠 `job_function`，否则护士/销售会被算成金融 |
| `audience` 固定“留学生”，`region/direction/audience` NOT NULL | `src/lib/jobs-feed.ts:614` | 不需要放宽约束，不要在这上面做迁移 |
| 美国站已有 GH/Ashby/Lever 官方连接器（字段回填用） | `src/lib/job-connectors/` | 可复用解析规则做对照测试，但主数据仍走 Feed |
| 美国站 `jobs` 还没有 `source_key/display_status/last_seen_at` | 最新迁移 `0139` | 下一条迁移固定为 `0140_job_board_ingestion.sql` |
| 公开岗位列表只看 `is_active`，不区分来源 | `src/app/api/jobs/route.ts` | 扩量前必须加 `display_status` 过滤，否则 ats:* 旧行可能重复展示 |
| `open-ats-feed` 有 18,164 board 的 CSV，读取日 2026-09-03 | `https://veresk06.github.io/open-ats-feed/data/all.csv` | 可直接当候选池，但必须重新探测；P0 优先 `engineering.csv` |
| 6 类 ATS 中 Personio / SmartRecruiters 被公开审计拒绝 | open-ats-feed 审计 | P0/P1 不接；不要用“robots 只是给爬虫看的”自我说服 |
| 美国站 Feed worker 默认每 **10 分钟**跑一次增量 | `src/lib/job-background-worker.ts` | 端到端延迟 = 上游轮询 + 最多 10 分钟；Tier S 要把它调到 5 分钟 |

### 1.1 端到端新鲜度预算

“新岗位发布 → 用户可见”由五段组成，任何一段都能单独优化：

| 段 | 现状 | P0 目标 | 手段 |
|---|---|---|---|
| 上游发现 | `crawl_all` 每 6h | Tier S 5-10 min；A 15-20 min（为达 P95，取定义上限 30 的下沿） | U04 按 board 调度，不再等公司轮换 |
| 抓取+解析 | 一次 HTTP + JSON 解析，秒级 | 同左 | ETag/浅轮询，只拉变化 |
| 上游落库 | 批量 upsert，<1s | 同左 | 批量写、失败隔离 |
| Feed 等待 | 默认 10 min | 5 min（S/A） | `JOBS_SYNC_INTERVAL_MINUTES=5` |
| 美国站 upsert + 展示 | 500/页，秒级；`listed` 立即可见 | 同左 | 列表级先上，详情异步 |

**结论**：改造后 Tier S 最坏约 `10 + 5 + 1 = 16 分钟`，Tier A 约 `20 + 5 + 1 = 26 分钟`；按岗位量加权 P95 可以做到 ≤30 分钟（前提是 90% 新增岗位落在 S/A）。

**为什么不做“6,000 家全部 1 分钟”**：6,000 × 1,440 = **864 万请求/天**，超过任何 ATS 的合理配额，也违反 Crawl-delay；Ashby 自身 `Cache-Control: max-age=60`，快于 1 分钟没有意义。1 分钟级只对 50-100 家最核心公司有意义，且要用单独通道。

**“不漏、不重复”的三条规则**：

1. 以“完整列表的 ID 集合差”判新增，不用发布时间猜；GH/Ashby/Lever 的列表只含在招岗位。
2. `first_seen_at` 取最早值；岗位短暂消失又出现，不重复算“新岗”，不重复提醒。
3. 同一岗位多 board/换 URL：按 `(vendor, external_id)` 优先、URL/内容哈希兜底，避免重复展示。

**可选加速（P1 以后）**：上游插入新岗位时发一个 `jobs.new` 事件（Redis Stream），美国站消费后立即触发一次增量同步；只用于“提醒/首屏加速”，数据仍以 Feed 为准，事件带幂等 ID，不能绕过游标。

---

## 2. 依赖图与关键路径

```text
B01 ─┬─ B02 ─┐
     └─ B03 ─┴─ D01 → D02 → D03 → D04 → D05 → D06
                                              │
U01 → U02 ────────────────────────────────────┘
        │
        └→ U03 ─┬→ U04 ─────────────┐
                └→ U05 → U06 ───────┴→ U07

S01 → S02 → S03 → S04
B02 → S05（只读，可并行）

U07 + S04 + D06 ─→ V01 → [G1] → V02 → [G2] → D07
                                              │
U08 → U09 → U10 ──────────────────────────────┼→ V03 → [G3]
S06 → S07 ────────────────────────────────────┘

U11/U12/U13 → U14 → S08 → S09 → V04 → [G4]
D08 → U15 → U16 → S10 → V05（最终验收）
```

**关键路径**：`D03 → D05 → U02 → U03 → U04 → U07 → V01 → G1`。
D03（探测工具）晚一天，P0 就晚一天；其余任务可并行但不要抢在两个后端之前。

---

## 3. 日历（按周，AI 可连续跑，Gate 会停）

| 周 | 主任务 | 周末必须达到 |
|---|---|---|
| W1 | B01-B03、D01-D06、U01-U02、S01 | 500 个候选 board 有证据；`ats_boards` 表可写；迁移 0140 在 staging 通过 |
| W2 | U03-U07、S02-S05、V01-V02 | 50 board canary 通过；500 board 生产可写；G1/G2 |
| W3-W4 | D07、U08-U10、S06-S07、V03 | 1,500 board、8 万岗位、P95 ≤30 min（G3 前） |
| W5-W6 | U11-U14、S08-S09、V04 | 3,000 board、18 万岗位、三家长尾适配器上线 |
| W7-W8 | D08、U15-U16、S10、V05 | 6,000 board、25 万岗位、成本达标 |
| W9+ | O01-O03 | 每周发现、每月新 ATS、季度审计 |

> 如果只有 1 名后端：W1-W2 保留，W3 之后顺延 2 周；D 系列可交给数据/运维。

---

## 4. Phase 0：基线（B01-B03，约 1 天）

### B01 · 冻结环境与访问

**位置** 双端 · **依赖** — · **估时** 2h · **Gate** —

1. 确认能进上游和美国站；记录两端 `git rev-parse HEAD`、`docker compose ps`、当前镜像 tag。
2. 确认上游迁移机制：`ls /opt/global-jobs | grep -i alembic`；有 `alembic.ini` 用 Alembic，没有就沿用仓库现有 SQL 迁移方式，**不要引入第二套**。
3. 备份：上游 `app/connectors.py`、`app/tasks.py`、`app/models.py`，带 UTC 时间戳到 `/opt/global-jobs/ops-backups/`；美国站记录当前 Supabase 备份时间点。
4. 不打印密码/密钥；使用现有 SSH/部署方式。

**验收**：`docs/job-acquisition-progress.md` 的“环境”表填好两端 commit、镜像 tag、备份路径、迁移机制。

**回滚**：无（只读）。

### B02 · 生产基线

**位置** 美国站 + 上游 · **依赖** B01 · **估时** 3h · **Gate** —

跑以下基线并保存到 `tmp/baseline-<date>.json`：

```bash
pnpm audit:p0-feed
pnpm check:jobs-feed
pnpm audit:company-configuration
pnpm audit:company-source-matrix
```

```sql
-- 美国站：来源分布、活跃量、重复 URL
select source_system, is_active, count(*) from public.jobs group by 1,2 order by 3 desc;
select count(*) from (
  select company, lower(regexp_replace(coalesce(job_url,''), '[?#].*$', '')) u
  from public.jobs where is_active
  group by 1,2 having count(*) > 1
) d;
```

上游：`GET /collector-api/dashboard/company-directory`、`/dashboard/recent-runs`；记录公司数、open_jobs、last_ok、失败公司。

**验收**：基线里至少包含：当前活跃岗位、来源分布、重复 URL 数、Feed 延迟、最近 24h 新增/关闭、上游公司数。后续所有“提升”都相对这份基线。

**回滚**：无。

### B03 · 开关、分支与账本

**位置** 双端 · **依赖** B01 · **估时** 2h · **Gate** —

1. 预定义开关（默认全关）：
   - 上游：`BULK_BOARDS_ENABLED=false`、`BULK_BOARD_WRITE=false`、`BULK_MAX_ACTIVE_BOARDS=50`
   - 美国站：`JOBS_FEED_V2_ENABLED=false`、`JOB_TTL_ENABLED=false`
2. 分支约定：`feat/bulk-<task-id>`；一个任务一个 PR/commit；上游改动必须带 `.backup.before-<task>-<ts>`。
3. 回滚约定：保留上一版镜像 tag；迁移必须能 down；回滚不重置 Feed 游标。
4. 初始化 `docs/job-acquisition-progress.md`（模板已给），把 B01/B02 结果填进去。

**验收**：开关名、分支名、回滚命令写进 progress 的“约定”一节；任一开发者能照着回滚。

**回滚**：无。

---

## 5. Phase 1：发现 500 个 board（D01-D06，约 3 天）

### D01 · 下载候选语料

**位置** 本仓库（离线） · **依赖** B03 · **估时** 1h · **Gate** —

```bash
mkdir -p tmp/boards
curl -L -o tmp/boards/all.csv          https://veresk06.github.io/open-ats-feed/data/all.csv
curl -L -o tmp/boards/engineering.csv  https://veresk06.github.io/open-ats-feed/data/engineering.csv
curl -L -o tmp/boards/data-quality.csv https://veresk06.github.io/open-ats-feed/data/data-quality.csv
curl -L -o tmp/boards/board-roles.csv  https://veresk06.github.io/open-ats-feed/data/board-roles.csv
```

校验：`all.csv` 数据行 18,164；`engineering.csv` 500；记录 sha256。这些是 2026-09-03 的读数，只当候选，不当当前岗位数。

**验收**：行数、sha256、下载时间写入 progress；`tmp/boards/` 不提交（已在 `.gitignore` 则确认）。

**回滚**：删文件。

### D02 · 生成候选池

**位置** 本仓库 · **依赖** D01 · **估时** 2h · **Gate** —

规则：

1. 现有 169 家上游公司的 token **先排除**：它们已有公司级管道，P0 不重复摄入，避免一次岗位两条记录。
2. 优先 `engineering.csv` 500 个；再取 `all.csv` 中 GH/Ashby/Lever 按岗位数前 1,000。
3. 排除 `data-quality.csv` 标记为“招聘广告/非真实雇主”的 board。
4. 去重键 `(provider, token)`；输出 `tmp/boards/candidates.csv`，列：`priority,vendor,token,board_url,api_url,source_list,posted_count,note`。

**验收**：候选 1,200-1,500 个；500 个 engineering 全在；现有 169 家 token 不在列表；输出文件可被 D03 直接读取。

**回滚**：重跑脚本。

### D03 · 探测工具（本阶段最关键的代码）

**位置** 本仓库 · **依赖** D02 · **估时** 8h · **Gate** —

新增：

- `src/lib/ats-discovery/robots.ts`：解析 robots，按 RFC 9309 做最长匹配；记录证据 URL、抓取时间、原文 sha256。
- `src/lib/ats-discovery/providers.ts`：三家端点与字段映射；GH `boards-api.../jobs?content=false&per_page=1`，Ashby `posting-api/job-board/{token}`，Lever `api.lever.co/v0/postings/{token}?mode=json`。
- `scripts/ats-discovery/probe.ts`：并发/限速/重试/断点续跑；输出 `probe-results.jsonl`。

硬性要求：

1. 限速：GH 5 req/s、Ashby 2 req/s、Lever 1 req/s（遵守 Crawl-delay）；全局并发 ≤8。
2. UA 真实可联系；429/5xx 指数退避，最多 2 次；超时 20s。
3. 每个 board 必须产出：HTTP 状态、岗位数、5 条样本（id/title/url/location）、是否有目标地区岗位、robots 结论、错误原因。
4. 不做：不登录、不绕验证码、不跟随到非官方 host。
5. 已知拒绝名单直接 `quarantined`：Personio、SmartRecruiters；Workable 仅标记“限流风险”。

**命令**：

```bash
pnpm tsx scripts/ats-discovery/probe.ts --input=tmp/boards/candidates.csv --output=tmp/boards/probe-results.jsonl --limit=1000 --concurrency=8
```

**验收**：`pnpm test:ats-discovery` 通过（robots allow/disallow/404、三家 JSON fixture、空 board、429 退避）；Stripe/OpenAI/Palantir 三个真实 board 探测成功。

**回滚**：新增文件，直接删分支。

### D04 · 跑 1,000 个候选

**位置** 本仓库 · **依赖** D03 · **估时** 4h · **Gate** —

跑 D03；目标：≥500 个 active（有 ≥1 个目标地区岗位），错误率 <10%，每个 active 有 robots 证据。

输出 `active.csv`、`quarantine.csv`（含原因分布）。

**验收**：active ≥500；`quarantine` 原因可解释（空 board/404/robots/无目标地区/非 JSON）；断点续跑不重复请求已成功项。

**回滚**：重跑，覆盖输出。

### D05 · 公司名与域名解析

**位置** 本仓库 · **依赖** D04 · **估时** 4h · **Gate** —

1. 从 board URL 取域名；抓 careers 页 `<title>`、`meta og:site_name`、JSON-LD `hiringOrganization.name`。抓 HTML 前也要检查该路径的 robots；disallow 就不抓，只用 token 兜底并标 `low`。
2. 规范化：去掉 `Careers`、`Jobs`、`Hiring`、`|` 后缀；token 转可读名只作兜底，置信度标 `low`。
3. 人工覆盖表 `data/board-company-overrides.csv`（token, company_name, domain, note），优先于自动结果。
4. 拒绝：`Careers`、`Jobs`、`Apply` 等泛词；staffing/recruiting 关键词默认 quarantine，除非人工确认。

**验收**：active 中 ≥95% 有 company_name + domain；随机 20 条人工核对，错误 ≤2 条。

**回滚**：覆盖表可删；自动结果可重跑。

### D06 · 抽样复核并冻结 500

**位置** 本仓库 · **依赖** D05 · **估时** 3h · **Gate** —

按 vendor 分层抽 50 条，逐条检查：官网能打开、岗位数>0、岗位 URL 是官方 host、地点在目标地区、公司名不是 token。

冻结 `data/p0-boards.csv`（500 行），列：`vendor,token,site,company_name,company_domain,careers_url,region_scope,robots_verdict,robots_evidence_url,robots_checked_at,confidence,tier,note`。

**验收**：500 行无重复 `(vendor,token)`；错误率 ≤15%（超过则回 D03 修解析）；文件提交到仓库（不含岗位数据）。

**回滚**：重新冻结。

---

## 6. Phase 1：上游批量管道（U01-U07，约 5 天）

### U01 · `ats_boards` 模型与迁移

**位置** 上游 · **依赖** B01 · **估时** 6h · **Gate** —

先读 `app/models.py`、迁移目录，确认 `Job/Company` 外键与现有迁移方式。新增：

- `ats_boards`：`id, vendor, token, site, company_id(nullable), company_name, company_domain, careers_url, region_scope, robots_verdict, robots_evidence_url, robots_checked_at, status(candidate/active/paused/quarantined), confidence, posting_count, tier(S/A/B/C), poll_interval_seconds, next_poll_at, consecutive_failures, last_ok_at, last_error, created_at, updated_at`；唯一索引 `(vendor, token)`。
- `board_poll_runs`：`id, board_id, started_at, finished_at, status, http_status, jobs_seen, jobs_new, jobs_changed, error, duration_ms`。
- 给现有 `jobs` 加列（P0 需要）：`source_key varchar(120)`、`first_seen_at timestamptz`、`last_seen_at timestamptz`、`last_snapshot_id text`、`missing_streak int not null default 0`；索引 `(source_key, updated_at)`、`(last_seen_at)`。

**验收**：staging 上迁移 up/down 成功；`\d ats_boards`、`\d jobs` 字段齐全；现有表数据无改动；`crawl_all` 的查询仍只选 `Company.is_active=true`。

**回滚**：迁移 down；生产未执行。

### U02 · CSV 导入器

**位置** 上游 · **依赖** U01、D06 · **估时** 5h · **Gate** —

新增 `app/bulk_boards.py`：

```bash
docker compose cp data/p0-boards.csv api:/tmp/p0-boards.csv
docker compose exec -T api python -m app.bulk_boards import --csv /tmp/p0-boards.csv --dry-run
```

规则：按 `(vendor, token)` upsert；`company_id` 先按域名/规范化公司名匹配现有 `Company`；匹配不到就**新建 `Company` 并设 `is_active=false`、`industry='Bulk ATS'`**，这样现有 `crawl_all`（只选 `is_active=true`）不会把它排进 6 小时轮换；`ats_boards.company_id` 指向它。`robots_verdict != allow` 一律 `quarantined`；dry-run 只打印将插入/更新/跳过，以及将新建多少公司。

**验收**：dry-run 500 条、0 错误、新建公司数 ≤500；重复执行 0 新增；`--apply` 先只写 50 条到 staging；`crawl_all` 待抓公司数不变；50 家新公司全部 `is_active=false`。

**回滚**：按 batch id 删除新行；不影响现有公司。

### U03 · 单 board 抓取

**位置** 上游 · **依赖** U02 · **估时** 8h · **Gate** —

新增 `poll_ats_board(board_id)`：

1. `get_connector(vendor)` 复用现有类，config 传 `board_token(s)` / `site`。
2. 写入既有 `Job` 路径：`company_id` 必须已解析（为空 → 该 board `quarantined`，不写岗位）；`external_job_id` 保留原始 ID；`source_key` 写 `vendor:token`；`first_seen_at` 首次写入。
3. 不关岗：P0 只 upsert 与更新，不产生任何 `is_closed`。
4. 解析失败/空列表：只写 `board_poll_runs` 与 `last_error`，不改岗位。
5. 幂等：同一 board 连跑两次，第二次 `jobs_new=0`。

**验收**：Stripe board 抓取 500+ 岗位；改坏 JSON fixture 时岗位数不变；重复跑幂等；`source_key` 全部写入。

**回滚**：删任务与代码；岗位按 `source_key` 批次删除（先导出）。

### U04 · 批量调度器

**位置** 上游 · **依赖** U03 · **估时** 8h · **Gate** —

新增 Celery 任务 `poll_due_boards`（beat 每分钟）：

- 选 `status=active and next_poll_at<=now()`，按 `tier` 排序，单批 ≤200。
- 每 board 一个 Redis 锁（`bulk:board:{id}`，TTL 10 分钟），避免重入。
- 每 vendor 一个令牌桶（GH 5/s、Ashby 2/s、Lever 1/s），Redis 计数。
- 成功：`poll_interval` 回 tier 基准；失败：5m→15m→1h→6h 退避，连续 5 次 `paused` 并告警。
- 与现有 `crawl_all` 完全隔离：不修改其 schedule。

**验收**：50 board 在 10 分钟内被调度一次；无重复并发；单 board 429 不影响其他；`crawl_all` 时间表未变。

**回滚**：停 beat 任务；恢复 schedule；保留表。

### U05 · 心跳与 TTL 数据

**位置** 上游 · **依赖** U03 · **估时** 4h · **Gate** —

1. 完整列表成功后，批量更新在列岗位的 `last_seen_at`；**按天去重**：只有日期变化才更新并进入 Feed 增量，避免每次轮询都产生 25 万条变更。
2. 不在列的岗位：`missing_streak += 1`，不关岗。
3. 新增 `last_snapshot_id`，供 Feed 的 `snapshot_id` 使用。
4. 不修改 `updated_at`/Feed 版本，除非内容变化。

**验收**：24h 模拟后，Feed 增量里心跳条数 ≤ 活跃岗位数/天；`is_closed` 无变化；stale 计算所需字段齐全。

**回滚**：停任务；字段保留。

### U06 · Feed v2 序列化

**位置** 上游 · **依赖** U03、U05 · **估时** 6h · **Gate** —

新增字段（不换端点）：

```json
{
  "source_key": "greenhouse:stripe",
  "external_job_id": "greenhouse:stripe:7891234",
  "source_updated_at": "2026-11-24T06:12:00Z",
  "first_seen_at": "2026-11-24T06:15:00Z",
  "last_seen_at": "2026-11-24T06:15:00Z",
  "snapshot_id": "stripe-2026-11-24T06:00:00Z",
  "source_tier": "A",
  "is_list_only": false
}
```

规则：

- 老岗位没有 `source_key` 时保持 null，不伪造；但 `last_seen_at` 仍要发（按天去重），让美国站 TTL 对老数据也生效。
- `external_job_id` 只在这里加前缀；数据库内保留原始 ID。
- 新增查询参数 `source_key`（可重复）；`since` 语义写成文档；`contract_version=2`。
- 分页/游标/失败隔离逻辑不变。

**验收**：20 条 canary 符合 schema；`source_key` 过滤只返回该 board；美国站 dry-run 能解析；现有 feed 测试全过。

**回滚**：保留 v1 序列化开关 `FEED_V2_ENABLED=false`。

### U07 · 部署、健康接口与 50 board dry-run

**位置** 上游 · **依赖** U04、U06 · **估时** 5h · **Gate** —

1. `docker compose build api worker beat && docker compose up -d api worker beat`；迁移；保留上一版镜像 tag。
2. 新增 `/collector-api/dashboard/board-health`：board、vendor、tier、last_ok、posting_count、last_error、next_poll、成功率。
3. 开 `BULK_BOARDS_ENABLED=true`、`BULK_BOARD_WRITE=false`，跑 50 board；检查 `board_poll_runs` 与日志。
4. 不写生产岗位，直到 G1。

**验收**：50 board 全部有 run 记录；health 接口返回 50 行；`BULK_BOARD_WRITE=false` 时 `jobs` 无新增；回滚镜像可用。

**回滚**：`docker compose` 切回上一 tag；关开关。

---

## 7. Phase 1：美国站改造（S01-S05，约 4 天）

### S01 · 迁移 0140 + 回填

**位置** 本仓库 · **依赖** B01 · **估时** 4h · **Gate** —

新增 `supabase/migrations/0140_job_board_ingestion.sql`：

```sql
alter table public.jobs
  add column if not exists source_key varchar(120),
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists detail_fetched_at timestamptz,
  add column if not exists display_status varchar(20) not null default 'listed',
  add column if not exists source_tier char(1) not null default 'B',
  add column if not exists dedupe_group_id text;

create index if not exists jobs_last_seen_active_idx
  on public.jobs(last_seen_at) where is_active = true;
create index if not exists jobs_dedupe_group_idx
  on public.jobs(dedupe_group_id) where dedupe_group_id is not null;
create index if not exists jobs_source_key_idx
  on public.jobs(source_key) where source_key is not null;
```

回填（dry-run 后执行）：

- 有正文/字段证据的 `collector_feed` → `display_status='enriched'`。
- 只有列表字段的 → `listed`。
- **防误 stale**：迁移时把所有 `is_active=true` 的岗位 `last_seen_at` 设为 `now()`（不要用几个月前的 `updated_at`），第一次全量 v2 同步后再由真实 `last_seen_at` 覆盖；TTL 开关等首次全量同步完成后再开。
- 不改 `is_active/is_closed`。

**验收**：staging up/down 成功；回填前后 `is_active` 计数一致；回填脚本可重复执行。

**回滚**：迁移 down；回填只改新列，可直接重置为默认值。

### S02 · Feed v2 客户端

**位置** 本仓库 · **依赖** S01 · **估时** 6h · **Gate** —

改 `src/lib/jobs-feed.ts`、`src/lib/job-sync.ts`：

1. 扩展 `JobsFeedItem`：`source_key/source_updated_at/first_seen_at/last_seen_at/snapshot_id/source_tier/is_list_only`。
2. `normalizeFeedItem` 透传新字段；`display_status` 新岗位写 `listed`；`is_list_only=true` 时正文留空。
3. upsert 时保留已有 `first_seen_at`（取最早）、更新 `last_seen_at`。
4. 身份冲突：按 external ID 命中优先；URL 命中但来源不同，保留原 `source_system` 与原 `external_job_id`，只补字段，记 `identity_conflict`，不强行改身份。
5. `JOBS_FEED_V2_ENABLED=false` 时行为与现在完全一致。

**验收**：`pnpm test:jobs-feed-v2`（新增）通过；20 条 canary 字段齐全；现有 `pnpm test:jobs-feed-location`、`pnpm check:jobs-feed` 通过。

**回滚**：开关关；迁移列保留。

### S03 · TTL / stale worker

**位置** 本仓库 · **依赖** S02、U05 · **估时** 4h · **Gate** —

新增 `src/lib/job-ttl-worker.ts` + 脚本 `scripts/maintain-job-ttl.ts`：

- S/A：`last_seen_at < now()-24h`；B/C：`now()-7d` → `display_status='stale'`。
- 只改 `display_status`；**绝不写 `is_closed`**。
- `manual_hold` / 有 `valid_through` 未到期的岗位不自动 stale（人工/官方证据优先）。
- 每批 5,000，可 dry-run，记录数量。

**验收**：模拟 23h/25h/8d 三条数据，结果分别为 listed/stale/stale；`is_closed` 不变；dry-run 不写库。

**回滚**：`JOB_TTL_ENABLED=false`；把 stale 批量改回 listed（按 run id）。

### S04 · 列表与详情展示过滤

**位置** 本仓库 · **依赖** S03 · **估时** 3h · **Gate** —

- `/api/jobs` 默认加 `display_status in ('listed','enriched')`；`status=all`（管理端）不过滤。
- 详情页 stale 显示提示与官方链接，仍可访问。
- 统计接口/公司页使用同一口径。
- 加测试：stale 不出现在默认列表，但详情 200。

**验收**：`pnpm test:jobs-listing-counts` 通过；staging 上 stale 岗位默认列表不可见；API 响应时间不退化。

**回滚**：去掉 filter；stale 重新可见。

### S05 · 旧来源重复审计

**位置** 本仓库 · **依赖** B02 · **估时** 3h · **Gate** —

查 `ats:*` 与 `collector_feed` 的重复：按 canonical URL、`(company,title,location)` 分组，输出 top 100。决定：

- 若重复 >1%：默认列表排除 `source_system like 'ats:%'`，或加 `dedupe_group_id` 合并；先出报告，不改展示，等 G1 决定。
- 若 <1%：记录，不改。

**验收**：报告给出重复数、比例、样例；结论写入 progress；不改代码除非 Gate 明确。

**回滚**：只读。

---

## 8. Phase 1：验证与 G1/G2（V01-V02）

### V01 · 50 board canary（写生产前最后一次彩排）

**位置** 双端 · **依赖** U07、S04、D06 · **估时** 4h · **Gate** G1 前 —

1. 上游开 `BULK_BOARD_WRITE=true`，只放行 50 个 board（`BULK_MAX_ACTIVE_BOARDS=50`）。
2. 美国站跑一次增量同步（`pnpm sync:jobs -- --max-pages=...`），确认只新增、不误关。
3. 抽样 20 条岗位：官方 URL 200、标题/公司/地点一致、申请链接可用。
4. 对比上游 `board_poll_runs` 与美国站新增数；差异 <5%。

**验收**：50 board、≥2,000 岗位；0 误关；P95 ≤60 min；20 条抽样 0 错误；Feed 无 fatal failure。

**回滚**：按 `source_key` 删除这 50 个 board 的岗位（先导出）；关写开关；Feed 游标不回退。

### V02 · 500 board 观察 48h → G2

**位置** 双端 · **依赖** V01 · **估时** 2 天（观察） · **Gate** G1/G2 —

扩到 500；观察 48h，产出报告：

- active board / 新增岗位 / P95 / 成功率 / 429 率 / 重复率 / stale 比例 / 成本。
- 抽样 50 条已关闭（若没有关闭，写“0 关闭”）；抽样 50 条方向，错分率。

**G1 开门**：0 误关、P95 ≤60 min、成功率 ≥95%、抽样 URL 0 错误。
**G2 开门**：48h 成功率 ≥98%、重复 <0.5%、stale 正常、Feed 延迟 <15 min、成本可接受。

**回滚**：同 V01；观察期只扩不缩，除非触发停止线。

---

## 9. Phase 2：1,500 board 与新鲜度（W3-W4）

### D07 · 扩量探测到 2,000 active

**位置** 本仓库 · **依赖** V02 · **估时** 6h · **Gate** G2 后 —

再探 1,500 个候选（优先 GH/Ashby/Lever 中岗位数 50-2,000 的 board），保持 active ≥1,800。分批 500/天，避免集中打一个 host。输出 `data/p1-boards.csv`。

**验收**：新增 active ≥1,000；robots/公司名证据齐全；隔离率 <20%。

### U08 · 自适应退避 + ETag

**位置** 上游 · **依赖** U07 · **估时** 8h · **Gate** G2 后 —

- 支持 `ETag/If-None-Match`；304 → 只更新 `last_ok_at`，不解析、不写岗位。
- 连续 N 次无变化：间隔 ×1.5，上限 tier 上限；有变化立即回基准。
- 记录 304 命中率与节省请求数。

**验收**：ETag board 第二次轮询 304；无变化 board 间隔逐步拉长；请求数下降 ≥30%（对比固定间隔）。

### U09 · GH 浅轮询 + 变化拉正文

**位置** 上游 · **依赖** U08 · **估时** 6h · **Gate** G2 后 —

- 大 GH board 用 `content=false`；ID 集合或 `updated_at` 变化才拉 `content=true`。
- 单 board 详情拉取上限（如 200 条/轮），其余进详情队列。
- 记录浅/深请求体积。

**验收**：Stripe 轮询体积从 ~6 MB 降到 <1 MB；新岗位仍有正文；无漏岗（对比全量一次）。

### U10 · 详情补全队列

**位置** 上游 · **依赖** U09 · **估时** 6h · **Gate** G2 后 —

- 新岗位/正文变化 → `detail_fetch` 队列；限速与列表分开。
- 只补官方详情，缺字段留空；写 `field_evidence`。
- 失败不影响岗位上下架。

**验收**：正文覆盖率 ≥95%（GH/Ashby/Lever）；详情失败只记 health；无关闭副作用。

### S06 · 方向分类抽检

**位置** 本仓库 · **依赖** V02 · **估时** 4h · **Gate** G2 后 —

抽 500 条批量岗位，人工/规则核对 `direction`；统计“默认 Finance”比例。若 >5%：

- 上游补 `job_function`（复用现有分类器）；
- 美国站 `inferDirection` 增加 `其他` 兜底（需要产品确认筛选口径）；
- 不改历史数据，只对新数据生效。

**验收**：抽检报告；错分率 ≤5%；如加“其他”，筛选/统计同步更新。

### S07 · Feed 吞吐调优

**位置** 本仓库 · **依赖** S02 · **估时** 3h · **Gate** G2 后 —

- 用 10 万条变更回放（本地/影子表）测：30 页/4 分钟预算是否够；批量 upsert 大小；失败隔离。
- 调 `JOBS_INCREMENTAL_MAX_PAGES`、`JOBS_SYNC_WRITE_BATCH_SIZE`；不重置游标。
- 记录 P95 单页耗时、失败率。

**验收**：10 万条回放 ≤30 分钟、0 丢行；生产增量延迟 <15 min。

### V03 · 1,500 验收 → G3

**位置** 双端 · **依赖** D07、U10、S07 · **估时** 4h · **Gate** G3 —

指标：1,500 board、8 万岗位、P95 ≤30 min、成功率 ≥99%、误关 <0.2%、重复 <0.5%、stale 比例 <10%。

**G3 开门**：全部达标；否则只修不加量。

---

## 10. Phase 3：3,000 board 与长尾适配器（W5-W6）

### U11 · Breezy 适配器

**位置** 上游 · **依赖** U07 · **估时** 6h · **Gate** G3 后 —

`{token}.breezy.hr/json`；字段：id、name、published_date、location、description；robots 允许（禁静态资源）。加 fixture 与 100 条 canary。

**验收**：100 条真实岗位字段可解释；空 board 不报错；不产生关闭。

### U12 · Recruitee 适配器

**位置** 上游 · **依赖** U07 · **估时** 6h · **Gate** G3 后 —

`{token}.recruitee.com/api/offers/`；`updated_at`；robots 允许（禁 `/v/`）。

**验收**：同上；`updated_at` 能驱动增量。

### U13 · Teamtailor 适配器

**位置** 上游 · **依赖** U07 · **估时** 6h · **Gate** G3 后 —

`{token}.teamtailor.com/jobs.json`；robots 允许（禁 `/app` 等）。

**验收**：同上；分页/总数一致。

### U14 · 多 board 去重

**位置** 上游 · **依赖** U11-U13 · **估时** 4h · **Gate** G3 后 —

同公司多 board（DoorDash 类）生成 `dedupe_group_id`：`company_id + normalized(title) + primary_location + content_hash`。保留多行来源，展示层合并。

**验收**：重复组可查；组内主岗选择规则稳定；不影响单 board 摄入。

### S08 · 展示合并与索引

**位置** 本仓库 · **依赖** U14 · **估时** 5h · **Gate** G3 后 —

- 列表按 `dedupe_group_id` 合并，选最早 `first_seen_at`/最全字段为主。
- 加 `(region,direction,is_active,display_status)` 复合索引；分页上限。
- 搜索/AI 检索去重。

**验收**：重复组只展示 1 条；列表 P95 不退化；AI 候选不重复。

### S09 · 管理端 board 健康页

**位置** 本仓库 · **依赖** U07 · **估时** 5h · **Gate** G3 后 —

新增 `/admin/job-boards`：读上游 `/dashboard/board-health`（服务端代理，带鉴权），展示 board、tier、last_ok、posting_count、error、next_poll；分页/筛选。

**验收**：6,000 行可分页；失败 board 可筛；不暴露上游 key。

### V04 · 3,000 验收 → G4

**位置** 双端 · **依赖** U14、S08、S09 · **估时** 4h · **Gate** G4 —

指标：3,000 board、18 万岗位、P95 ≤30 min、成功率 ≥99%、误关 <0.2%、三家长尾适配器各 ≥100 board。

---

## 11. Phase 4：6,000 board 与成本（W7-W8）

### D08 · Common Crawl 增量发现

**位置** 本仓库（离线） · **依赖** U02 · **估时** 10h · **Gate** G4 前 —

按 `open-ats-feed` 的 S3 `cluster.idx` 范围读取法（不要用不稳定的 CDX API），每周扫 1 个新索引，提取 6 类 host 的 token，去重后进候选池；只发现，不直接上线。

**验收**：单次扫描产出 ≥500 新 token；去重后新 board ≥100；耗时/流量可接受。

### U15 · 请求预算与压测

**位置** 上游 · **依赖** U04、D08 · **估时** 6h · **Gate** G4 前 —

模拟 6,000 due board：令牌桶、并发、单 host 上限；测 429 率、P95 抓取耗时、worker 数。目标：浅轮询 15-20 万/天、峰值并发 20-40。

**验收**：压测报告；429 <2%；单 board 失败不拖停；可回退并发参数。

### U16 · 存储与成本

**位置** 上游 · **依赖** U07 · **估时** 4h · **Gate** G4 前 —

raw payload 压缩、90 天生命周期、S3 清理；统计 GB/天、$/1k 岗位；给出月度成本表。

**验收**：成本 ≤¥0.05/岗/月（主推方案）；S3 无无限增长。

### S10 · 25 万行查询/AI 检索压测

**位置** 本仓库 · **依赖** S08 · **估时** 6h · **Gate** G4 前 —

在影子表/生产只读副本灌 25 万行；测 `/api/jobs` 列表、筛选、详情、AI 候选检索；补复合索引；设分页上限。

**验收**：列表 P95 <500ms；AI 候选查询 <2s；无全表扫描（EXPLAIN 验证）。

### V05 · 6,000 最终验收（不开新 Gate）

**位置** 双端 · **依赖** U15、U16、S10 · **估时** 4h · **Gate** —

指标：6,000 board、25 万岗位、成功率 ≥99.5%、误关 <0.1%、P95 ≤30 min、成本达标。

---

## 12. Phase 5：常态化（O01-O03）

### O01 · 每周发现

每周一跑 D08 + D03，新增 board 自动 canary；失败进隔离队列；周报更新。

### O02 · 每月一个新 ATS

按 `job-acquisition-scaleup-project-plan.md` 的 P3/P4 清单评估（Workable 需限额、SmartRecruiters/Personio 需许可）；先做只读 canary，再谈上线。

### O03 · 季度合规审计

robots 重查（含归档）、删除通道演练、错误关岗抽样、成本复盘；更新 runbook 与本文档。

---

## 13. 指标口径（所有报告统一用这套）

| 指标 | 定义 | 目标 |
|---|---|---|
| 新增延迟 | `first_seen_at - posted_at`（有官方 posted_at 时）；否则 `first_seen_at - board 上次成功轮询` | 加权 P95 ≤30 min |
| 轮询成功率 | 成功 run / 总 run（按 vendor） | ≥99% |
| 误关率 | 抽样复核中“官网仍开放但被关闭”的比例 | <0.1% |
| 重复率 | 同 canonical URL 或同 dedupe 组的重复行 / 活跃行 | <0.5% |
| 字段证据率 | 核心字段 `field_status=official_payload` 的比例 | ≥95% |
| stale 比例 | stale / (listed+enriched+stale) | <10% |
| 单岗成本 | 月度基础设施 / 活跃岗位 | ≤¥0.05 |

---

## 14. 停止线（触发就停，不要“再观察一下”）

1. 误关 >0.1%：立即回滚当天关闭批次，停关闭任务。
2. 重复 >1%：停扩量，先去重。
3. 单 vendor 成功率 <95% 持续 1h：停该 vendor 新增，修适配器。
4. Feed 延迟 >30 min 或 fatal failure：停扩量，查游标/分页。
5. 发现 active board 的 robots 为 disallow：立即 `quarantined`，删除已摄入岗位（先导出）。
6. 单岗成本 >¥0.08：停扩量，先降频率/体积。
7. 任何 Gate 前写生产：回滚并记录事故。

---

## 15. 人类决策点（只需要你出现 4 次）

1. **G1**：50 board canary 后，是否允许写 500 board 生产。
2. **G2**：500 board 观察 48h 后，是否允许扩到 1,500 + Feed v2 生产。
3. **G3**：1,500 board 后，是否允许 3,000 + 长尾适配器。
4. **G4**：3,000 board 后，是否允许扩到 6,000。

其余时间 AI 按 `tasks.yaml` 连续执行；遇到 `blocked` 会在 progress 里留原始报错，等你或下一个任务。

---

## 附录 A：精确端点

| Vendor | 列表端点 | 备注 |
|---|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=false` | 轮询用 `content=false`；详情再拉 `content=true` |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{token}` | 强 ETag；大 board 14 MB |
| Lever | `https://api.lever.co/v0/postings/{token}?mode=json` | Crawl-delay 1；API host 允许 |
| Breezy | `https://{token}.breezy.hr/json` | 禁静态资源路径 |
| Recruitee | `https://{token}.recruitee.com/api/offers/` | 禁 `/v/` |
| Teamtailor | `https://{token}.teamtailor.com/jobs.json` | 禁 `/app` 等 |
| Workday | 现有 `myworkdaysite.com` 前门 | 不扩量，沿用 54 家 |
| Personio / SmartRecruiters | — | 公开审计拒绝，默认不接 |

## 附录 B：本仓库关键文件

- `src/lib/jobs-feed.ts`：Feed 客户端、`normalizeFeedItem`、方向/地区推断
- `src/lib/job-sync.ts`：岗位 upsert、字段证据保留、`toJobPayload`
- `src/lib/job-feed-orchestrator.ts`：游标/租约/页预算
- `src/lib/job-connectors/`：GH/Ashby/Lever/Phenom/Oracle 解析器（对照测试用）
- `src/app/api/jobs/route.ts`：公开列表筛选
- `src/app/api/admin/job-sync-dashboard/`：同步大屏
- `supabase/migrations/0139_*`：当前最新，新迁移从 `0140` 开始

## 附录 C：上游关键文件

- `app/connectors.py`：`CONNECTORS` 与各 ATS 类
- `app/tasks.py`：Celery beat（`crawl_all` 每 6h）
- `app/services.py`：解析/标准化/字段分类
- `app/models.py`：`Company/CompanySource/Job`
- `app/source_discovery.py`：单公司来源发现
- `app/bulk_boards.py`（待新增）：批量 board 导入/抓取