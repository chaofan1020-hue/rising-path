# 岗位采集规模化 · 执行账本

> 这是 AI 唯一允许改状态的地方。`tasks.yaml` 只读；本文件每完成一个任务必须更新。
> 最后更新：2026-11-25（V02 feed 已追平；v3 影子重建计划启动，Phase 0 备份/基线完成）
>
> v3 重建计划：`docs/job-acquisition-v3-rebuild-plan.md`

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
| 美国站生产 commit | `313d988`（link-close 上游确认门禁；2026-11-25 14:43 +08 部署）；仓库最新 `313d988` |
| 上游 api | `global-jobs-api-1` 支持 `scope=ats` + `external_job_id`/`source_url` 精确查询 |
| 美国站生产目录 | `/opt/liorvix`（git repo；systemd `liorvix.service` 跑 `node dist/server.js`） |
| 美国站服务重启点 | 2026-11-24 19:41:12 +08；部署前 release `924ae747a3cc8d819bf6a812ebea5a6ee277e09e` |
| 上游 commit | 无 git；版本证据 = 文件哈希 + 镜像 `global-jobs-api:latest` ID `fc66e4c34...`（pre-u07 `342cc0aa7c26`） |
| 上游目录 | `/opt/global-jobs` |
| 上游镜像 tag（回滚点） | API 当前 `1c7d1c82348a`；旧 API 镜像 `fc66e4c34ed2`（仍存在，可 tag 回 `global-jobs-api:latest`）；pre-u07 `342cc0aa7c26` |
| 上游迁移机制 | Alembic（`alembic.ini` + `migrations/versions`，当前 head `0018_feed_v2.py`） |
| 上游关键文件哈希 | connectors `856561c3…`、tasks `06e27ebd…`、models `e0a9b947…`、services `48eab560…` |
| 上游代码备份 | `/opt/global-jobs/ops-backups/u07-20261124T104555Z/`（含 sha256）；scope=ats 备份 `/opt/global-jobs/ops-backups/v3-scope-ats-20261125T044029Z/main.py` |
| 上游 DB 备份 | `/opt/global-jobs/ops-backups/b01-db-20261124T082748Z.dump`（1.5G，sha256 `165a0b5c…`；DB 7.3G） |
| 美国站最新迁移 | `0141_job_feed_v2_columns.sql`（含 `jobs_listing` 重建、display 索引） |
| 基线文件 | `tmp/baseline-20261124.json` |
| Supabase 备份时间点 | `/opt/liorvix-backups/liorvix-20261124-032117.dump`（444MB；DB 容器 2026-11-23 03:15 UTC 起） |
| Feed worker 实际配置 | `JOBS_AUTO_WORKER=true`、`JOBS_SYNC_INTERVAL_MINUTES=5`；**systemd jobs timers 全部 disabled**，不要按 timer 文档推断 |
| 当前生产事实 | 2026-11-26 13:40 +08：**已切读 `JOBS_READ_SOURCE=v3`**；US active **222,432** = v3 active（56 列全等、gap 0、`read_index_gaps=0`、DLQ 0、feed age 1.5min、reconcile 全 0）；**默认目录可见 206,330（92.7%）**（迁移 `0160` 地区识别修复 + 回填 90,368 行后，切读前为 60%）；`jobs` 5.3GB / `jobs_v3` 2.6GB / 库 8.3GB / 磁盘剩 6.2GB；生产 `0977d52`（回滚 `59d28a5`；切读回滚 = 删 flag 重启）；**上游 board 1,500**（GH 1,030 / Ashby 252 / Lever 218，导入后 0 failed），OPEN 岗位随新 board 首轮同步持续上涨 |

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
| 上游 | `BULK_MAX_ACTIVE_BOARDS` | 未实现 | 当前只用 500 board；观察期不再导入，靠流程约束而非代码上限 |
| 美国站 | `JOBS_FEED_V2_ENABLED` | `true`（代码缺省；生产未显式关闭） | v2 字段/行为 |
| 美国站 | `JOB_TTL_ENABLED` | `false` | stale 计算 |

## Gate 状态

| Gate | 状态 | 开启时间 | 依据 |
|---|---|---|---|
| G1（500 board 生产） | passed | 2026-11-24 20:10 | V01 50 board 44,234；V02 500 board 89,144+；board P95 16min、成功率 100%；当时记录 0 误关，11-25 发现跨 lane 关闭漏洞并修复（见 v3 Phase 0 日志） |
| G2（1,500 + Feed v2） | closed | — | V02 48h 观察中；未到 1,500 |
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
| U02 | done | 7fa41d8 | 2026-11-24 17:44 | staging 500 dry-run；apply 50：boards 50/bulk 公司 50/active 169 不变；重复 0 新增 |
| U03 | done | 95b5628 | 2026-11-24 17:50 | Stripe 771；首跑 new 771，二次 new/changed 0；坏 token jobs 不变；source_key 771/closed 0 |
| U04 | done | beeedec | 2026-11-24 18:29 | 50 board / 540s / 0 failed；jobs 45,005；closed 0；tier 排序和锁释放 bug 已修 |
| U05 | done | beeedec | 2026-11-24 18:32 | 同日心跳不增；昨日 last_seen 更新、updated_at 保留；missing_streak=1、仍 OPEN |
| U06 | done | f964cfc | 2026-11-24 18:40 | Feed v2 20 条 canary；source_key 过滤；v1 回退；迁移 0018 |
| U07 | done | 7440d6b | 2026-11-24 19:00 | 生产 50 board / 50 runs / 0 bulk jobs；health 50；0018 |
| S01 | done | c3784e1 | 2026-11-24 19:16 | US 0140 上线；active 114,380 不变、closed 119,444 不变；last_seen 全部回填；enriched 113,642 |
| S02 | done | c5b979b | 2026-11-24 19:41 | US feed v2 客户端 + 0141；27,697 条真实 v2；20 抽样 8 字段 0 空；tsc/单测通过 |
| S03 | done | c5b979b | 2026-11-24 19:41 | TTL worker + 单测：S/A 24h、B/C 7d、manual_hold/valid_through 豁免；display-only |
| S04 | done | c5b979b | 2026-11-24 19:41 | `/api/jobs` 默认 `display_status in (listed,enriched)`；closed/all 保留；jobs_listing 重建 |
| S05 | done | c5b979b | 2026-11-24 20:06 | 只读审计：`ats:*` 0、跨来源重复 0；53 组通用 URL 14,597 额外行，不按 URL 去重 |
| V01 | done | c5b979b | 2026-11-24 19:50 | 50 board 44,234 岗位；US 27,697 v2；20/20 官方 URL；0 误关；G1 |
| V02 | in_progress | 313d988 | — | 500 board、上游 `scope=ats` 127,900（8 合法 CLOSED）；US feed 因 legacy null source_tier 卡死已由 f163324/3767e0f 修复并追平；11-25 发现跨 lane 关闭漏洞，eb5cac9 已按 `source_key` 限定 close；1,942 条 legacy 关闭审计中 73 条上游仍 OPEN 已恢复；09f40ed 已切 `scope=ats`；8e86313 steady/catch-up + `caught_up_at`；c135ab2 建 `jobs_v3` 回填 199k；c77d27d 落 `upstream_watermark_at`；0149 statement 级影子触发器；0150 park 3,020 条无效 legacy DLQ；0151 v3 列表视图；53127a5 5 分钟对账/告警 watchdog；4007f7e 详情/open 影子读 + 0152 外键；313d988 链接关闭需上游确认 + 上游精确查询 + 0153 恢复 25 条误关；48h 观察至 2026-11-26 11:50 UTC |
| D07 | done | a1cd627 | 2026-11-24 21:06 | 探测 1,440：active 1,245、隔离 153（10.6%）；总 active 2,147；重冻结 1,000（GH630/Ashby252/Lever118），token fallback 0 |
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
| G1（V01） | 50 | 44,234 | — | 100% | 0 | 0% | — | — |
| G2（V02） | 500 | 89,144 | — | 100%（528/528） | 0 | 0% | — | — |
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

