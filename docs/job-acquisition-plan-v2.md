# 执行计划 v2（2026-11-26 15:45 +08 起）

> 变更来源：用户 2026-11-26 15:24 新需求
> ① 取消「源头采集站 → 主站」的目标地区过滤，**全量同步**；
> ② 方案 B（写切换）确认要做；
> ③ 磁盘做一次清洁。
>
> 本版替换 `docs/job-acquisition-next-phase-execution-plan.md`。A（地区识别修复）与 B（扩到 3,007 board）已完成，见文末「已完成」。

---

## 0. 现在的真实位置（生产实测，2026-11-26 15:30 +08）

| 指标 | 数值 | 备注 |
|---|---:|---|
| 本站 active 岗位 | **260,314** | ATS 车道 149,051 + legacy 车道 111,263 |
| 本站可见（默认目录） | **243,543** | `matches_target_region = true` |
| 本站已存但不可见 | **16,771** | 主要是印度/巴西等非目标地区 |
| 上游 OPEN 岗位 | **390,507** | **ATS 车道 208,391**（GH 138,167 / Lever 48,301 / Ashby 21,923）+ legacy 车道 181,549 |
| **ATS 车道缺口** | **≈ 59,340** | 208,391 − 149,051，就是被地区过滤器丢掉的量 |
| 上游 board | 3,007 | 0 failing，近 30 分钟 2,097 次轮询全 success |
| feed lag | 峰值 8.6 min / 常态 4–6 min | 停止线 15 min |
| 磁盘 | 42 G / 50 G，**剩 5.9 G** | 主要占用：`/var/log 3.4G`、`/opt/liorvix-backups 6.0G`、`/opt` 陈旧备份 3.1G、`jobs` 5.5G + `jobs_v3` 3.5G |
| `jobs` 表 | 382,541 行 / 5,501 MB | 其中 inactive 122,227 行（归档页要用） |
| `jobs_v3` 表 | 281,444 行 / 3,503 MB | 死元组仅 4.3%，`VACUUM FULL` 收益有限（膨胀不是主因，TOAST 是真数据） |

**关键结论**：
1. 地区过滤丢的是 **ATS 车道 59,340 条**，不是全部 130k —— legacy 车道（`official:*` 连接器）本来就没有地区过滤，133,633 行已经含非目标地区。
2. 「全量」后的合理预期：**active 260,314 → 约 319,000（+23%）**。
3. 磁盘清理的真实收益在**日志和旧备份**，不在 `VACUUM FULL`。

---

## P0. 磁盘清洁（前置，最先做）

**为什么最先做**：D 会新增约 59k 行（≈ +0.8–1.7 GB 双写），C2 要向 v3 回填 12.2 万关闭行（≈ +1.5 GB）。5.9 GB 不够，必须先腾出空间。

| # | 动作 | 预计释放 | 风险 |
|---|---|---:|---|
| P0-1 | `journalctl --vacuum-size=300M`（当前 2.9 G，只保留最近日志） | **+2.6 G** | 无（丢失 >7 天日志） |
| P0-2 | `/var/log/nginx/supabase.access.log.1` 等轮转文件压缩/清理（168 M） | +0.15 G | 无 |
| P0-3 | `truncate -s 0 /var/log/btmp /var/log/btmp.1`（129 M 全是扫描器登录失败记录） | +0.13 G | 无 |
| P0-4 | `/opt/liorvix-backups` 保留最近 2 份全库 dump + 1 份 v3 切换前 dump，删 8 份 11-23/11-24 旧 dump 和 2 份 `jobs-pre-0140-*`（5.7 G → ~2.1 G） | **+3.6 G** | 低（保留最新 + 上一份） |
| P0-5 | 删 `/opt` 下 2026-09 陈旧备份：`liorvix-backup-20260907-preview`(1.4G)、`-preview-v2`(196M)、`-1656`(282M)、`backup-before-phase4d.tar.gz`(271M)、`phase1-backup.tar.gz`(40M)、`pre-admin-20260830.tar.gz`(39M)、`rollback-resume-switch-20260909.tar.gz`(20M) | **+2.25 G** | 低（3 个月前） |
| P0-6 | 删 `/opt/liorvix-build`（908 M，Nov 24 构建中间产物，可重建） | +0.9 G | 低（先确认无进程占用） |
| P0-7 | `docker image prune -f`（悬空镜像 0 个，预计无收益；**不动**在用的 5 个镜像） | 0 | — |

