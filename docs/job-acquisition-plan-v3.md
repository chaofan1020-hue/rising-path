# 执行计划 v3（2026-11-26 16:00 +08 定稿）

> 本版已按用户 2026-11-26 15:5x 的 4 项拍板定稿，**可以直接开工**。
> 前置状态：A（地区识别修复）、B（扩到 3,007 board）已完成；C1（写切换设计）已完成。

## 决策记录（用户已拍板）

| # | 决策 | 结论 | 影响 |
|---|---|---|---|
| 1 | P0 备份删除范围 | **保留「最新 1 份 + 上一份 + v3 切换前 1 份」**，其余全删 | 磁盘 5.9 G → 约 15 G |
| 2 | 目录默认展示 | **默认展示全部地区**（不保留 `target` 默认值） | `/api/jobs` 默认 `region_scope=all` |
| 3 | 地区筛选 | **要做，且覆盖所有地区**（不是只加印度/欧洲两个桶） | 新增完整的「国家/大洲」维度（见 D4），非可选 |
| 4 | AI 选岗口径 | **非目标地区岗位不进 AI 推荐池** | `job_ai_match_scopes` 维持 6 个目标市场不变 |

---

## 0. 现在的真实位置（生产实测，2026-11-26 15:30 +08）

| 指标 | 数值 | 备注 |
|---|---:|---|
| 本站 active 岗位 | **260,314** | ATS 车道 149,051 + legacy 车道 111,263 |
| 默认目录可见 | **243,543** | `matches_target_region = true` |
| 已存但不可见 | **16,771** | 印度/巴西等非目标地区（legacy 车道带进来的） |
| 上游 OPEN 岗位 | **390,507** | **ATS 车道 208,391**（GH 138,167 / Lever 48,301 / Ashby 21,923）+ legacy 181,549 |
| **被地区过滤器丢掉的 ATS 岗位** | **≈ 59,340** | 208,391 − 149,051，本次要补的就是这些 |
| 上游 ATS 岗位的 `country` 取值 | **10,210 种** | 大量是城市名/州码，不是国家 —— 这是 D4 的主要难点 |
| 上游 ATS 岗位的 `location` 取值 | **31,083 种** | 前 30 个覆盖了大部分行 |
| 上游 board | 3,007 | 0 failing |
| feed lag | 峰值 8.6 min / 常态 4–6 min | 停止线 15 min |
| 磁盘 | 42 G / 50 G，**剩 5.9 G** | `/var/log 3.4G`、`/opt/liorvix-backups 6.0G`、`/opt` 陈旧备份 3.1G、`jobs` 5.5G + `jobs_v3` 3.5G |
| `jobs` 表 | 382,541 行 / 5,501 MB | inactive 122,227 行（归档页要用） |
| `jobs_v3` 表 | 281,444 行 / 3,503 MB | 死元组 4.3%，`VACUUM FULL` 收益有限 |

**全量后的预期**：active **260,314 → 约 319,000（+23%）**；其中约 76k 条属于非目标地区，需要靠 D4 的国家维度才能筛选。

---

## P0. 磁盘清洁（前置，最先做，30–45 min）

**为什么最先做**：D3 会新增约 59k 行（≈ +0.8–1.7 GB），C2 要向 v3 回填 12.2 万关闭行（≈ +1.5 GB）。5.9 G 不够。

### P0-A 日志（释放 ≈ 2.9 G）
| 动作 | 现状 | 释放 |
|---|---|---:|
| `journalctl --vacuum-size=300M` | 2.9 G | **+2.6 G** |
| 清 `/var/log/nginx/supabase.access.log.1` 等已轮转文件 | 168 M | +0.15 G |
| `truncate -s 0 /var/log/btmp /var/log/btmp.1`（全是扫描器登录失败） | 129 M | +0.13 G |

### P0-B `/opt/liorvix-backups`（5.7 G → 约 2.1 G，释放 ≈ 3.6 G）
**保留 3 份**：
- `liorvix-20261126-032401.dump`（1.2 G，最新全库）
- `liorvix-20261125-032535.dump`（423 M，上一份）
- `jobs-v3-pre-20261125-040722.dump`（449 M，v3 读切换前，回滚要用）