### 2026-11-26 · P0 地区识别修复：默认目录可见 60% → 92.7%（+72,931 条）

**问题量化（修复前实测）**：active 222,432 条中，默认目录（`matches_target_region=true`）只有 **133,399（60%）**；`region_market` 为 NULL 的 **70,894（31.9%）**。其中 41,441 条是标准美国地址——ATS 返回 `Bastrop, TX` / `Phoenix, AZ` / `Boise, ID - Main Site` 这类格式，而库里的两个函数都不认美国州代码。

**根因**：两个 SQL 函数各写一套关键词表且互相漂移——
- `public.job_region_matches_target(region)`（BEFORE 触发器算 `matches_target_region`）：只有 88 个国家/城市关键词，**没有任何州代码**；`%USA%` 也匹配不到 `City, US`。
- `public.ai_match_region_scope(value)`（`jobs_listing_v3.region_market` + `job_ai_match_scopes`）：有 `(^|[^a-z])us([^a-z]|$)` 但没有州代码、没有重音折叠。

**修复**（迁移 `supabase/migrations/0160_job_region_scope_state_codes.sql`）：
1. `ai_match_region_scope` 重写为 7 段判定：① 国家前缀排除（`France > Rungis : Miami Building` 不是美国岗）→ ② 非 ISO 国家码的美国州/属地码（AK/CT/DC/FL/HI/IA/KS/KY/ME/MI/MN/NC/ND/NH/NJ/NM/NV/NY/OH/OK/OR/RI/TX/UT/VT/WA/WI/WV/WY/PR/GU/VI/AS/MP）→ ③ 显式 US/North America/ANZ → ④ 原城市白名单 → ⑤ 歧义州码（AL/AZ/AR/CA/CO/DE/GA/ID/IL/LA/MA/MD/MO/MT/NE/PA/SC/SD/TN/VA）：要求 `[^,]{3,}, ST` 的城市段 + 排除印度/欧洲/以色列/亚洲/加拿大城市词 + 排除 `City, XX, 国家码` 三段式（`Nieuwegein, UT, nl`）；另有 `translate()` 重音折叠（`Montréal, Qc`）。印度 `, IN` 保守不判美国（避免 Bangalore/Pune 混入）。
2. `job_region_matches_target` = 原 88 关键词 **OR** `ai_match_region_scope(region) is not null` → **单调扩张，任何原本可见的行不会变不可见**。

**干跑**：4 轮只读事务（`begin; create function tmp_*; ... rollback`）。第 1 轮发现 PostgreSQL ARE 里 `\b` 是退格不是词边界（导致州码规则全不命中）；改用 `([^a-z]|$)`。第 2 轮暴露误判（`Nieuwegein, UT, nl` → 加拿大、`Wiesbaden, HE, de` → 美国、`LUCKNOW, IN` → 美国）；第 3 轮收缩为「非 ISO 州码」得 +43,974；第 4 轮加入歧义码守卫后得到 **+72,896**，随机 50 条抽样全部为美国地址（`Hawthorne, CA`、`Starbase, TX`、`Boise, ID - ID1`…）、foreign 探测 1,186 条逐条检查均为多地区 US 岗（`Canada; United States`、`Vancouver, WA`）。

**回填**：`scripts/jobs-region-backfill.sql`（`set region = region` 借 BEFORE 触发器重算 flag，AFTER 触发器同步 `job_ai_match_scopes`，shadow 触发器同步 `jobs_v3`），20 批 × 5,000，实测每批 ~5s，共更新 **90,368 行**（含 inactive 历史行），`remaining_mismatches=0`。

**结果**：`catalog_total=222,432` → `catalog_visible=206,330`（**92.7%，原 60%**）；`catalog_us=179,948`；lane 覆盖率 ATS 96.6%、legacy 88.9%；`job_ai_match_scopes` 313,519 行（us 270,543 / uk 18,544 / canada 10,938 / singapore 7,566 / australia 3,887 / hong_kong 2,041）；`v3 vs jobs flag parity = 0`；reconcile `missing/extra/field_mismatches/missing_evidence/read_index_gaps` 全 0；四个页面 200；全表 `count(*)` 从 3.7s 降到 **35ms**（走 `jobs_v3` partial index，函数改动没有拖慢读）。

**回滚**：迁移文件底部保留两个旧函数定义原文；恢复后重跑同一个回填脚本即可把 flag 收缩回原状（脚本双向幂等）。仍未覆盖（有意）：印度岗位 4,000+（非目标地区，正确保持隐藏）、`Indianapolis, IN` 178 条（`IN` 同时是 Indiana/India，保守不动）、`CA-QC-…` 130 条。

