# V01 / V02 生产放量报告（500 board）

> 日期：2026-11-24（UTC 11:31–11:56）
> 分支：`feat/bulk-p0`；上游无 git；美国站 `c5b979b`
> 结论：**G1 通过**；V02 进入 48 小时观察期（不提前宣告完成）。

## 1. V01：50 board 生产写 canary

### 上游

| 指标 | 值 |
|---|---:|
| active boards | 50 |
| board poll runs | 150 |
| 成功 / 失败 | 150 / 0 |
| 写入岗位（`source_key` 非空） | 44,234 |
| 其中 OPEN / CLOSED | 44,234 / 0 |
| `jobs_new` 累计 | 43,827 |
| 重复 `(source_key, external_job_id)` | 0 |

- 写入前：jobs 408,530，`source_key` 0。
- 写入后：jobs 452,357，`source_key` 44,234。
- `BULK_BOARD_WRITE=true`，`BULK_BOARDS_ENABLED=true`，`FEED_V2_ENABLED=true`。
- 50 个 board 全部为 list-only（列表字段）；官方申请链接、标题、公司、地点齐全。
- 抽查 20 条：官方 URL 均可打开；没有用猜测补 description / salary / deadline。

### 美国站

| 指标 | 值 |
|---|---:|
| active jobs（同步前） | 138,356 |
| v2 岗位（`source_key` 非空） | 27,697 |
| v2 字段空值（20 抽样） | 0 |
| `is_list_only` | 27,697 |
| `display_status` | `listed` |

- 抽样 20 条：`source_key/apply_url/source_updated_at/first_seen_at/last_seen_at/snapshot_id/source_tier/is_list_only` 全部非空。
- 示例：Accenture Federal Services / ServiceNow Sr. Business Analyst / Chantilly, VA / `https://boards.greenhouse.io/accenturefederalservices/jobs/4707352006`。
- 美国站 v2 字段写入路径已由真实 feed 验证，不是只跑单测。

### V01 验收

| 项 | 目标 | 实际 | 结果 |
|---|---:|---:|---|
| 写生产 board | 50 | 50 | 通过 |
| 新增岗位 | ≥2,000 | 44,234 | 通过 |
| US 抽样官方 URL/标题/公司/地点 | 20/20 | 20/20 | 通过 |
| bulk 误关 | 0 | 0 | 通过 |
| 服务可用 | 200 | 200 | 通过 |

## 2. V02：500 board 放量

### 上游

导入命令（dry-run 后 apply）：

```bash
docker exec -e PYTHONPATH=/app global-jobs-bulk-worker-1 \
  python /tmp/import_boards.py --csv /tmp/p0-boards.csv --limit 500 --apply
```

导入结果：

| 项 | 值 |
|---|---:|
| CSV 行 | 500 |
| 已存在 board | 50 |
| 新增 board | 450 |
| 名称匹配公司 | 43 |
| 域名匹配公司 | 8 |
| 新建 `Bulk ATS` 公司 | 449 |
| active companies | 169 → 不变（新增公司 `is_active=false`） |

放量后（UTC 11:56 快照）：

| 指标 | 值 |
|---|---:|
| active boards | 500 |
| board poll runs | 528 |
| 成功 / 失败 | 528 / 0 |
| 有岗位的 source_key | 373 / 500 |
| `source_key` 岗位 | 89,144 |
| 其中 OPEN / CLOSED | 89,144 / 0 |
| `jobs_new` 累计 | 88,737 |
| 重复 `(source_key, external_job_id)` | 0 |
| 误关 | 0 |

- 500 个 board 中 127 个当前无公开岗位；不是失败，run 仍为 success，`posting_count=0`。
- 48 小时观察从 **2026-11-24 11:50 UTC** 开始；观察项：成功率、P95 新鲜度、误关、重复、stale 比例、单岗成本。
- 观察期内不再提高 active board 数；不启用美国站 `JOB_TTL_ENABLED`，避免把“尚未同步”误判为 stale。

### V02 新鲜度口径