**目标**：5.9 G → **约 15 G**
**验收**：`df -h` ≥15 G 可用；`systemctl status liorvix` active；`/ /jobs /ai-match` 全 200；`docker ps` 5 个容器都在；最新 dump 用 `pg_restore --list` 验证可读。
**回滚**：不可回滚（删除类操作）。所以 P0-4/P0-5/P0-6 **删除前先把清单和 sha256 记进文档**，并保留最新一份可用备份。

---

## D. 全量同步改造（本次主体）

### 现状根因
两处代码把非目标地区岗位丢弃：

| 位置 | 现在的行为 |
|---|---|
| `src/lib/jobs-feed.ts:713` `normalizeSkipReason()` | 地区不在 us/uk/ca/au/sg/hk → 返回 `outside_target_region`，**整条丢弃** |
| `src/lib/jobs-feed.ts:542` `buildJobRecord()` | 同一判断，第二次早退返回 null |

legacy 车道（`src/lib/job-connectors/sync.ts`）**没有**地区过滤，不用改。

### 还有一个必须解决的难点：增量游标追不回历史
增量同步按上游 `updated_at` 游标推进。被丢弃的 59k 条**上游 `updated_at` 不会再变**，所以「改完过滤等它自然同步进来」是**无效的**。

好消息：系统里已经内置了**全量对账模式**（`mode='reconcile'`），有独立游标 `reconcile_cursor`、页数上限 1000、6 小时过期保护、`JOBS_ALLOW_FULL_RECONCILE=true` 开关，走完一次就把历史全部重放一遍。**D3 直接复用这个模式，不自己另写一套回补逻辑**。

### 步骤

| # | 动作 | 产出/验收 | 回滚 |
|---|---|---|---|
| **D1** | 量化精确缺口：加 `JOBS_FEED_REGION_FILTER=count` 模式（`count` = 照常遍历、对原本被区域过滤的行只计数不写），跑一轮 reconcile 遍历 | 得到 `outside_target_region` 精确条数与按国家分布（预期 ≈59k，印度/英国/加拿大/欧洲为主） | 删 flag |
| **D2** | 加开关 `JOBS_FEED_REGION_FILTER`（`target` 默认 / `all` / `count`），改 `normalizeSkipReason` 与 `buildJobRecord` 两处 | `npx tsx scripts/test-job-feed-region-filter.ts` 全绿（新增契约测试）；`tsc` 通过 | 删 flag 重启 |
| **D3** | 切 `all` + `JOBS_ALLOW_FULL_RECONCILE=true`，跑一次完整 reconcile 回补 | `reconcile_open_seen` 走到 ≈208k（ATS）；`active` 260,314 → **≈319k**；feed lag <15min；`skipped_by_reason.outside_target_region` 归零 | 切回 `target`（已回补的行不删，只是不新增） |
| **D4** | 展示侧放开：`/api/jobs` 的 `regionScope` 默认 `target` → `all`；地区筛选器增加「全部 / 不限地区」入口，保留原目标地区筛选 | 目录默认能看到非目标地区岗位；原有美国/英国等筛选不变；`/jobs` 页面 200 且首屏 <2s | 改回默认 `target` |
| **D5**（可选） | 地区桶扩容：`ai_match_region_scope()` 增加 `india` / `europe` / `other`，回填 `job_ai_match_scopes` | 筛选器能选「印度」「欧洲」；非目标地区不再全部落 NULL | 还原函数 + 重跑回填 |
| **D6** | 观察 24h：feed lag、feed 成功率、reconcile 全 0、页面、磁盘 | 全部达标才进入 C | — |

### D 的停止线
- feed lag >15 min 持续 30 min → 暂停 D3（reconcile 有游标，可断点续跑）
- 新增岗位 `consecutive_failures` 上升 / feed 成功率 <99.5% → 停
- 磁盘 <5 G → 停（先做 P0）
- `outside_target_region` 回补导致重复 `(source_key, external_job_id)` >0 → 停