### 2026-11-26 · 🔴 生产切读已执行（方案 A）+ P1 1,000 board 全部导入

用户明确要求“不用等到那个时候，现在就开始”，因此两个闸门都提前执行。

**任务②（v3 切读）— 已切，运行正常**

- 切前 precheck：6 项 PASS（`reconcile_invariants all_zero`、`feed_age 1.62min`、`active_rows_match live 200,637=200,637`、`read_index_gaps=0`、`column_audit 全 56 列一致`、`dlq_pending=0`），唯一 FAIL 是 `evidence_24h WAITING`（当时干净 19.3h/24h）——按用户授权提前执行。
- 执行：备份 `/opt/liorvix/.env.local.pre-v3-cutover` → 追加 `JOBS_READ_SOURCE=v3` → `systemctl restart liorvix` → `active`。
- **进程级证据**：`/proc/<MainPID>/environ` 含 `JOBS_READ_SOURCE=v3`（`NODE_ENV=production`、`JOBS_AUTO_WORKER=true` 不变）。
- **读路径证据**：12 次 `/api/interview/jobs` 后 `jobs_v3.idx_scan` 367,626→367,629、`seq_scan` 5051→5052；`jobs.seq_scan` 不动 → 读确实走 v3。
- **数据等价证据（exact 计数）**：`jobs_listing` vs `jobs_listing_v3` 同为 **200,637**；加 `matches_target_region=eq.true` 同为 **117,442**。注意 `count=planned` 估算旧表给 97,253、v3 给 200,870——旧表统计信息已经严重失真，切读后统计卡片反而更准。
- 切后冒烟：`/` 200、鉴权路由 401、`/api/interview/jobs` 200、`/api/health` 200；20 分钟 0 error；对账仍 `missing/extra/field_mismatches/missing_evidence/read_index_gaps` 全 0，feed age 3.7min。
- 回滚：`sed -i '/^JOBS_READ_SOURCE=/d'` + restart，10 分钟内。

**任务①（P1 扩量）— 1,000 个 board 全部进生产（两批）**

- 用户直接授权“现在先导入 500，然后再第二批”，跳过等 48h。执行前 G2 实测（38.5h 处）：成功率 **99.944%**（62,643 run / 35 failed）、board P95 **25.6min**、误关（修正口径）**0**、重复 **0**、active board 500、OPEN 312,506。
- `data/p1-boards.csv` 上传上游 `/tmp`，sha256 校验 `a9b982a5…6ffe` 一致（1,000 行 + 表头）。
- 第一批 500（全是 greenhouse）：`bulk_boards --csv /tmp/p1-boards.csv --apply --limit 500` → active **500 → 1,000**；25 分钟内 GH 1,198 次轮询 / **0 失败**、900 个 board 全部拿到 `last_ok_at`、P95 17.5min。
- **踩坑：`--limit` 是「取 CSV 前 N 行」，不是「新建 N 个」**。第二批若重跑同一个 CSV，会再读前 500 行、全部命中已有 board → 新建 0 个（实测 active 仍 1,000）。改成导 501–1000 行切片（`tmp/p1-boards-b2.csv`，252 ashby + 130 greenhouse + 118 lever）后成功：active **1,000 → 1,500**（GH 1,030 / Ashby 252 / Lever 218）。
- **Ashby 首次进生产**：导入后 8 分钟内 252 个 ashby board 有 237 个已 `last_ok_at`、0 failing、238 次轮询 / 0 失败、avg 2.22s；`last_error` 全空 → vendor 适配正常（live `connectors.py` 有 `AshbyConnector`，`bulk_poll.py` 走 `{"board_name": token}`，`VENDOR_SPACING` ashby 0.5s）。
- 三 vendor 导入后 8 分钟：527 次轮询（ashby 238 / GH 173 / Lever 116）、**0 失败**。
- **效果**：美国站 active 岗位 **200,637 → 215,916（+15,279，+7.6%）**，用时约 1 小时（新 board 首轮全量同步）。

### 2026-11-26 · 切读前发现“关闭档案”缺口并加守卫

- `jobs_v3` 只有 **203** 条 inactive 行，`public.jobs` 有 **122,112** 条历史关闭记录——v3 回填只覆盖 active 岗位。详情接口本来 `.eq('is_active', true)`，行为不变；但 `/api/jobs?status=closed|all` 切到 v3 会瞬间返回空档案。
- 已加守卫（`59d28a5`）：`status=closed|all` 固定读 `public.jobs`，并在 `scripts/test-job-read-source.ts` 里锁住这条分支，防止以后有人把档案也切到影子表。回填 12.2 万行（约 +1.5 GB）是另一条可选路线，不阻塞方案 A。
- 顺手确认：全站没有任何前端/接口用 `status=closed|all` 查目录，关闭岗位的详情页今天就已经 404，所以切读对用户可见行为无影响。

### 2026-11-26 · 两个任务合并检查（37.6h / 18.5h）

- 任务②（v3）：active **200,674**（16 小时净增 1,370），`missing/extra/field_mismatches/missing_evidence/read_index_gaps` 全 0，feed age 3.6min，DLQ 0；24h 证据 **clean 18.5h/24h**、218 条样本、`max_feed_age 7.88min`、无 ALERT、无 coverage gap；到点 **11-26 15:11 +08**。生产 `59d28a5`（回滚 `c8650c7`）。`jobs` 5.3 GB / `jobs_v3` 2.5 GB / 库 8.1 GB / 磁盘剩 9.0 GB。
- 生产 16h 内 9 条 error 全是 `Server Reference ID did not match`（页面 server-action 校验），与岗位链路无关。
- 任务①（上游）：G2 观察 **37.6/48h**，成功率 **99.935%**（61,303 run / 35 failed）、board P95 **23.0 min**（已从 30.1 回落）、500 board / 125,197 岗位、24h 新增 6,132 岗位、vendor 失败 greenhouse 0 / lever 0.15%。
- **G2 “误关”口径再修**：窗口内共 6,667 条 CLOSED，其中 6,654 条是旧连接器车道（`source_key` 为空）历史式关闭、`missing_streak` 恒 0——按新口径会得出“6,654 条误关”的假警报。正确口径是「窗口内 + ATS 车道 + `missing_streak < 12`」：实测 **0**（ATS 车道窗口内关闭 13 条，全部 `missing_streak ≥ 12`，有连续缺席证据）。