**删除 11 份**（约 3.6 G）：
`liorvix-20261124-032117.dump`、`liorvix-20261123-115510.dump`、`liorvix-20261123-120550.dump`、`liorvix-20261123-163353.dump`、`liorvix-20261123-162233.dump`、`liorvix-20261123-160600.dump`、`liorvix-20261123-111945.dump`、`jobs-pre-0140-20261124T110737Z.dump`、`jobs-pre-0140-20261124T110358Z.dump`、`liorvix-before-phase3.tar.gz`、以及对应 `.log`

### P0-C `/opt` 陈旧备份与构建产物（释放 ≈ 3.15 G）
删除（均为 2026-08/09 的历史快照，已确认无进程占用）：
- `liorvix-backup-20260907-preview/`（1.4 G）
- `liorvix-backup-before-phase4d.tar.gz`（271 M）
- `liorvix-backup-20260907-1656/`（282 M）
- `liorvix-backup-20260907-preview-v2/`（196 M）
- `liorvix-build/`（908 M，Nov 24 构建中间产物，可重建）
- `liorvix-phase1-backup.tar.gz`（40 M）、`liorvix-backup-pre-admin-20260830.tar.gz`（39 M）、`liorvix.rollback-resume-switch-20260909.tar.gz`（20 M）

### P0-D Docker
`docker image prune -f`（悬空镜像 0 个，预计无收益）。**不动**在用的 5 个镜像（storage-api / imgproxy / gotrue / postgres / postgrest）。

### 验收
- `df -h /` 可用空间 **≥ 15 G**
- `systemctl status liorvix` active；`/ /jobs /ai-match` 全 200；`docker ps` 5 个容器都在
- 保留的 3 份 dump 用 `pg_restore --list` 验证可读
- 删除清单 + sha256 记进 `docs/job-acquisition-progress.md`

### 回滚
不可回滚（删除类）。因此执行顺序：**先验证保留的 dump 可读 → 再删**。

---

## D. 全量同步 + 全地区筛选（本次主体）

### 现状根因
两处代码把非目标地区岗位丢弃，都在 ATS 车道：

| 位置 | 现在的行为 |
|---|---|
| `src/lib/jobs-feed.ts:713` `normalizeSkipReason()` | 地区不在 us/uk/ca/au/sg/hk → 返回 `outside_target_region`，整条丢弃 |
| `src/lib/jobs-feed.ts:542` `buildJobRecord()` | 同一判断，第二次早退返回 null |

legacy 车道（`src/lib/job-connectors/sync.ts`）没有地区过滤，不用改。

### 关键难点：增量游标追不回历史
增量同步按上游 `updated_at` 游标推进，被丢弃的 59k 条上游 `updated_at` 不会再变 → **改完过滤等自然同步是无效的**。

解法：复用系统内置的**全量对账模式**（`mode='reconcile'`，独立游标 `reconcile_cursor`、页数上限 1000、6 小时过期保护、`JOBS_ALLOW_FULL_RECONCILE=true` 开关）。走完一次即把历史全部重放。

### 步骤

#### D1 · 缺口量化（1–2 h）
加 `JOBS_FEED_REGION_FILTER=count` 模式：照常遍历全部页，对「原本会被区域过滤」的行**只计数不写**，并记录国家分布。
- 产出：`outside_target_region` 精确条数（预期 ≈59,340）+ 按国家 TOP50 分布 + 覆盖率基线
- 这组数据同时是 **D4 国家识别的覆盖目标基线**
- 回滚：删 flag

#### D2 · 去掉写入侧区域门禁（1 h）
- 新增 env `JOBS_FEED_REGION_FILTER`：`target`（默认，保持现状）/ `all` / `count`
- 改 `normalizeSkipReason()` 与 `buildJobRecord()` 两处
- 新增 `scripts/test-job-feed-region-filter.ts` 契约测试（三档行为、默认回滚档、`not_ats_source` 等其它 skip 原因不受影响）
- 验收：测试全绿 + `tsc` 通过 + 生产仍跑默认档（无行为变化）

