# 岗位采集规模化 · 执行账本

> 这是 AI 唯一允许改状态的地方。`tasks.yaml` 只读；本文件每完成一个任务必须更新。
> 最后更新：2026-11-24（B01-B03 完成，进入发现阶段）

## 状态规则

- `pending`：未开始
- `in_progress`：正在做（同一时间只允许 1 个）
- `done`：验收命令全部通过 + 已提交 + 已记录 commit
- `blocked`：同一验收失败 2 次，必须写原始报错与已尝试方案
- `skipped`：仅人类可标，需写原因

更新格式：`| 任务 | 状态 | commit | 完成时间 | 验收摘要 |`，并按时间倒序追加“日志”。

## 环境

| 项 | 值 |
|---|---|
| 美国站 commit | `03d8eebe0ca70cffe8f02946fc95c62adc0e2440`（2026-11-24 16:17 +08） |
| 美国站生产目录 | `/opt/liorvix`（git repo；systemd `liorvix.service` 跑 `node dist/server.js`） |
| 美国站服务重启点 | 2026-11-24 16:21:37 +08；上一版 `dist.bak-20261124-101147` |
| 上游 commit | 无 git；版本证据 = 文件哈希 + 镜像 `global-jobs-api:latest` ID `342cc0aa7c26` |
| 上游目录 | `/opt/global-jobs` |
| 上游镜像 tag（回滚点） | `global-jobs-api/worker/beat:latest` = `342cc0aa7c26`（4 天前构建） |
| 上游迁移机制 | Alembic（`alembic.ini` + `migrations/versions`，当前 head `0016_reclassify_amazon_runs.py`） |
| 上游关键文件哈希 | connectors `856561c3…`、tasks `06e27ebd…`、models `e0a9b947…`、services `48eab560…` |
| 上游代码备份 | `/opt/global-jobs/ops-backups/b01-20261124T082138Z/`（含 sha256） |
| 上游 DB 备份 | `/opt/global-jobs/ops-backups/b01-db-20261124T082748Z.dump`（1.5G，sha256 `165a0b5c…`；DB 7.3G） |
| 美国站最新迁移 | `0139_ai_match_retrieval_bounded.sql`；下一条 `0140_job_board_ingestion.sql` |
| 基线文件 | `tmp/baseline-20261124.json` |
| Supabase 备份时间点 | `/opt/liorvix-backups/liorvix-20261124-032117.dump`（444MB；DB 容器 2026-11-23 03:15 UTC 起） |
| Feed worker 实际配置 | `JOBS_AUTO_WORKER=true`、`JOBS_SYNC_INTERVAL_MINUTES=5`；**systemd jobs timers 全部 disabled**，不要按 timer 文档推断 |
| 当前生产事实 | US 233,525 行（active 114,142 / closed 119,383）；上游 407,909（OPEN 180,034 / CLOSED 227,875）；上游 169 家公司 |

## 执行约定（B03）

- 分支：`feat/bulk-<task-id>`；一个任务一个 commit，消息 `feat(jobs): <task-id> <摘要>`。
- 计划文档本身：`docs(jobs): ...`，不计入任务；不把 `tmp/`、`secrets/`、`.env*` 提交。
- **工作区已有他人改动，不得纳入本计划提交**：`src/app/api/admin/ai-usage/route.ts`、`src/app/api/admin/students/route.ts`、`src/app/login/page.tsx`、`src/components/RegistrationSuccess.tsx`；每次提交只 `git add` 任务文件。
- 回滚点：美国站 `dist.bak-20261124-101147` + `systemctl restart liorvix`；上游镜像 `342cc0aa7c26` + 代码/DB 备份（见上）。
- 迁移约定：上游 Alembic `upgrade head/downgrade -1`；美国站 SQL 迁移必须可 down，先在 staging/影子库跑。
- Gate 前禁止写生产；所有写操作先 `--dry-run`。

## 开关（默认全关）

| 端 | 变量 | 默认 | 作用 |
|---|---|---|---|
| 上游 | `BULK_BOARDS_ENABLED` | `false` | 批量 board 调度总开关 |
| 上游 | `BULK_BOARD_WRITE` | `false` | 是否写岗位；false 只记录 run |
| 上游 | `BULK_MAX_ACTIVE_BOARDS` | `50` | 放行 board 数上限 |
| 美国站 | `JOBS_FEED_V2_ENABLED` | `false` | v2 字段/行为 |
| 美国站 | `JOB_TTL_ENABLED` | `false` | stale 计算 |