### 2026-11-25 · G2 现状实测 + 误关口径修正

- G2 观察已跑 21.4/48h：**成功率 99.914%**（34,695 run / 30 failed）、board P95 `last_ok_at` **30.1 min**、重复 0、US active 199,304（`source_key` 覆盖 500）、feed lag 1 min、vendor 失败率 lever 0.64% / greenhouse 0.013%——除 P95 卡在阈值边缘外全部达标。
- **发现 G2 原查询会误判**：`count(status='CLOSED' and source_key is not null)=8` 原口径直接算“误关”，但查证这 8 条全是 `greenhouse:doordashusa`，`missing_streak` 52–67（相当于连续 14 小时全量 200 快照里都不存在），`closed_at` 11-24 16:48Z/23:10Z——是**正常下架**。已把 G2 口径改成 `closed_without_evidence = count(missing_streak < 12)`，并写明原因，避免明天判 G2 时因为正常下架被误判为不通过。
- P95 30.1 min 的结构性原因：132 个 board 配置 `poll_interval_seconds=1800`，P95 必然贴着 30 min。要么放宽阈值到 35 min，要么把 Tier C 的 1800s 降到 1200s（后者增加 request 量，G2 前不动）。

### 2026-11-25 · 读路径覆盖补齐（切读前必须）

- 审计发现切读会“只切一半”：只有列表/详情/stats/open 四个入口用了 `jobReadTable()`，收藏、投递记录、dashboard、AI 匹配、AI 优化、面试、JD 检索等 20 处仍硬编码 `jobs`。已全部改成开关（列表页 `jobListingReadTable`，其余 `jobReadTable`），`c8650c7` 部署，冒烟 `health=200 / 鉴权路由 401 / /api/interview/jobs 200 / search-jd 405(POST-only)`、无 error 日志、feed 两轮 success、对账仍全 0。
- 边界写进 [scripts/test-job-read-source.ts](scripts/test-job-read-source.ts)：受控读文件必须含 `jobReadTable()`；写路径/生命周期 worker/admin 运维文件**不许**出现它（防止 `JOBS_READ_SOURCE=v3` 把 upsert 或关岗写进影子表）；open 路由必须“读走开关、关岗写仍进 `jobs`”；开关必须按调用读 env，不能模块加载时缓存。
- `jobs/[id]`、`jobs/batch`、`generate-*`、`fetch-descriptions`、`check-sponsor`、`sync-techmap`、`admin/job-rotation`、`admin/job-field-quality`、`health` 保持旧表——它们要么写、要么是运维/admin 视角，切读不该影响它们。
- 过程中两次踩 CRLF：`write_text`/`edit` 会把整文件行尾从 CRLF 改成 LF，diff 直接变成全文件重写。最终用字节级 patch（检测原文件 `\r\n` 后写入对应行尾）才得到每文件 3–5 行的干净 diff；`tsc --noEmit` 通过。

### 2026-11-25 · 24h 证据脚本加夹具测试

- 24h 证据是切读的停止线，但 `jobs-v3-evidence.sh` 本身没被测过：判错就是“脏数据也 PASS”或“永远 WAITING”。新增 [scripts/test-jobs-v3-evidence.sh](scripts/test-jobs-v3-evidence.sh)，在 Linux 上合成 7 组日志夹具，**7/7 通过**：
  1. 25h 全干净 → `verdict=PASS` exit 0；
  2. 只有 12h → `WAITING clean_streak_shorter_than_window` exit 1；
  3. 中间一条 `field_mismatches=3` → `samples_breaking_streak=1`，连续段从该点重启；
  4. 一条 `feed_age_minutes=42` → 同样断streak，并报出 `max_feed_age_minutes=42.00`；
  5. 只有 `ALERT` 行、指标全干净 → `FAIL alert_without_metric_break`（不会误判成 WAITING）；
  6. 空日志 → `NOT_READY no_samples_in_window` exit 2；
  7. 钉住基线时，**基线之前的坏样本必须被忽略**（26h 前的 drift 行不进窗口，`samples_breaking_streak=0`、`verdict=PASS`）——这正是我们 07:11:43Z 之前误报样本的处理方式。
- 测试需要 `sh`/`awk`/GNU date，Windows 开发机跑不了，标注为在生产机执行。

### 2026-11-25 · 证据日志保留方式核实

- 担心“24h 证据会不会被日志轮转清零”，核实结果：`liorvix-jobs-v3-reconcile.service` 是 `append:` 追加写，`/etc/logrotate.conf`、`/etc/logrotate.d/*`、`tmpfiles.d` 都没有匹配该文件的规则 → **只增不减**（约 7 KB/天，32 行 ≈ 2.3h 历史）。24h/48h 窗口能自然累积；但手工清空/改名会让证据从零重算，这一点已写进手册。
- 顺带明确时间线：24h 证据到 **11-26 15:11 +08**，R26 的 48h 观察随之到 **11-27 15:11 +08**；P1 1,500 board 最早只能排在 11-27 之后，且仍需你确认。

### 2026-11-25 · 一键切换前置门禁（precheck）

- 新增 [scripts/jobs-v3-cutover-precheck.sh](scripts/jobs-v3-cutover-precheck.sh)：一条只读命令跑完 T-1 全部检查（对账不变量全 0、feed 新鲜度 <15min、`source_active == jobs_v3` active、`read_index_gaps=0`、56 列全量一致、DLQ pending=0、24h 证据 `verdict=PASS`），输出 `VERDICT READY_TO_CUT_OVER` 或 `NOT_READY failures=N`。
- 线上实测：6 项 PASS、1 项 `FAIL evidence_24h verdict=WAITING reason=clean_streak_shorter_than_window` → `NOT_READY failures=1`，正是“其余都就绪、只等 24h 证据”的预期状态。
- 两处小坑已修并写进测试：`jobs-v3-evidence.sh` 部署后没有 +x（要用 `-f` + `sh` 调）；`docker exec` 缺 `-i` 会让 psql 空跑并假成功。
- 手册第 1 节改成“先跑这一条”，手工命令保留在下面备查。