#### D3 · 全量回补（2–4 h，含观察）
- 切 `JOBS_FEED_REGION_FILTER=all` + `JOBS_ALLOW_FULL_RECONCILE=true`
- **分轮跑**：每轮约 100 页（5 万条），跑完检查 feed lag / 磁盘 / reconcile 全 0，再跑下一轮
- 预期：`reconcile_open_seen` 走到 ≈208k（ATS 车道），`skipped_by_reason.outside_target_region` 归零
- 验收：active 260,314 → **≈319,000**；feed lag <15 min；`jobs` 与 `jobs_v3` gap 0
- 回滚：切回 `target`（已回补的行保留，不新增）

#### D4 · 地区维度重建（**本次新增的核心工作量**，1–1.5 天）
目标：**任意地区的岗位都能被筛选出来**，覆盖 ATS + legacy 两条车道共约 319k 条。

现状 `ai_match_region_scope()` 只认 us/uk/canada/australia/singapore/hong_kong，其余全部 NULL —— 不满足「所有地区可筛」。

**D4-1 数据结构（迁移 `0161_job_country_taxonomy.sql`）— ✅ 已上生产**
- `jobs_v3` 新增两列：
  - `country_code char(2)`：ISO-3166 alpha-2（`US`/`GB`/`CA`/`IN`/`DE`/…），无法识别为 NULL
  - `continent text`：**6 个大洲** `north_america` / `south_america` / `europe` / `asia` / `africa` / `oceania` / NULL
    （计划原先写的 `latin_america`/`middle_east` 是两个跨洲分组，做进大洲维度会让 `country_code` 与大洲不自洽，故统一为 ISO 大洲；EMEA/APAC/LATAM/Americas 一律 NULL，不猜）
- `public.job_country_taxonomy`：**1,610 条**种子（country / country_iso / alias / city / state 五类）。
  用 `kind` 区分真实冲突：`georgia` 既是美国州又是国家、`in` 既是 Indiana 又是 India 的 ISO-2、`london` 在 GB/CA 都有。
- `job_location_normalize(text)`：小写 + 去重音 + **去点号**（`st. louis`→`st louis`、`u.s.a.`→`usa`）+ 折叠空白。
- `job_country_code(region text) returns char(2)`：实际形态远比「四级」复杂，最终是**分层解析**：
  0. 带前导国家标记（`France > Rungis : Miami building` 是法国岗）→ 括号 ISO-2 → Workday 码（`US-CT-…`/`CA-QC-…`/`IN-KA-…`）
  1. 去噪切段：州前缀 `ut:`、首尾邮编、`(Headquarters)` 括号后缀、`office/hq/area/metro/state/corporate` 后缀（剥两遍）、`greater/all of/hybrid/remote/home based` 前缀、空格分隔符（`Remote - Canada`、`AZ - Chandler`）
  2. 末段国家（**该 token 同时是州名则跳过**：`London, United Kingdom` 不能变成 London, Ontario）→ 城市右→左 → 州/邮编（末段或末词 `Baldwin NY`；两字母 `in/ca/de/il` 由城市一致性裁决）→ 词级国家/双词地名/双词城市（`Mississauga Ontario Canada`、`Kowloon  Hong Kong`、`San Francisco or Palo Alto`）→ 段级兜底 → 显式 `us/uk/uae` 标记
  3. 都不中 → NULL，前端落「未归属地区」桶（`Remote`/`Worldwide`/`TBD` 等**本就该 NULL**）
- `job_region_continent(text)`：只判大洲的兜底（`North America`、`Asia Pacific`、`Middle East`），仅当国家为空时使用。
- 新增索引：`jobs_v3_country_active_idx` / `jobs_v3_continent_active_idx`，均为 `(列, created_at desc, id desc) where is_active`。
- `jobs_listing_v3` 视图重建补这两列（`select v.*` 在视图创建时冻结且 `CREATE OR REPLACE VIEW` 不能换序，只能 drop+create；已确认无依赖对象）。
- 触发器 `jobs_sync_country_code`（BEFORE INSERT OR UPDATE OF region）**只建在 `jobs_v3`**，这是对原计划的**有意偏离**：
  0149 的影子触发器是按位 `insert into jobs_v3 select n.*, lane, evidence`，给 `public.jobs` 加列会让 v3 尾部三列整体错位、**静默打断全部影子写**（处理器只 warn）。新列追加在 `canonical_job_id` 之后，由 BEFORE 触发器填；`public.jobs` 侧留到 C2 与显式列影子一起改。