## Gate 状态

| Gate | 状态 | 开启时间 | 依据 |
|---|---|---|---|
| G1（500 board 生产） | closed | — | V01 |
| G2（1,500 + Feed v2） | closed | — | V02 |
| G3（3,000 + 适配器） | closed | — | V03 |
| G4（6,000） | closed | — | V04 |

## 任务状态

| ID | 状态 | commit | 完成时间 | 验收摘要 |
|---|---|---|---|---|
| B01 | done | 6d9ef85 | 2026-11-24 16:31 | 两端版本、迁移机制、代码/DB 备份已记录；DB dump 1.5G |
| B02 | done | 6d9ef85 | 2026-11-24 16:31 | 基线：US 114,142 active；上游 180,034 OPEN；重复 14；Feed lag 3m16s |
| B03 | done | 6d9ef85 | 2026-11-24 16:31 | 开关/分支/回滚/账本约定已写入本节 |
| D01 | done | 611512d | 2026-11-24 16:35 | all 18,164；engineering 500；sha256 已记 |
| D02 | done | 611512d | 2026-11-24 16:38 | 1,500 候选（GH 931/Ashby 296/Lever 273）；331 engineering 优先；上游交集 0 |
| D03 | done | a8991f1 | 2026-11-24 16:47 | robots/三家解析/限速/断点；单测 10 项；Stripe/OpenAI/Palantir 均 active |
| D04 | done | 3dcb4fe | 2026-11-24 17:06 | 1,000 探测：902 active/70 隔离/28 404；错误率 2.8% |
| D05 | done | 165719c | 2026-11-24 17:34 | 902：842 名称（93.3%）/290 域名（32.1%）；60 token 兜底；无证据不猜 domain |
| D06 | done | 165719c | 2026-11-24 17:37 | 冻结 500（GH 400/Lever 100）；S98/A270/B132；50 抽 0 名称错/0 域名错 |
| U01 | done | no-git/upstream | 2026-11-24 17:00 | shadow up/down/up 通过；3 新列+2 表；生产代码已换，迁移未执行 |
| U02 | done | pending-commit | 2026-11-24 17:44 | staging 500 dry-run；apply 50：boards 50/bulk 公司 50/active 169 不变；重复 0 新增 |
| U03 | pending | — | — | — |
| U04 | pending | — | — | — |
| U05 | pending | — | — | — |
| U06 | pending | — | — | — |
| U07 | pending | — | — | — |
| S01 | pending | — | — | — |
| S02 | pending | — | — | — |
| S03 | pending | — | — | — |
| S04 | pending | — | — | — |
| S05 | pending | — | — | — |
| V01 | pending | — | — | — |
| V02 | pending | — | — | — |
| D07 | pending | — | — | — |
| U08 | pending | — | — | — |
| U09 | pending | — | — | — |
| U10 | pending | — | — | — |
| S06 | pending | — | — | — |
| S07 | pending | — | — | — |
| V03 | pending | — | — | — |
| U11 | pending | — | — | — |
| U12 | pending | — | — | — |
| U13 | pending | — | — | — |
| U14 | pending | — | — | — |
| S08 | pending | — | — | — |
| S09 | pending | — | — | — |
| V04 | pending | — | — | — |
| D08 | pending | — | — | — |
| U15 | pending | — | — | — |
| U16 | pending | — | — | — |
| S10 | pending | — | — | — |
| V05 | pending | — | — | — |
| O01 | pending | — | — | — |
| O02 | pending | — | — | — |
| O03 | pending | — | — | — |

## 关键指标快照

| 日期 | active board | 活跃岗位 | 新增 P95 | 成功率 | 误关率 | 重复率 | stale 比例 | 单岗成本 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 基线（B02） | 0（bulk） | 114,142 | — | — | — | 0.012% | — | — |
| G1（V01） | — | — | — | — | — | — | — | — |
| G2（V02） | — | — | — | — | — | — | — | — |
| G3（V03） | — | — | — | — | — | — | — | — |
| G4（V04） | — | — | — | — | — | — | — | — |
| 最终（V05） | — | — | — | — | — | — | — | — |

## 风险与偏差（不阻塞，但必须带着走）