### 2026-11-25 · 全列审计与投影级等价

- Watchdog 每 tick 只比 8 列（title/company/region/display_status/source_key/job_url/apply_url/is_active），掉别的列不会报警。新增 [scripts/jobs-v3-column-audit.sh](scripts/jobs-v3-column-audit.sh)：按 `information_schema` 枚举 `jobs` 与 `jobs_v3` 的**全部 56 个共享列**，逐列 `is distinct from` 比对 active 行，实测 `total_mismatches=0`，非零则 `raise exception` 并 exit 1；已随 `f4df19a` 部署到 `/opt/liorvix/scripts/`，线上跑通 exit 0。
- 脚本第一版有个假 OK：`docker exec` 少了 `-i`，psql 收不到 stdin、零输出还 exit 0，打出“全部一致”。已修，并把这条写进测试（`docker exec -i` 必须在、无 `-i` 形式不许回来）。
- 幂等负向验证：临时表复制 500 行、改 1 行 title/posted_at，`is distinct from` 计数分别命中 1，证明比对逻辑真的能抓差异。
- 投影级等价：用 `/api/jobs` 的真实 `DETAIL_COLUMNS`/`SUMMARY_COLUMNS` 加默认筛选请求两个视图，**40 行、312,433 / 238,735 字节逐字节相同**，id 顺序也一致。
- `/api/jobs/stats` 走的是表级 `count=planned`：`matches_target_region` 真实值 116,317，`jobs` 估算 123,791（+6.4%）、`jobs_v3` 估算 118,239（+1.7%）；切读后统计卡片的“总量”会小幅变小但更准。
- 部署 `f4df19a` 时踩到第二个洞：上次 dev 模式预演把 `/opt/liorvix/next-env.d.ts` 改成了 `.next/dev/types/routes.d.ts`，导致 deploy 报“工作区有未提交改动”。`git checkout -- next-env.d.ts` 后重新部署成功（冒烟 health=200 login_form=1 admin=307 analytics_unauth=401，回滚点 `19ec486`）。手册 §2.5 已补这条。

### 2026-11-25 · 切换预演与两个“第二实例”陷阱

- 用 `PORT=5011 JOBS_READ_SOURCE=v3 node dist/server.js` 起第二实例做预演，发现两个坑并写进手册：
  1) 没带 `NODE_ENV=production` → 以 dev 模式启动，`/api/*` 行为与线上不一致（实测 `/api/jobs` 返回 200，而线上同请求 401），预演结果不可作数；
  2) 没带 `JOBS_AUTO_WORKER=false`/`JOBS_SYNC_DISABLED=true` → 第二实例会起第二个 feed worker，日志里可见它独立跑完一轮 `upserted: 4`，与线上 worker 抢同一批游标。
- 已杀掉预演进程（pid 933377），`5011` 端口释放；事后对账 `missing=0 extra=0 field_mismatches=0`、feed 正常，未发现数据影响。
- 结论：方案 A 的技术前置已齐（读路径代码 + 0157 索引 + 视图等价 + 计数器验证法），剩的就是 24h 证据到点。

### 2026-11-25 · v3 读路径索引补齐（切换前置条件）

- 发现切换读之前没人量过的东西：**`jobs` 有 39 个读路径索引，`jobs_v3` 只有 7 个**。实测 `region_market=us` 精确计数：`jobs_listing` ~75ms、`jobs_listing_v3` **~930ms（12 倍）**。如果现在切读，默认列表和每次筛选都会变慢，还可能触发 statement timeout。
- 迁移 `0157_jobs_v3_read_indexes.sql` 补齐 15 个表达式/部分索引（region_market、region_group、created/updated 排序、target-region、job_type、sponsorship、title/company trgm 等）。因为影子触发器在 feed 事务里写 `jobs_v3`，用 `concurrently` 建（24.8s，未阻塞写入）。
- 补齐后同一查询 **56–110ms**；`direction=SDE`、`display_status in (...)`、`title ilike` 等计划型查询 2ms 级，与旧表持平。`jobs_v3` 索引 7→43，表 2,165→2,347 MB，磁盘余 11 GB。
- 建索引期间与之后 3 个 5 分钟对账点保持 `missing=0 extra=0 field_mismatches=0 missing_evidence=0`，feed 连续 success，`write_duration_ms` 187–217。
- 顺带确认：`count=planned` 的“总数”在带筛选时会塌到 ~1000（真实 111,202），是视图函数表达式没有统计所致，**两张表表现一致**，不是 v3 回归；路由已对短页回填精确值并标 `total_is_estimate`。

### 2026-11-25 · 监控误报修正与 official_details 游标钉死

- **watchdog 误报**：`jobs-v3-reconcile.sh` 的 `row_failures` 取“任意来源最新 run”，而 official_details 每家公司稳定带 1 条失败，于是 06:30 / 07:05 UTC 两次 `ALERT latest_run_row_failures_1` 与 ATS feed 无关。改为只读 `source_system='collector_feed'` 的 run（`42b7200`），并新增 `scripts/test-jobs-v3-watchdog.ts` 防回归。
- **24h 证据基线重置为 `2026-11-25T07:11:43Z`**（修正后的第一个干净样本），完成时间 `2026-11-26T07:11:43Z`；`scripts/jobs-v3-evidence.sh` 支持 `[log] [hours] [since]`，输出 `clean_since` / `clean_hours` / `verdict`，避免把“短窗口”误判成 PASS。前 2 个告警样本按缺陷处理，不纳入证据窗口。
- **official_details 127 家公司原地打转**：每轮 `candidate_jobs≈100 / skipped≈99 / failed=1`，失败原因是官方页返回 HTTP 429。旧代码 `failed>0` 时“保留游标”，于是每轮重读同一批 100 条，永远到不了后面的岗位。`fca4cfa` 改为保留退避但把游标推进到本批最后处理的 job id。
- 验证（deploy 后 `07:26:44` 批次）：Microchip `state_cursor=193702`、CIBC `197972`、Motorola `195202`，均等于 `cursor_after`，不再停在 `cursor_before`。
- 切换手册已落到 [job-acquisition-v3-cutover-runbook.md](./job-acquisition-v3-cutover-runbook.md)：明确“只切读（现成）”与“读写都切（尚无写开关）”的差别，避免把只切读说成写入量已下降。
- 新增不变量复核：`v3_active_only=0`、`dup_ats_keys=0`、`ats_missing_key=0`、legacy 行 `source_key` 全空、关闭行 `closure_evidence` 全覆盖。