- **board 级 P95 = 16.0 分钟**（500 个 active board 的 `now()-last_ok_at`，UTC 12:06 快照），满足 G1 的 ≤60 min，也满足目标 ≤30 min。
- 观察 1 小时后复测：**P95 17.4 min，max 37.8 min**；1,546 次 run 中 1 次 502（Lever `simonmed`），成功率 **99.94%**，无 CLOSED、无重复。
- 那次 502 没有触发关闭：失败只增加 `consecutive_failures` 并按退避重试，`source_closed` 仍为 0。
- **不能用岗位 `last_seen_at` 直接算 P95**：U05 为了减少同日无变化写入，保留同日 `last_seen_at`，所以岗位字段会停在首次写入时间；board `last_ok_at` 才是轮询新鲜度。
- Feed 侧以 `job_sync_runs.completed_at` / `job_sync_state.last_incremental_success_at` 为准，不以 `jobs.last_seen_at` 为准。
- 12:29 UTC 美国站 `collector_feed` 最近成功 12:24 UTC，**feed lag 约 5 min**，低于 15 min；US source jobs 86,479，已接近上游全部 source jobs。
- 12:59 UTC 复核：US 已覆盖 **全部 500 个 `source_key`，缺失 key = 0**；US 86,484 vs 上游 126,159，差 39,675。差额不是丢数据，而是 US `normalizeSkipReason` 对 `outside_target_region` 的主动过滤（上游是 global board，US 只收目标地区）。这解释了“上游 12 万、US 8.6 万”的差异，不能拿上游总数直接当 US 应到数。

### 美国站同步

- 手动 increment 已回填 27,697 条 v2 岗位（77 页，38,500 收到，27,177 upsert，0 失败）。
- 美国站服务已恢复，worker 继续按 5 分钟增量追赶剩余 450 board 的新岗位。
- Feed v2 客户端默认开启；v1 回退仍可用 `JOBS_FEED_V2_ENABLED=false`。
- 没有因为同步/字段缺失改变任何 `is_active/is_closed`。

### 2026-11-25 03:00–03:40 UTC 复检与事故修复

- 上游 board：**500 active，0 paused**；最近 25,949 次 run 中失败 30 次，**成功率 99.884%**，仍在 ≥98% 目标内。
- board 新鲜度：P95 **29.2 min**，按岗位加权 P95 **27.3 min**，max 29.4 min；`lb-capital` 的 Lever 502 已恢复，当前无连续失败 board。
- `source_closed` 从 0 变为 **8**：全部为 `greenhouse:doordashusa`，close 时间 2026-11-24 16:48/23:10 UTC，reason `source_missing_on_complete_crawl`。逐条用 Greenhouse 公开 API 核对，8 个 ID 当前均不在 DoorDash board 的 399 条列表中；属于**合法关闭**，不是误关。误关率仍按 0 计。
- 美国站发现并修复一次 **feed 卡死**：`collector_feed.last_incremental_success_at` 停在 **2026-11-24 15:39 UTC**，原因是上游 feed 同时携带 411,505 条无 `source_key` 的 legacy 官方源岗位；这些行 `source_tier=null`，美国 schema 的 `jobs.source_tier` 为 NOT NULL，导致每页 `invalid_sync_record` 写入失败，cursor 无法完成一轮成功。
- 修复：`normalizeFeedItem` 在 v2 模式拒绝无 `source_key` 的 legacy 行；`normalizeSkipReason` 标记 `not_ats_source`。已部署 **f163324 → 3767e0f**，生产 health/login/admin 烟测通过。
- 修复后新 run（195113/195117）连续 30+ 页、15,000+ 条，**row_failures=0**，`not_ats_source` 正常计数；卡死 cursor 从 17:38 继续前进。`last_incremental_success_at` 会在追平后更新，当前仍在追赶，**不能据此判定 G2 通过**。
- 02:00–03:00 UTC 美国站另有 529 条 legacy 岗位被 feed close 信号关闭（526 条无 `source_key`，主要为 Workday/Amgen 等）；初步判断为上游 legacy 关闭事件回放，不是 P0 `source_key` 误关。需按 close 事件来源单独审计，暂不反向恢复。

## 3. Gate 判定

| Gate | 条件 | 判定 |
|---|---|---|
| G1 | 500 production board；≥2k 岗位；US 抽样 20；0 误关 | **通过** |
| G2 | 1,500 board + Feed v2 + 48h 指标 | 未开启（当前 500） |

## 4. 风险与回滚

- 上游回滚镜像：`global-jobs-api/worker/beat:pre-u07` = `342cc0aa7c26`；本次新增 board/jobs 可按 `source_key` 删除。
- 美国站回滚：`sudo /usr/local/bin/liorvix-rollback 924ae747a3cc8d819bf6a812ebea5a6ee277e09e`（部署前 release）。
- 美国站迁移 0140/0141 additive；回滚代码不删除列，避免破坏已写入的 v2 数据。
- 下一步：48h 观察 + D07（2,000 active 探测）+ 剩余 450 board 的 US 全量同步；G2 前不继续放量。