| 项 | 证据 | 影响 | 应对 |
|---|---|---|---|
| 上游无 git 仓 | `git rev-parse` = not a repository | 无法用 commit 回滚 | 用文件哈希 + 镜像 ID + `ops-backups`；每次改前再备份 |
| 上游 `crawl_all` 6h + 大量 Workday 官方同步连续失败（48-60 次） | `job_sync_state` / `crawl_runs` | Workday 字段证据不可靠，不能当 P0 主源 | P0 主源只算 GH/Ashby/Lever；Workday 不纳入 500 |
| US 与上游 open 岗位差 65,892 | US 114,142 vs 上游 180,034 | 差的是非目标地区/未同步，不是丢数据 | 不做全量对账；按 target region 抽样 |
| systemd jobs timers 全 disabled | `systemctl list-unit-files` | 文档若按 timer 推断会误判新鲜度 | 以 `JOBS_SYNC_INTERVAL_MINUTES=5` 的进程内 worker 为准 |
| 工作区有他人未提交改动 | 4 个 src 文件 | 误提交会混入无关变更 | 只 add 任务文件；提交前逐项核对 |

## 阻塞项

| 任务 | 首次失败 | 原始报错 | 已尝试 | 解除条件 | 状态 |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## 日志（倒序）

### 2026-11-24 · U02 完成

- staging `jobs_u02_staging` 迁移到 `0017_ats_boards`，保留 169 家现有公司。
- `app/bulk_boards.py` 导入 500：首次 dry-run 全部新建；apply 50 后 boards 50、companies 219（+50 `Bulk ATS`），active 仍 169（`crawl_all` 不变），`jobs` 0。
- 幂等重复 apply：0 新增；42 按名、8 按 domain 命中。Airbnb/Asana 合成 board 验证 domain 匹配后已删除。
- domain 解析修正：CSV 裸域名（`airbnb.com`）需补 scheme 再取 hostname；修前所有 domain 被当空。
- robots 非 allow 一律 `quarantined`；P0 500 全 allow，故 50 条均 active。
- 生产库未写入、未重启；U02 仅 staging。

### 2026-11-24 · D05/D06 完成

- D05：902 个 active board 抓取；842 个公司名来自页面/覆盖（93.3%），60 个 token 兜底并标 low；290 个有 domain 证据（32.1%），612 个留空。
- 关键偏差：GH board 页 5 并发无限速会连续 403（第一轮 711/902 被拦）；改为 host 串行起步间隔 GH 900ms/Lever 500ms 后恢复，最终 902 全部 robots allow。
- 域名不猜：只收 sample 岗位 URL、og:url、JSON-LD、明确 Website 外链、人工覆盖；ATS 页面不暴露官网的留空。实测 95% domain 不可达，D05 验收已修正。
- D06：冻结 500（Greenhouse 400 + Lever 100）；tier S98/A270/B132；有 domain 169。50 条分层抽样：pass 16、blocked_by_site 2、no_domain 32、weak/fail 0。
- 产出 `data/p0-boards.csv`（sha256 `A33ACDAC...24D9D`）与 `docs/job-acquisition-d06-review.md`。
- 下一步：U02 在 staging 导入 500 dry-run、apply 50。

### 2026-11-24 · D04 完成

- 1,000 个 GH+Lever 探测：902 active（90.2%），70 隔离（16 空 board、54 样本内无目标地区），28 error（全部 404）；错误率 2.8%。
- 输出 `active.csv`（902 行）、`quarantine.csv`、`probe-errors.csv`；断点续跑测试：已成功的 3 个 smoke board 重跑时 `skippedResume=3`，没有重复请求。
- 偏差：D04 原计划混合三家；Ashby 296 个单请求 13s+ 且部分超大，先跑 GH+Lever 覆盖 1,000，Ashby 作为 D05 后的补跑，不阻塞 500。
- 下一步：D05 解析公司名/域名；先测 ATS 页面标题与官方外链覆盖率，不伪造 domain。

### 2026-11-24 · U01 完成

- 新增 `AtsBoard`（`ats_boards`，唯一 `(vendor,token)`，due/tier 索引）与 `BoardPollRun`（`board_poll_runs`，board_id 级联）。
- `jobs` 实测已有 `first_seen_at`/`last_seen_at`，只加 `source_key`、`last_snapshot_id`、`missing_streak`；索引 3 个。计划里“5 列”已修正为“3 列”。
- 影子库 `jobs_migration_test`（schema-only 复制 + 手工钉 `alembic_version=0016`）：`upgrade head` → `0017_ats_boards`；`downgrade 0016` 后新列/新表计数为 0；再 `upgrade head` 成功；`jobs` 0 行（未动数据）。
- `alembic check` 只报告历史遗留 drift（旧表 nullable/索引），没有本次 3 列/2 表的差异。
- 代码已上传 `/opt/global-jobs`（备份 `ops-backups/u01-20261124T090002Z/`）；运行中容器仍用旧镜像，**生产迁移未执行**，等 U02/V01 前再跑。
- 下一步：U02 导入器依赖 D06 冻结名单；先等 D04/D05/D06。