### 2026-11-25 · DLQ 清零与重试链路修复

- 上游补齐 `external_job_id`/`source_url` 精确查询后，重试 worker 第一次真正拿到目标行：原先全部报“未返回完全匹配的岗位”，现在分成两类——ATS 行可正常标准化并 resolve（14 条已恢复），legacy 行报“当前仍无法标准化”。
- lane 拆分结果：pending 452 条中 **ATS 0 / legacy 392 / unmatched 6**，全部无法进入 ATS lane（R04 冻结 + 无本地目标）。`0154` 先 park 58 条已暴露的，`0155` 结清余下 392 条；**`job_sync_failures` pending = 0**，dead 3,768（保留 payload/error 审计），resolved 14。
- 重试批大小提到 `JOBS_SYNC_FAILURE_BATCH_SIZE=100`，避免 20 条/5 分钟排长队。
- 关闭门禁抽成可测函数 `allowsLinkClose(shouldClose, verdict)`（`src/lib/job-link-health.ts`），新增 `scripts/test-job-close-guard.ts` 覆盖 open/unknown/absent 三种裁定与 404 二次确认；生产 `82e3947` 已部署（回滚点 `313d988`）。
- 5 分钟对账快照：`source_active=199193 v3_total=199232 ats=87270 legacy=111962 missing=0 extra=0 field_mismatches=0 inactive_shadow=39 missing_evidence=0 feed_age=0.8min row_failures=0`。

### 2026-11-25 · 链接误关根因与上游精确查询

- 逐条审计 00:00 UTC 以来仍关闭的 1,914 条 legacy 行（company + external_job_id 对齐上游库）：1,889 条上游确为 CLOSED，**25 条上游仍 OPEN**，属误关。
- 误关来自 link-health：LinkedIn/Deloitte 404、BCG/Bosch 410 被当作下架证据，与上游 OPEN 冲突。`313d988` 增加“关闭前必须上游确认”门禁：上游 OPEN → 不关；上游无法核验 → 不关；只有上游不再列出才允许关。
- 发现 `fetchJobForSyncRetry` 依赖的 `external_job_id`/`source_url` 过滤上游并不支持，导致 DLQ 重试始终“未返回完全匹配岗位”。上游 `/opt/global-jobs/app/main.py` 增加这两个参数并重建 api（备份 `ops-backups/v3-feed-lookup-20261125T064143Z`）；实测 `external_job_id=4478338664` 精确返回 LinkedIn 行、status=open；`scope=ats` 默认 feed 仍 200、`has_more=true`、`source_key` 全非空。
- 迁移 `0153_restore_upstream_open_legacy.sql` 恢复这 25 条；恢复后 active **199,192**、legacy 111,962、v3 mismatch 0 / gap 0 / 关闭 evidence 全覆盖；feed `195358` 仍 success。
- 当前生产 commit `313d988`（回滚点 `4007f7e`）。

### 2026-11-25 · Phase 2 watermark 与 v3 statement 触发器

- 迁移 `0147_job_sync_state_upstream_watermark.sql`：`job_sync_state.upstream_watermark_at` 已应用；客户端按每页 `generated_at` 取最大值；`c77d27d` 部署后 `195269/195279` success，watermark 与 `caught_up_at` 同步前进。
- DLQ 复核：`job_sync_failures` 已有 attempts/next_retry_at/status、1m→5m→30m→2h 退避、5 次转 `dead`；worker 每轮 claim 20。
- 迁移 `0151_jobs_listing_v3_view.sql`：新增 `jobs_listing_v3` 视图；`/api/jobs` 列表与 `/api/jobs/stats` 支持 `JOBS_READ_SOURCE=v3`，默认仍读旧表；anon 视图 active 计数与源库一致。
- `scripts/jobs-v3-reconcile.sh` + `ops/systemd/liorvix-jobs-v3-reconcile.{service,timer}`：生产已安装 5 分钟只读对账/新鲜度 watchdog；首次 run `2026-11-25 06:07:28 UTC` 输出 missing=0/extra=0/field_mismatches=0/missing_evidence=0/feed_age≈0.3min；异常 exit 1，配置 `JOBS_ALERT_WEBHOOK_URL` 时额外 POST JSON。
- 迁移 `0152_jobs_v3_company_fk.sql`：给 `jobs_v3` 补 `company_config_id` 外键（与 `jobs` 同名语义、`on delete set null`，NOT VALID 后立即 validate）；PostgREST 嵌套 `company_info:company_config(...)` 在 `jobs_v3` 上实测 200。`4007f7e` 把影子读扩展到 `/api/jobs/[id]` 详情与 `/api/jobs/[id]/open`，写路径仍只走 `jobs`。
- 迁移 `0150_jobs_dlq_park_invalid_legacy.sql`：把 3,020 条永久无效的 legacy `source_tier` 行标为 `dead`（payload/error 保留）；DLQ pending 从 3,472 降到 **452**，`dead=3,318`、`resolved=12`，不阻塞 feed。
- 迁移 `0149_jobs_v3_statement_triggers.sql`：把逐行影子触发器改为 insert/update/delete 三条 statement 级 transition-table 触发器；insert/update/delete 事务内 CRUD 验证通过。
- 微基准（事务内 rollback，不动生产数据）：1,500 行更新，关闭影子 2.5s，statement 影子 5.9s；逐行触发器同条件 11.9s。影子额外成本从约 9.4s 降到约 3.4s。
- 注意：这是 1,500 行写入基准，不是 1,500 board 真实压测；真实扩量仍需用户确认和上游 board 扩容。

### 2026-11-25 · v3 Phase 3 回填与 Phase 4 影子写入

