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

**D4-1 数据结构（迁移 `0161_job_country_taxonomy.sql`）**
- `jobs_v3` 新增两列：
  - `country_code char(2)`：ISO-3166 alpha-2（`US`/`GB`/`CA`/`IN`/`DE`/…），无法识别为 NULL
  - `continent text`：`north_america` / `latin_america` / `europe` / `middle_east` / `africa` / `asia` / `oceania` / NULL
- 新增函数 `job_country_code(region text) returns char(2)`，按**优先级四级解析**：
  1. `City, XX, <国家名/国家码>` 三段式（已有逻辑可复用）
  2. 国家名 / ISO 国家码全表匹配（约 250 个）——注意 `CA`/`IN`/`DE`/`GA` 等歧义码要靠上下文消歧
  3. **城市→国家字典**（约 300–500 个高频城市：London/Paris/Berlin/Bangalore/Toronto/São Paulo/…）
  4. 美国州码 / 加拿大省码 / 澳洲州码 → `US`/`CA`/`AU`
  - 仍无法解析 → NULL，前端落到「未知地区」桶
- 新增索引：`(country_code, created_at desc, id desc) where is_active` 和 `(continent, created_at desc, id desc) where is_active`
- `jobs_listing_v3` 视图补这两列
- 触发器 `jobs_sync_country_code`（BEFORE INSERT OR UPDATE OF region）维护，**同时建在 `public.jobs` 和 `jobs_v3` 上**（与 C2 的触发器迁移一起做，避免重复回填）
- `region_market` / `ai_match_region_scope` **保持不变**（AI 选岗继续只用 6 个目标市场，符合决策 4）

**D4-2 回填（约 319k 行，分批 5,000 行/批）**
- `scripts/jobs-country-backfill.sql`，幂等，只补 `country_code is null` 的行
- 目标：**≥95% 的 active 行解析出 country_code**；剩余落「未知地区」

**D4-3 API**
- `/api/jobs` 新增参数：`country=US,GB,IN`（多选）、`continent=europe`（多选）
- 保留原有 `regions`（us/uk/… 目标市场关键词）向后兼容
- 新增 `/api/jobs/filters`（或复用现有 meta 接口）返回**可用国家列表 + 每国数量**，供筛选器渲染
- 排序/分页仍走新索引

**D4-4 前端筛选器**
- 地区筛选从「6 个目标市场」升级为：**大洲分组 + 国家多选（可搜索）+「未知地区」**
- 保留原有快捷项（美国/英国/加拿大/澳洲/新加坡/香港），点一下等价于选中对应国家
- 未选任何地区 = 全部

**D4 验收**
- 覆盖率：`select count(*) filter (where country_code is not null)::float / count(*) from jobs_v3 where is_active` **≥ 0.95**
- 抽样：`Bangalore, IN`→IN、`London, United Kingdom`→GB、`CA-QC-LONGUEUIL-J01…`→CA、`Remote`→NULL、`NY, New York`→US、`Warsaw, Poland`→PL
- 每个国家筛选的返回数与 SQL 直查一致（误差 0）
- 迁移可回滚：`drop column`（视图先重建）

#### D5 · 展示与筛选放开（1–2 h）
- `/api/jobs` 的 `regionScope` 默认值 **`target` → `all`**（决策 2）
- `/jobs` 页面：默认展示全部地区；地区筛选器接 D4-3/D4-4
- 保留 `region_scope=target` 作为可选的「只看目标地区」快捷筛选
- 空状态/无结果文案同步更新
- 验收：`/jobs` 首屏 <2s；默认列表能看到印度/巴西岗位；选「美国」结果与 `country_code='US'` 直查一致

#### D6 · 观察 24h
- feed lag、feed 成功率、reconcile 全 0、页面 200、磁盘
- 全部达标才进入 C

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
| **C2** | 迁移 `0162_jobs_v3_write_ready.sql`：① id 默认改共用序列；② 3 个业务触发器迁到 v3；③ `lane` 加默认；④ 反向影子 + 回环守卫（`liorvix.reverse_shadow` session 变量）；⑤ 提交 12.2 万关闭行回填到 v3（归档读一并切 v3） | P0、D4（触发器可合并到同一迁移批次） | 4–6 h |
| C3 | `jobWriteTable()` + `JOBS_WRITE_SOURCE`，改 8 个写文件；新增 `scripts/test-job-write-source.ts` | C2 | 3 h |
| C4 | 双向影子对账 24h | C3 | 24 h 观察 |
| C5 | 切写 `JOBS_WRITE_SOURCE=v3`，反向影子常开，观察 7 天 | C4 | 7 d |
| C6 | 归档 `jobs` 表，**再释放 5.5 G** | C5 | 1 h |

**C 与 D 的关系**：C6 释放的 5.5 G 覆盖 D 的数据增长，所以顺序是 **P0 → D → C**，不必单独扩容。
**迁移编号**：D4 用 `0161`，C2 用 `0162`（避免撞号）。

---

## 顺序与时间线

```
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
| 迁移 | `supabase/migrations/0161_job_country_taxonomy.sql`、`0162_jobs_v3_write_ready.sql` |
| 代码 | `src/lib/jobs-feed.ts`、`src/lib/job-region-scope.ts`、`src/app/api/jobs/route.ts`、`src/app/jobs/*`、`src/lib/job-write-source.ts`（新） |
| 脚本 | `scripts/test-job-feed-region-filter.ts`、`scripts/jobs-country-backfill.sql`、`scripts/test-job-write-source.ts` |

---

## 已完成（本会话）

- **A 地区识别修复**：迁移 `0160` + 回填 90,368 行；默认目录可见 60% → 92.7%（+72,931 条）。commit `fcf243a`。
- **B 扩到 3,007 board**：探测/冻结工具 + 22 项契约测试；上游 1,500 → 3,007；active 222,473 → 258,739（+16.3%）。commit `8d3289a`、`7b6ca9c`。
- **C1 写切换设计稿**。commit `e20bacb`。