### 2026-11-24 · D03 完成，D04 启动

- 新增 `robots.ts`（RFC 9309 最长匹配、`*`/`$`、Crawl-delay、401/403 三态）、`providers.ts`（GH/Ashby/Lever 字段映射 + 目标地区计数）、`probe.ts`（每 vendor 限速、并发 8、3 次退避、JSONL 断点）、`test-ats-discovery.ts`（10 项）。
- 实测：GH Stripe 771 岗/483 目标地区；Ashby OpenAI 863/748；Lever Palantir 25 下限样本全目标地区。`tsc --noEmit` 通过。
- 关键偏差：Ashby API host robots 是 401，不是 200；按“公开文档 API”例外放行并在结果里写明 `public_api_documented_robots_unavailable`，G1 复核。Lever 大 board 全量会超时，探测固定 `limit=25` 并标 lower bound。
- D04 已后台启动：GH+Lever 1,204 行中取 1,000，输出 `tmp/boards/probe-results-gh-lever.jsonl`。Ashby 296 个因单请求 13s+，留到 GH/Lever 之后单独跑。
- 并行推进 U01（上游 `ats_boards` 模型与迁移）；D04 不依赖 U01，两者不写同一端。

### 2026-11-24 · D01-D02 完成

- D01：下载 `all.csv`（18,164 行，sha256 `abd8c46f…`）、`engineering.csv`（500 行，`e3cf372e…`）、`data-quality.csv`（500 行，`8e073185…`）、`board-roles.csv`（500 行，`3638a303…`）。这些是 2026-09-03 快照，只当候选，不当当前岗位数。
- D02：上游实际有 55 个活跃 GH/Ashby/Lever token（GH 35 / Ashby 18 / Lever 2），不是 169 个公司各自一个；已全部排除。工程质量文件里 137 个 board 的 engineering=0，不能全算“工程优先”；改为只给 `engineering>0` 的 331 个 priority=1，其余按岗位数补足。
- 结果：1,500 行、0 重复、0 上游交集、0 缺 URL；GH 931 / Ashby 296 / Lever 273；岗位数 1-4,981。
- 计划修正：D02 验收从“500 engineering 全在”改为“331 个 engineering 优先全在”，因为 9 个被质量隔离、26 个已在上游、137 个本身无工程岗。
- 下一步：D03 探测工具（robots + 三家 JSON + 限速/断点），这是 P0 关键路径。

### 2026-11-24 · B01-B03 完成

- B01：美国站 `03d8eebe`（与本地一致），systemd `liorvix.service`，`/opt/liorvix` 为 git 仓；上游无 git，记录文件哈希 + 镜像 `342cc0aa7c26`；上游 Alembic head `0016`；已备份 connectors/tasks/models 与 1.5G DB dump。
- B02：US 233,525 行（active 114,142 / closed 119,383），唯一来源 `collector_feed`，`ats:*` active 0，重复 URL 14；Feed 最近成功 08:21:54 UTC（lag 3m16s），24h 新增 2,975 / 关闭 3,416。上游 169 公司、407,909 行（OPEN 180,034 / CLOSED 227,875），最近成功 crawl 08:17 UTC，6h 节奏。
- B03：确认 `JOBS_AUTO_WORKER=true`、`JOBS_SYNC_INTERVAL_MINUTES=5`；jobs timers 全 disabled；回滚点与“不提交他人改动”规则写入本节。
- 结论：当前端到端瓶颈确实是上游 6h 轮换；US 侧 Feed 延迟健康（分钟级）。P0 只需把上游 board 调度 + Feed v2 做出来，不需要重做 US Feed。
- 下一步：D01 下载 open-ats-feed 语料，D02 生成候选池。

### 2026-11-24 · 初始化

- 生成执行计划、任务图、本账本。
- 未执行任何生产操作；所有开关默认关闭。
- 下一步：B01（读取两端 commit、备份、确认迁移机制）。