- 迁移 `0143_jobs_v3_schema.sql` 建 `jobs_v3`：独立序列/PK、`lane`、`closure_evidence`、`canonical_job_id`、ATS 唯一索引、active 读索引、RLS。
- 迁移 `0144_jobs_v3_backfill.sql` 回填 active：**199,185 行**（ATS 87,244 / legacy 111,941）；全字段与源库比对 **0 mismatch**，核心字段空值 0；v3 总大小 **2.1 GB**，剩余磁盘 **11 GB**。首次执行被 1 分钟 `statement_timeout` 取消，设 `statement_timeout=0` 后重跑成功，未留下半成品。
- R15 决策：53 组 canonical URL 是通用申请入口，不是重复岗位，**不做物理合并**；ATS 身份唯一索引冲突 0。
- 迁移 `0145_jobs_v3_shadow_write.sql`：`jobs` 触发器把后续变更镜像到 v3，异常只 warning、不阻断源写入；回填后一次性对齐 380 行，当前 mismatch=0。
- 迁移 `0146_jobs_v3_closure_evidence.sql`：关闭时写 `closure_evidence`（feed / link_check / manual_or_legacy + 时间 + HTTP 状态）；当前 v3 的 4 条关闭行证据齐全；事务内模拟 404 关闭已验证，回滚后无残留。
- 读取开关：`jobReadTable()` + `/api/jobs/stats` 支持 `JOBS_READ_SOURCE=v3`；默认 `jobs`，其它读 API 未切。`c135ab2` 已部署，smoke 通过。
- R19 当前快照：active gap 0、字段 mismatch 0、region/tier/is_closed mismatch 0、关闭证据 4/4；24h 持续对账未做。
- 未完成：1,500 board 压测、完整读路径切换与回滚演练、v3 48h 观察。

### 2026-11-25 · v3 Phase 2 steady/catch-up 与追平状态

- 迁移 `0142_job_feed_catchup_state.sql`：`job_sync_state` 增加 `last_page_at`、`caught_up_at`；已在生产应用，`caught_up_at` 从旧 `last_incremental_success_at` 回填。
- `8e86313`：cursor 为空走 **steady**（最多 2 页），cursor 非空走 **catch-up**（30 页 / 4 分钟）；每页写 `last_page_at`，`has_more=false` 才写 `caught_up_at` + `last_incremental_success_at`。
- `/api/jobs/sync-feed` 新鲜度优先读 `caught_up_at`；`last_page_at` 作为 catch-up 心跳。部署后 `195225` success、0 row failure，`last_page_at=caught_up_at=05:00:25 UTC`。
- 未完成：独立 upstream watermark 未持久化；DLQ 仍只沿用 `job_sync_failures`，未做自动退避/最大重试列。

### 2026-11-25 · v3 Phase 1 ATS scope 与关闭权威

- 上游 `app/main.py` 增加 `scope=ats`（只保留 `source_key is not null`），默认 `scope=all` 不变；备份 `ops-backups/v3-scope-ats-20261125T044029Z/main.py`，`py_compile` 通过，API 镜像 `1c7d1c82348a` 重建并重启。
- 实测上游 539,649 行 / 411,749 legacy → `scope=ats` **127,900** 行，8 个合法 CLOSED 仍在；接口返回 `contract_version=jobs.v2`，首条 ATS close 带 `source_key=greenhouse:doordashusa`。
- 美国站 `09f40ed` 默认请求 `scope=ats`，`JOBS_FEED_SCOPE=all` 为回滚开关；部署后 `195203` run success、0 row failures。
- 关闭权威：`eb5cac9` 后 ATS close 只能命中同 `source_key` 行；legacy close 被跳过。R07 核心完成。

### 2026-11-25 · v3 Phase 0 备份、基线与关闭权威修复

- 生产备份：`/opt/liorvix-backups/jobs-v3-pre-20261125-040722.dump`，449 MB，`pg_restore -l` 1,637 项，sha256 `6320a3e9…ba2df`；基线 `tmp/v3-baseline.json`（04:08 UTC）。
- Feed 12h 卡死已由 `f163324`（跳过 null `source_key`）+ `3767e0f`（normalize 前早退）修复；04:21 后连续 success、0 row failures。
- **新发现跨 lane 关闭漏洞**：ATS close event 只按 `(company, external_id/url)` 匹配，会把同公司同 ID 的 legacy 行一起关闭。04:10–04:15 的 40 条 legacy 关闭中，60/62 上游也已 CLOSED，2 条上游仍 OPEN 已恢复。
- 修复 `eb5cac9`：close 事件必须带 `source_key`，并按 `source_key` 过滤目标行；无 `source_key` 的 legacy close 直接跳过。部署后新 feed run `closed=0`，legacy 不再被 ATS close 跨 lane 关闭。
- 全量审计 2026-11-25 00:00 以来 1,942 条 legacy 关闭：73 条上游仍 OPEN 已恢复；其余上游 CLOSED，属于合法关闭或待链路复核。04:26/04:27 两条 HTTP 404 关闭保留，属于官方链接权威关闭，不恢复。
- 新增 `/api/jobs/sync-feed` 的 `lag_minutes`、`heartbeat_age_minutes`、`stale`、`catching_up`；`healthy` 不再仅凭“worker 最近动过”为真（`4d3a592`）。
- R03 外部告警仍待接；R04 已完成 legacy feed 写入/关闭冻结（ATS feed 仍正常 success）。下一步进入 Phase 1 上游 `scope=ats`。

### 2026-11-24 · D07 P1 扩量探测与冻结

- 候选 1,500（排除 P0 500、D02 1,500、active 902）；实际探测 1,440（60 个 Lever 未探）：active 1,245、隔离 153、错误 42。
- 累计 active 902+1,245=**2,147**；隔离率 10.6%，低于 20%；active 率 86.5%。
- 50-2,000 优先池已被 D02 吃掉，P1 只剩长尾；招标仍以官方 API 200 + 目标地区样本 + robots allow 为准。
- 冻结 `data/p1-boards.csv` 1,000 个：GH 630 / Ashby 252 / Lever 118；A21/B904/C75；sha256 `A9B982A5...4FFE`。
- 1,000 个全部 `name_source=page_title`（token fallback 0）；215 个有公司域名，785 个无，标 `confidence=low`，不阻断抓取、阻断官网展示。
- 生产导入仍等 G2；本轮不新增 upstream board。

### 2026-11-24 · S05 旧来源重复审计