- `region_market` / `ai_match_region_scope` **保持不变**（AI 选岗继续只用 6 个目标市场，符合决策 4）

**D4-2 回填（约 319k 行，分批 5,000 行/批）— ✅ 已跑完**
- `scripts/jobs-country-backfill.sql` + `.sh`，幂等，只补 `country_code is null` 的行；`set region = region` 是**故意的**（值不变但点名了 `update of region`，才会触发解析器）
- 实测 50 轮 / 约 2 分钟（每轮 5,000 行，1.8 s），与 D3 的 reconcile 并行无冲突
- **覆盖率**（2026-11-26 17:20 快照）：active 319,258 行 → 解析出 301,576 = **94.46%**；
  其中 7,477 行属于「本就无国家」（`Remote`/`Worldwide`/`Home based - EMEA`/`Location TBD`/`Any city`/`Nationwide`），
  **真正漏判 10,205 行**（长尾唯一字符串），**可归属覆盖率 = 301,576 / 311,781 = 96.75%** ✅
- 最大单条残差是 `Prolific Expert Network, Remote`（4,039 行，公司名+Remote，本就无国家）

**D4-3 API — ✅ 代码完成（待部署）**
- `/api/jobs` 新增参数：`country=US,GB,IN`（可重复/逗号分隔）、`continent=europe`（多选）；两者同时传是**取交集**（收窄），前端不会同时传
- 保留原有 `regions`（目标市场关键词）向后兼容，且 `region=` 优先于国家/大洲
- 新列只在 `jobs_v3`，所以：归档路径（`status=closed|all` 读 `public.jobs`）不适用；读切换关掉时自动降级（`countryIndex` 标志 + 42703/PGRST204 识别，同 region/target 的既有降级机制）
- 新增 `/api/jobs/filters`：208 行以内的国家 facet（`continent/country_code/country_name/jobs`），进程内缓存 10 min；底层是迁移 `0162_jobs_country_filter_counts.sql` 的 RPC（PostgREST 不支持 GROUP BY，所以用一个聚合函数，口径与列表查询完全一致：`is_active and display_status in ('listed','enriched')`）
- 实测 facet：158 个国家/地区、301,879 条可归属、`unplaced = 17,768`

**D4-4 前端筛选器 — 🔄 进行中**
- 地区筛选从「7 个目标市场」升级为：**大洲快捷 chips（带数量）+ 大洲分组的国家多选（可搜索，带数量）+「未归属地区」提示**
- 大洲 chips 与国家多选**互斥**（选大洲清空国家，选国家清空大洲），避免「欧洲 + 美国」这种交集为空的组合
- 未选任何地区 = 全部
- 保留原有目标市场快捷项（美国/英国/加拿大/澳洲/新加坡/香港），点一下等价于选中对应国家

**D4 验收**
- ✅ 覆盖率：可归属覆盖率 **96.75%**（原始 94.46%，差额是 7,477 行本就无国家的 remote 岗）；阈值 ≥95% 达标
- ✅ 抽样：`Bangalore, IN`→IN、`London, United Kingdom`→GB、`CA-QC-LONGUEUIL-J01…`→CA、`Remote`→NULL、`USA.VA.Reston`→US、`Warsaw, Poland`→PL、`Atlanta, Georgia`→US、`Tbilisi, Georgia`→GE —— 118 条断言在**生产库临时库**里 118/118 通过（`tmp/dryrun-0161.py`）
- ⏳ 每个国家筛选的返回数与 SQL 直查一致（误差 0）：待 API 部署后用 curl 抽查
- ✅ 迁移可回滚：回滚 DDL 写在迁移头注释里（drop 触发器/函数/索引/列 + 重建视图）