### D 的关键风险
1. **数据量 +23%**：同步耗时、索引、磁盘都要重估。D3 前先把 reconcile 单轮页数调小（例如每轮 100 页 = 5 万条），跑 2–3 轮，每轮之间观察 10 分钟，避免一次性 59k 插入把 feed lag 打穿 15 min。
2. **归档页会缺新关闭岗位**：`status=closed|all` 现在固定读 `public.jobs`。D 之后新关闭行只进 v3 → 归档页缺失。这个和 C 的 §3.5 是同一个问题，**建议和 C2 一起解决**（回填 12.2 万关闭行到 v3，然后把归档读也切到 v3）。
3. **AI 选岗的口径**：`job_ai_match_scopes` 只维护 6 个目标市场，非目标地区岗位不会进 scope → AI 选岗不会推荐印度岗位。**建议保持不变**（产品逻辑：AI 选岗按用户目标地区推荐），只让目录能看全量。**需要你确认。**

---

## C. 方案 B（写切换）

设计已完成：[`docs/job-acquisition-write-switch-design.md`](job-acquisition-write-switch-design.md)。这里只列排程和两个已定位的硬阻塞。

| # | 动作 | 依赖 | 预计 |
|---|---|---|---|
| C1 | 设计稿（已完成） | — | ✅ |
| **C2** | 迁移 `0161_jobs_v3_write_ready.sql`：① `jobs_v3.id` 默认改 `nextval('jobs_id_seq')`（现 `jobs_v3_id_seq.last_value=325,404` 落后于 `max(id)=382,313`，直写必撞主键）；② 把 3 个业务触发器迁到 v3（`matches_target_region` / `job_ai_match_scopes` / `company_config_id` —— v3 上现在**一个触发器都没有**，直写会让新岗位 flag 为 NULL → 目录里看不见）；③ `lane` 加默认；④ 反向影子 + 回环守卫 | P0 腾出 ≥10 G | 4–6 h |
| C3 | `jobWriteTable()` + `JOBS_WRITE_SOURCE`，改 8 个写文件；新增 `scripts/test-job-write-source.ts` | C2 | 3 h |
| C4 | 双向影子对账 24h（现有 reconcile 反向跑） | C3 | 24 h 观察 |
| C5 | 切写 `JOBS_WRITE_SOURCE=v3`，反向影子常开，观察 7 天 | C4 | 7 d |
| C6 | 归档 `jobs` 表，**再释放 5.5 G** | C5 | 1 h |

**C 的额外收益与 D 的关系**：C6 释放的 5.5 G 正好覆盖 D 的数据增长。所以顺序上 **P0 → D → C**，不必为 D 单独扩容磁盘。

---

## 顺序与时间线

```
今天 15:45 ─┬─ P0 磁盘清洁          30–45 min
            ├─ D1 缺口量化           1–2 h
            ├─ D2 去过滤 + 契约测试   1 h
            ├─ D3 全量回补          2–4 h（含观察）
            └─ D4 展示放开           1–2 h
明天 上午   ── D6 观察 24h
明天 下午   ── C2 迁移 + staging 夹具验证
后天        ── C3 代码 + C4 对账
+7 天       ── C5 切写 → C6 归档 5.5 G
```

**可以并行**：D4（前端/读路径）与 C2（DB 迁移）改的文件不重叠，可同时进行。
**不建议并行**：D3（大量写入）与 C2/C3（改写入路径）同时上，风险叠加。

---

## 需要你拍板（4 个）

1. **P0 删除范围**：`/opt/liorvix-backups` 保留「最新 1 份 + 上一份 + v3 切换前 1 份」够不够？还是要求保留 7 天内的全部 dump（那样只能释放 ~2 G，达不到 15 G 目标）？
2. **D4 展示形态**：目录默认显示全部地区（含印度/巴西/日韩），地区筛选器保留目标 6 地区 + 新增「其他」分组 —— 还是默认仍只显示目标地区、另加一个「显示全球岗位」开关？
3. **D5 要不要做**：给非目标地区建 market 桶（印度/欧洲/其他），让筛选器可选。不做的话这 59k 条在筛选时只能落到「全部」。
4. **AI 选岗口径**：非目标地区岗位是否要进 AI 选岗推荐池？建议**不进**（保持按用户目标地区推荐），目录能看全量即可。

---

## 已完成（本次会话内）

- **A 地区识别修复**：迁移 `0160` + 回填 90,368 行；默认目录可见 60% → 92.7%（+72,931 条）。commit `fcf243a`。
- **B 扩到 3,007 board**：新增探测/冻结工具 + 22 项契约测试；上游 1,500 → 3,007；active 222,473 → 258,739（+16.3%）。commit `8d3289a`、`7b6ca9c`。
- **C1 设计稿**：commit `e20bacb`。