- US active 189,146；`source_system='collector_feed'` 186,467；`source_system like 'ats:%'` **0**。
- 跨来源重复 0；`(company,title,region)` 重复组 8,766 / 25,035 行，多为同标题多 req，不能自动判重。
- canonical URL 重复 53 组 / 14,650 行；样例 Carvana `careers/apply` 1,563 行、IBM `jobdetail` 811 行，是通用申请入口，不是重复岗位。
- 决策：不排除 `ats:*`、不启用 `dedupe_group_id`、不按 URL 去重；报告 `docs/job-acquisition-s05-duplicate-audit.md`。

### 2026-11-24 · V01/V02 500 board 放量

- V01：`BULK_BOARD_WRITE=true`，50 board 首轮 44,234 岗位；`source_key` OPEN 44,234 / CLOSED 0；150 runs 全成功。
- 美国站部署 `c5b979b`（S02-S04），真实 feed 抽样 20 条 v2 字段 0 空；示例 Accenture Federal Services 官方 GH URL。
- 第一次 US 增量同步仍是旧进程，写入的 ATS 岗位 `source_key` 为空；回退 `job_sync_state.cursor` 到 11:30 UTC，停服务后手动回填 27,697 条，服务恢复。
- V02：500 board 导入（450 新增 board、449 新 `Bulk ATS` 公司；active 公司 169 不变）；528 runs / 0 失败；`source_key` 89,144（373/500 有岗位）；重复 0；误关 0。
- 48h 观察从 2026-11-24 11:50 UTC 开始；观察期内不继续放量、不启用 `JOB_TTL_ENABLED`。
- 报告：`docs/job-acquisition-v01-v02-report.md`；G1 开、G2 仍关。

### 2026-11-24 · S01 US 0140

- 首次 dry-run 在 `UPDATE` 114,380 行时触发 DB `statement_timeout`；事务回滚，列未落库。迁移 SQL 顶部加 `set statement_timeout = 0;` 后重跑。
- 生产 jobs 备份：`/opt/liorvix-backups/jobs-pre-0140-20261124T...dump`。
- 结果：active 114,380 不变，closed 119,444 不变；7 列 + 3 索引；last_seen 回填 114,380；enriched 113,642、listed 738。
- 未改 `is_active/is_closed`；down 可在事务内 `drop column` 回滚。

### 2026-11-24 · U07 生产部署

- 旧镜像 `342cc0aa7c26` 打 `pre-u07` tag；备份 `ops-backups/u07-20261124T104555Z/`（代码 + 1.5G DB dump）。
- 坑：`docker compose build api worker beat` 不重建 `migrate`，旧 migrate 0016 造成 0017 半应用（表在、jobs 列缺、version 未动）。清空空表后补建 migrate 镜像再迁移，最终 `0018_feed_v2`。
- 生产 50 board 导入：50 家公司新建（`Bulk ATS`，inactive），active 公司仍 169；board 50 active。
- 坑：默认 Celery 队列有 38 个 crawl 任务，poll 任务排不上。新增 `bulk` 队列和 `bulk-worker`（concurrency 2），beat `poll-ats-boards` 路由到 `bulk`。
- 50 board dry-run：50 runs / 50 success / 44,230 jobs seen / `jobs_new=0` / `jobs_changed=0` / 带 `source_key` 岗位 0；`/dashboard/board-health?limit=60` 返回 50 行。
- 总 jobs 408,439→408,517（+78 来自 `crawl_all`，非 bulk）；生产开关 `BULK_BOARDS_ENABLED=true`、`BULK_BOARD_WRITE=false`、`FEED_V2_ENABLED=true`。

### 2026-11-24 · U06 完成

- 迁移 `0018_feed_v2`：`jobs.source_tier char(1)`、`jobs.is_list_only bool default false`；staging 已 ALTER 并按 `source_key` 回填 `source_tier`。
- `serialize_job` v2：`contract_version=jobs.v2`；`external_job_id` 只在输出加 `source_key:` 前缀；`apply_url/source_updated_at/snapshot_id/source_tier/is_list_only` 输出；`last_seen_at` 老数据也发送。
- `integration_jobs` 新增可重复 `source_key` 查询参数；`since` 文档明确为 `feed_updated_at > since`。
- 20 条 Stripe canary 通过；`source_key` 过滤 20 条、不存在的 board 返回空；`FEED_V2_ENABLED=false` 回退 jobs.v1 且新字段置空。

### 2026-11-24 · U04/U05 完成

- U04 调度器：`poll_ats_boards` beat 每分钟；全局锁 + 每 board Redis 锁 + GH/Ashby/Lever 起步间隔（0.2/0.5/1.0s）；ThreadPool 5；失败退避、5 次 paused。
- 首轮 50 board 540s、0 failed、45,005 jobs、closed 0。大 board list-only 后明显加速；Stripe 用 content 验证详情路径，批量用 list-only。
- 修两个 bug：`order_by(tier)` 字典序把 C 排 S 前 → CASE S/A/B/C；Redis 锁释放异常覆盖已成功结果 → 释放异常吞掉，不覆盖结果。
- staging 容器 sleep 2400 到期导致 3 个 running 假死；恢复脚本标记 failed、清 `bulk:*` 锁、重建 7200s 容器，重跑成功。
- U05 心跳：`upsert_job` 会把 `last_seen_at/updated_at` 每次写成 now；在 bulk_poll 里同日恢复 `last_seen_at`，内容未变恢复 `updated_at`；昨日心跳才更新。缺失 job 只 `missing_streak+=1`，不 close。
- 实测：同日 771 条心跳不增；aged 1 条 `last_seen_at` 更新、`updated_at` 保留；fake missing `missing_streak=1`、`OPEN`；全库 `closed=0`。

### 2026-11-24 · U03 完成

- `app/bulk_poll.py` 单 board 抓取：复用 `get_connector`，`upsert_job`，只 upsert/reopen，不关闭。
- Stripe staging：771 岗位，10s；二次轮询 `jobs_new=0`、`jobs_changed=0`（加了前后字段对比，避免把每条 existing 都算 changed）。
- 坏 token `stripe-missing-fixture` 404：`jobs` 仍 771，`board_poll_runs` 记 failed/404，board 退避并累计 failure。
- `source_key=greenhouse:stripe` 771、`status=OPEN` 771、`CLOSED=0`；`first_seen_at`/`last_snapshot_id` 全有值。
- 注意：`JobStatus` 在 PostgreSQL 枚举是 `OPEN/CLOSED`，不是模型里的 `open/closed` 字面量，查询要 `status::text`。

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