#### D5 · 展示与筛选放开（1–2 h）
- `/api/jobs` 的 `regionScope` 默认值 **`target` → `all`**（决策 2）
- `/jobs` 页面：默认展示全部地区；地区筛选器接 D4-3/D4-4
- 保留 `region_scope=target` 作为可选的「只看目标地区」快捷筛选
- 空状态/无结果文案同步更新
- 验收：`/jobs` 首屏 <2s；默认列表能看到印度/巴西岗位；选「美国」结果与 `country_code='US'` 直查一致

#### D6 · 观察 24h — ✅ 提前收口（2026-11-27 10:08，实跑约 17 h）
- feed lag、feed 成功率、reconcile 全 0、页面 200、磁盘
- 全部达标才进入 C
- **实际**：17 小时内看门狗每次 rc=0（`missing/extra/field_mismatches/missing_evidence/read_index_gaps` 全 0），feed lag 0.8–1.5 min，连续失败 0，`/api/health` 与 `/jobs` 均 200，无 5xx 抬升，磁盘未继续下滑 → 判定达标，经用户同意不再等满 24 h

### D 的停止线
- feed lag >15 min 持续 30 min → 暂停 D3（有游标，可断点续跑）
- feed 成功率 <99.5% 或新增岗位 `consecutive_failures` 上升 → 停
- 磁盘 <5 G → 停（先做 P0）
- 重复 `(source_key, external_job_id)` >0 → 停
- D4 覆盖率 <90% → 停，补城市字典后再回填

### D 的已知风险
1. **数据量 +23%**：同步耗时、索引、磁盘都要重估。所以 D3 分轮跑。
2. **归档页缺口**：`status=closed|all` 现在固定读 `public.jobs`，D 之后新关闭行只进 v3 → 归档页会缺新关闭岗位。**和 C2 的 §3.5 是同一问题，一起解决**：C2 回填 12.2 万关闭行到 v3，然后把归档读也切到 v3。在 C2 完成前，归档页暂不完整（接受 1–2 天）。
3. **城市→国家字典覆盖不到的长尾**：10,210 种 `country` 取值里必然有大量罕见城市。接受「未知地区」桶，不追求 100%。

---

## C. 方案 B（写切换）

设计已完成：[`docs/job-acquisition-write-switch-design.md`](job-acquisition-write-switch-design.md)。两个硬阻塞已定位：

1. **`jobs_v3` 上一个业务触发器都没有** —— `matches_target_region` / `job_ai_match_scopes` / `company_config_id` 都不会自动维护。直写会让新岗位 flag 为 NULL → 目录里看不见。
2. **`jobs_v3_id_seq.last_value = 325,404` 落后于 `max(id) = 382,313`** —— 直写必撞主键。修法：`jobs_v3.id` 默认值改共用 `nextval('jobs_id_seq')`。

| # | 动作 | 依赖 | 预计 |
|---|---|---|---|
| C1 | 设计稿 | — | ✅ 已完成 |
| **C2** | 迁移 `0163_jobs_v3_write_ready.sql` **已在生产执行**：① id 默认改共用 `jobs_id_seq`；② `lane` / `closure_evidence` / 搜索向量由 v3 自己的触发器派生；③ 3 个业务触发器迁到 v3；④ 正向影子改显式列 UPSERT、反向影子为 BEFORE ROW UPSERT + 回环守卫；⑤ 回填 99,369 关闭行；⑥ 对账 `job_ai_match_scopes`（+333 / −22 / ~137）。归档读切 v3 的代码已部署 | P0、D4 | ✅ 2026-11-27 |
| **C3** | `jobWriteTable()` + `JOBS_WRITE_SOURCE`，改 **14 个文件的 24 处写语句**；新增 `scripts/test-job-write-source.ts`。默认 `jobs`，生产行为不变，已部署 `ded06ab` | C2 | ✅ 2026-11-27 |
| C4 | 双向影子对账：反向探针已通过（事务内写 v3 → jobs 同 id/同 flag/同 scope，回滚后两侧 0 残留）；顺延 24h 零漂移观察中 | C3 | 观察中 |
| C5 | 切写 `JOBS_WRITE_SOURCE=v3`，反向影子常开，观察 7 天 | C4 | 7 d |
| C6 | 归档 `jobs` 表，**再释放 5.5 G** | C5 | 1 h |

### C2 执行记录（2026-11-27，已上生产）

先在生产的**临时库** `liorvix_c2_dryrun` 上完整跑通 37 条断言（pg_dump 只导 5 张相关表
的结构 + 相关函数/触发器定义，灌 5000 行合成岗位，人为把 v3 做成"影子落后 3000 行 + AI scope
漂移 240 行"的状态），确认后再上生产。生产执行结果：

| 阶段 | 实际 |
|---|---|
| DDL（第 1–5 段） | 独占锁亚秒级，一次提交成功 |
| 回填 99,369 行 | **165 s**（第一次按默认 `statement_timeout=1min` 被中断，DDL 已提交、回填整体回滚；迁移文件已内置 `set statement_timeout = 0`） |
| AI scope 对账 | 70 s，`+333 −22 ~137`（与事前实测漂移完全吻合） |
| `analyze` 两张表 | 26 s |
| 执行后 | `jobs` = `jobs_v3` = 452,193；两侧关闭行均 121,766；关闭行 100 % 带 `closure_evidence`；`lane_null=0`、`target_flag_drift=0`、`scope_presence_drift=0`、`scope_value_drift=0`、`search_drift=0`；看门狗 `missing=0 extra=0 field_mismatches=0 missing_evidence=0 read_index_gaps=0` |
| 归档 API（部署后） | `status=closed` 99,201、`status=all` 452,376、`closed+country=US` 69,418、`all+continent=europe` 46,942，全部 200 |

覆盖到的点：

| 断言组 | 结果 |
|---|---|
| `jobs_v3.id` 默认值 = `nextval('jobs_id_seq')` | ✅ |
| 直写 v3 → 反向影子进 `jobs` → 3 个业务触发器生效（lane=ats、country=US、continent、target flag、AI scope 行） | ✅ |
| 直写 `jobs` → 正向影子进 v3（lane=legacy、country 从 region 重新推导） | ✅ |
| 双向 UPDATE 互通、改 region 会同时改 country/continent/target flag/scope 行 | ✅ |
| 回填后 `jobs` 与 `jobs_v3` 行集合一致、关闭行仍关闭、关闭行带 `closure_evidence` | ✅ |
| `ai_match_search` 两表向量完全一致（`jobs` 是生成列，v3 用触发器同步） | ✅ |
| `job_ai_match_scopes` 与 region 解析函数逐行一致（注入 240 行漂移后修好） | ✅ |
| 删 v3 行**不会**级联删 `jobs`（保护 12 张 FK 的用户数据），删 `jobs` 行会清掉 v3 镜像 | ✅ |
| 迁移幂等：第二次执行 `normalised 0 / backfilled 0 / +0 -0 ~0` | ✅ |

两个设计取舍（与最初设计的差异）：

1. **拆成两个事务**。DDL 段在自己的事务里（`jobs_v3` 的 ACCESS EXCLUSIVE 锁只持续亚秒级），
   回填段单独成事务——否则 9.9 万行 × 每次 5 个触发器 + 回 v3 的 upsert 会一直压着排他锁。
   实测临时库 1000 行回填 509 ms，线性外推生产约 50 s。
2. **`ai_match_search` 不走影子列**：`public.jobs` 上它是 `GENERATED ALWAYS` 列，任何
   INSERT/UPDATE 列清单里都不能出现它，所以正/反向影子都把它排除，改由 v3 的
   `jobs_v3_sync_search` 触发器算同一个表达式。

**回滚材料**：回填前已建 `public.jobs_v3_c2_undo`（99,369 个 id，已开 RLS），撤销回填
`delete from public.jobs_v3 v using public.jobs_v3_c2_undo u where v.id = u.id;`；DDL 回滚见迁移头部。

### C3 执行记录（2026-11-27，已部署，生产行为未变）

- 新模块 `src/lib/job-write-source.ts`：`jobWriteTable()`（默认 `jobs`）、`jobWriteIsV3()`、
  `jobDeleteTables()`（`v3` 时返回 `['jobs_v3','jobs']`）。读、写两个开关**刻意分开**：
  `JOBS_READ_SOURCE` 已经在 `v3`，`JOBS_WRITE_SOURCE` 未设。
- 24 处写语句全部改走 `jobWriteTable()`：14 个文件（`job-sync.ts` 4 处、`[id]/route.ts` 3 处、
  `job-maintenance.ts` 3 处、`jobs-feed.ts` 2 处，其余各 1 处）。**只改写、不改读**。
- **两处硬删除**（`DELETE /api/jobs/[id]`、批量删除）改为遍历 `jobDeleteTables()`：前向影子会把
  `jobs` 的删除同步到 v3，但反向影子**故意不镜像 DELETE**，只删 v3 会留下 jobs 残行并让对账报
  `missing`。
- 顺手修掉 C2 遗留：`scripts/test-job-read-source.ts` 里「归档必须读 `public.jobs`」的三条断言在
  0163 回填后已经不成立（会误报失败），改为断言归档跟随读开关、且把 open/close 路由钉在**写开关**上。
- `scripts/test-job-write-source.ts`：开关默认/回滚/大小写/读写互不影响；14 个文件的写点数量与
  import；删除路径必须走 `jobDeleteTables()`；写模块不得引用 `jobReadTable`；开关必须每次读环境变量。
- 验收：两个契约测试全绿；`tsc` 只剩既有的 `.next/dev/types/app/probe-plain` 报错；
  岗位相关 15 个测试用例 13 绿，2 红（`test-jobs-feed-location`、`test-job-field-policy`）**在 C3 之前的
  HEAD `7d9b89c` 上同样红**，与本改动无关。

**C 与 D 的关系**：C6 释放的 5.5 G 覆盖 D 的数据增长，所以顺序是 **P0 → D → C**，不必单独扩容。
**迁移编号**：D4-1 用 `0161`，D4-3 的 facet RPC 用 `0162`（占用后 C2 顺延为 `0163`）。

---

## 顺序与时间线

```
（实际执行节奏见下方进度账本；下面是原始估算）
今天 16:00 ─┬─ P0 磁盘清洁                30–45 min
            ├─ D1 缺口量化（只统计）       1–2 h
            ├─ D2 去过滤 + 契约测试         1 h
            └─ D3 全量回补（分轮）          2–4 h
今天 晚间   ── D4-1 迁移 + D4-2 回填（覆盖率迭代）
明天 上午   ── D4-3 API + D4-4 前端筛选器
明天 下午   ── D5 默认全量展示 + D6 观察
后天        ── C2 迁移（合并触发器）+ C3 代码
+1 天       ── C4 对账
+7 天       ── C5 切写 → C6 归档 5.5 G
```

**可并行**：D4（读路径/前端）与 C2（DB 迁移）改的文件不重叠。
**不建议并行**：D3（大量写入）与 C2/C3（改写入路径）同时上。

---

## 交付物清单

| 类型 | 路径 |
|---|---|
| 计划 | `docs/job-acquisition-plan-v3.md`（本文） |
| 写切换设计 | `docs/job-acquisition-write-switch-design.md` |
| 进度日志 | `docs/job-acquisition-progress.md` |
| 迁移 | `supabase/migrations/0161_job_country_taxonomy.sql`、`0162_jobs_country_filter_counts.sql`、`0163_jobs_v3_write_ready.sql` |
| 代码 | `src/lib/jobs-feed.ts`、`src/lib/job-region-scope.ts`、`src/app/api/jobs/route.ts`、`src/app/jobs/*`、`src/lib/job-write-source.ts`（新） |
| 脚本 | `scripts/test-job-feed-region-filter.ts`、`scripts/jobs-country-backfill.sql`、`scripts/test-job-write-source.ts` |

---

## 已完成（本会话）

- **A 地区识别修复**：迁移 `0160` + 回填 90,368 行；默认目录可见 60% → 92.7%（+72,931 条）。commit `fcf243a`。
- **B 扩到 3,007 board**：探测/冻结工具 + 22 项契约测试；上游 1,500 → 3,007；active 222,473 → 258,739（+16.3%）。commit `8d3289a`、`7b6ca9c`。
- **C1 写切换设计稿**。commit `e20bacb`。
