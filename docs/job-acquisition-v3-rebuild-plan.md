# 岗位库 v3 影子重建与 Feed 精简计划

> 状态：Phase 0 完成（R01/R02/R04 完成；R03 代码已完成、外部告警器待接）；Phase 1 完成；Phase 2 进行中；Phase 3 回填完成；Phase 4 影子写入进行中
> 制定时间：2026-11-25 12:10（北京）/ 04:10 UTC
> 适用范围：上游采集器 + 美国站岗位库 + `collector_feed`
> 原则：**不清空生产库；不重抓 500 个 board；影子重建、对账后切换；旧库只读保留 7 天。**

## 0. 当前基线

### 0.1 上游

| 项 | 当前 |
|---|---|
| active board | 500（GH 400 / Lever 100） |
| `source_key` 岗位 | 127,869 OPEN / 8 CLOSED |
| 累计新增 | 127,470 |
| board runs | 26,657 |
| 失败 run | 30（成功率 99.887%） |
| board P95 | 29.2 min |
| 岗位加权 P95 | 27.3 min |
| `source_dupes` | 0 |
| 8 个 CLOSED | 全部 `greenhouse:doordashusa`，已用官网 API 验证为合法关闭 |

### 0.2 美国站

| 项 | 当前（2026-11-25 04:08 UTC） |
|---|---|
| active 岗位 | 199,192 |
| 其中 ATS `source_key` | 87,231 |
| 其中 legacy | 111,961 |
| 精确重复 `(source_key, external_job_id)` | 0 |
| `jobs` 总行数 | 321,102 |
| 数据库大小 | 5,582 MB |
| `jobs` 大小 | 5,293 MB（索引 977 MB，其余为描述 TOAST） |
| 磁盘剩余 | 约 14 GB |

### 0.3 Feed 现状

- 2026-11-24 15:39 UTC 起曾因 legacy 行 `source_tier=null` 卡死约 12 小时；
- 已部署 `f163324`、`3767e0f` 修复；
- 2026-11-25 04:05:16 UTC，run `195152` **success**，2 页、807 条、406 upsert、79 closed、0 row failure；
- 当前 feed 已追平（success 每 5 分钟滚动），但**结构性风险仍在**：ATS 与 legacy 混流、30 页 partial、坏行重试、单一 `last_success` 语义。

## 1. 目标与非目标

### 目标

1. 美国站岗位库从“混合表 + 混流 feed”迁到 **v3 双 lane 单一写入**结构；
2. 上游 ATS feed 只发送 `source_key is not null` 的岗位，候选量从 539k 降到约 128k；
3. feed 区分 `steady` / `catch-up`，成功判定用 watermark，不再出现“每轮 partial、成功时间冻结”；
4. 坏行进入 dead-letter，不再无限重试；
5. 保留现有 legacy 岗位，不丢 11 万条覆盖；
6. 切换可回滚，旧库保留 7 天。

### 非目标

- 不 `TRUNCATE public.jobs`；
- 不重新抓取 500/1,500 个 board（上游已有快照，重抓更慢且更易失败）；
- 不改变上游 500 board 轮询、分层退避和生命周期规则；
- 不降低 V02/G2 门槛；
- 不在 v3 对账前导入 P1 1,500 board；
- 不做永久双写；影子期最多 48 小时。

## 2. 根因与对应改造

| 问题 | 根因 | v3 改造 |
|---|---|---|
| feed 12 小时卡死 | 上游 411,505 条 legacy 行无 `source_key`，`source_tier=null` 违反 US NOT NULL | ATS feed 源头过滤 `source_key`；legacy 不进 ATS feed |
| 每轮 partial、`last_success` 冻结 | 固定 30 页上限，积压 1,000+ 页 | `steady` 1–2 页完整结束；`catch-up` 追到 watermark |
| 单页 119/248/359 条失败 | 无边界校验，批量写入失败后逐条回退 | 入口校验 + dead-letter；schema-invalid 不重试 |
| 529 条 legacy 被 ATS feed 关闭 | 关闭事件不区分 lane | 一条 lane 只有一个关闭权威 |
| 健康检查 200 但 feed 已死 | 只监控进程 | `last_page_at` / `caught_up_at` / `row_failures` 三项告警 |
| 旧库重复/索引膨胀 | ATS 与 legacy 混表、历史去重未清理 | v3 唯一约束 + partial index + canonical 映射 |

## 3. 目标结构

### 3.1 数据表

新建独立 schema/表，**不改 `public.jobs`**：

```sql
jobs_v3 (
  id bigserial primary key,
  lane text not null check (lane in ('ats','legacy')),
  source_key text,
  vendor text,
  token text,
  external_job_id text,
  source_tier char(1),
  source_url text,
  apply_url text,
  title text,
  company text,
  location text,
  country text,
  description text,
  posted_at timestamptz,
  source_updated_at timestamptz,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  lifecycle_state text not null default 'open'
    check (lifecycle_state in ('open','closed','stale')),
  closed_at timestamptz,
  closure_reason text,
  closure_evidence jsonb,
  canonical_job_id bigint references jobs_v3(id),
  duplicate_reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lane <> 'ats' or source_key is not null),
  check (lane <> 'ats' or source_tier is not null),
  check (lane <> 'ats' or external_job_id is not null)
);

-- ATS 唯一
create unique index jobs_v3_ats_identity
  on jobs_v3(source_key, external_job_id)
  where lane = 'ats';

-- 展示索引
create index jobs_v3_listing_idx
  on jobs_v3(is_active, posted_at desc)
  where lifecycle_state = 'open';

create index jobs_v3_lane_source_idx
  on jobs_v3(lane, source_key);
```

同步辅助表：

```text
job_sync_state_v3     -- 每 lane 一个 cursor/watermark/lease
job_sync_runs_v3      -- 运行审计，按月分区或 30 天保留
job_feed_dlq_v3       -- 无效行隔离，记录 payload hash/原因/次数
job_canonical_map     -- legacy -> canonical ATS 的映射
```

### 3.2 Feed 契约 v3

上游 `/integrations/v1/jobs` 增加：

```text
scope=ats                 # 只返回 source_key is not null
cursor=<opaque>           # 原有游标
limit<=500
```

响应必须携带：

```json
{
  "rows": [],
  "next_cursor": "...",
  "watermark": "2026-11-25T04:00:00Z",
  "has_more": true,
  "invalid_count": 0
}
```

美国站规则：

- `steady`：最多 2 页；处理到本轮开始时的 watermark 即 success；
- `catch-up`：最多 30 分钟；追到 watermark 后 success；
- `last_page_at` 每页更新，`caught_up_at` 仅在追平后更新；
- 单行校验失败写 DLQ，不拖垮整页；
- ATS close 事件只能关闭 `lane='ats'` 且 `source_key` 相同的行；
- legacy close 只能由 legacy 自己的一次性导入/维护脚本执行。

## 4. 数据迁移策略

### 4.1 ATS

- 来源：上游数据库 `source_key is not null` 的当前快照；
- 预期：约 127,869 OPEN + 8 CLOSED；
- 美国站目标地区过滤后约 87,000 active；
- 保留 `first_seen_at`、`source_updated_at`、`snapshot_id`、`source_tier`、`apply_url`；
- **不重抓 board**；只对缺失/过期字段做后续补齐。

### 4.2 Legacy

- 来源：美国站当前 active 的约 111,961 条；
- 只导入 `lane='legacy'`，`source_key=null`，`source_tier=null`；
- 不从上游 411,505 条全量导入；
- 已关闭岗位只保留最近 30 天用于历史展示，更早的不迁移；
- **一次性导入，不进入 ATS feed**。

### 4.3 去重

S05 已知 53 组 canonical URL、14,650 行重复：

- ATS 优先作为 canonical；
- legacy 重复行写 `canonical_job_id` / `duplicate_reason`；
- 不物理删除旧库；
- v3 展示层只取 canonical；
- 唯一索引上线前先跑 dry-run，发现冲突即停止。

## 5. 执行阶段

### Phase 0 · 基线、备份、止血（0.5 天）

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| R01 | 生产库全量备份 | `/opt/liorvix-backups/jobs-v3-pre-20261125-040722.dump` | 已生成 449 MB 备份，`pg_restore -l` 1,637 项可读；sha256 `6320a3e9f2cea0c9acb754cdd8a7538c70565e35a376c4ed2d0124269edba2df` |
| R02 | 固化基线 | `tmp/v3-baseline.json` + 本文 0 节 | 已记录 2026-11-25 04:08 UTC 基线 |
| R03 | 告警 | feed lag / row_failures / caught_up 三项 | 4d3a592 已暴露 `lag_minutes`/`heartbeat_age_minutes`/`stale`/`catching_up`，`healthy` 需 success 新鲜；外部告警器待接 |
| R04 | 冻结策略 | legacy 停止新增写入；ATS feed 仍正常 | eb5cac9 已冻结 legacy close 事件并限定 ATS close 只能命中同 `source_key`；`normalizeFeedItem` 对无 `source_key` 的 open 行返回 null，legacy feed 新增也已冻结；ATS feed 仍 success |

**已发现并修复的 Phase 0 事故（2026-11-25）**：

- ATS close event 原先只按 `(company, external_id/source_url/job_url)` 匹配；同公司同 ID 的 legacy 行会被一起关闭。04:10–04:15 的 40 条 legacy 关闭中，2 条上游仍 OPEN，已恢复。
- `eb5cac9` 后 close 事件必须携带 `source_key`，SQL 增加 `source_key` 过滤；无 `source_key` 的 legacy close 直接跳过。部署后新 run `closed=0`。
- 全量审计 00:00 以来 1,942 条 legacy 关闭：73 条上游仍 OPEN 已恢复；04:26/04:27 两条 HTTP 404 关闭保留（官方链接关闭，属于合法证据）。
- 结论：R04 的 legacy feed 写入/关闭冻结已完成；R03 只剩外部告警器接入，不再阻塞 Phase 1。

**停止线**：备份不可读、磁盘剩余 <5 GB、当前 feed 非 success。

### Phase 1 · 上游 Feed 过滤（1 天）

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| R05 | 上游增加 `scope=ats` | 只返回 `source_key` 行 | **已完成**：上游 `/opt/global-jobs/app/main.py` 增加 `scope=ats`；备份 `/opt/global-jobs/ops-backups/v3-scope-ats-20261125T044029Z/main.py`；实测 539,649 → **127,900** 行，8 个合法 CLOSED 仍在；默认 `scope=all` 不变 |
| R06 | 美国站客户端兼容 | 请求带 `scope=ats`，记录 watermark | **已完成**：`09f40ed` 默认请求 `scope=ats`；`JOBS_FEED_SCOPE=all` 是回滚开关；`195203/195210/195217` 连续 3 轮 success、0 row failure |
| R07 | 关闭权威拆分 | ATS close 只处理 ATS lane | **已完成核心代码**：`eb5cac9` 要求 close 带 `source_key` 并按 `source_key` 过滤；无 `source_key` legacy close 跳过；部署后 `closed=0` |

**停止线**：任何 `source_key` 岗位丢失、CLOSED 数异常增减、连续 2 轮 row_failures>0。

### Phase 2 · Steady / Catch-up 与 DLQ（1 天）

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| R08 | worker 双模式 | `steady` 1–2 页；`catch-up` 30 分钟 | **已完成代码**：`8e86313`；cursor 为空走 steady（最多 2 页），cursor 非空走 catch-up（30 页/4 分钟）；生产 run `195225` success |
| R09 | watermark 成功判定 | cursor >= 本轮 watermark | **部分完成**：以 cursor 非空判定未追平；成功仅在 `has_more=false` 时写 `caught_up_at`；独立 upstream watermark 未持久化 |
| R10 | DLQ | 无效行隔离，不无限重试 | **部分完成**：沿用 `job_sync_failures`，cursor 每页前进，row failure 不会卡住整轮；尚无自动退避/最大重试列 |
| R11 | 指标 | `last_page_at` / `caught_up_at` / lag / rows/s | **已完成**：迁移 0142 已应用；`last_page_at` 每页写、`caught_up_at` 追平写；health 优先用 `caught_up_at` |

### Phase 3 · v3 建表与回填（1–2 天）

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| R12 | 建 v3 schema | DDL + down migration | **已完成**：`0143_jobs_v3_schema.sql` 已应用；v3 有自己的序列、PK、lane 约束、ATS 唯一索引、RLS |
| R13 | ATS 回填 | 约 87k active | **已完成**：v3 ATS active **87,244**，与源库 active ATS 差异 0 行；`source_key`/`external_job_id` 空值 0 |
| R14 | legacy 回填 | 约 112k active | **已完成**：v3 legacy **111,941**，与源库 active legacy 差异 0 行 |
| R15 | 去重映射 | 53 组 canonical | **按决策完成**：53 组是 canonical URL 通用申请入口，不是重复岗位；不做物理合并；ATS `(source_key, external_job_id)` 唯一索引冲突 0；`canonical_job_id` 保留给后续人工确认 |
| R16 | 字段抽样 | 50 条 ATS + 50 条 legacy | **已完成**：199,185 行全字段与源库比对 **0 mismatch**；title/company/region/job_url 空值 0；active 状态与源库一致 |

### Phase 4 · 影子写入与对账（1 天）

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| R17 | 新 feed 只写 v3 | v3 cursor 正常 | **已完成影子写入**：`0145_jobs_v3_shadow_write.sql` 在 `public.jobs` 上挂异常安全触发器，变更镜像到 v3；源库写入失败不会发生；回填后一次性对齐 380 行，mismatch=0 |
| R18 | 影子读 | feature flag 内部读取 v3 | **部分完成**：`jobReadTable()` + `/api/jobs/stats` 支持 `JOBS_READ_SOURCE=v3`；其它读 API 尚未切，默认仍读 `jobs` |
| R19 | 对账 | 计数、重复、关闭、tier、地区 | **进行中**：active 计数一致、ATS 唯一冲突 0、字段 mismatch 0；关闭证据与 tier/地区分布待逐项对账 |
| R20 | 压测 | 1,500 board 模拟流量 | 未开始 |

**停止线**：v3 与上游 ATS 覆盖差 >0.5%；重复 >0.5%；关闭误判 >0.1%；API 5xx 增加。

### Phase 5 · 切换（0.5 天）

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| R21 | 停写窗口 | 5–10 分钟 | 旧/新游标差值可解释 |
| R22 | 追最后增量 | v3 到 watermark | `caught_up_at` 当前时间 |
| R23 | 读路径切换 | feature flag 指向 v3 | health/login/jobs/admin smoke 通过 |
| R24 | 旧库只读 | 禁止旧 worker 写 `public.jobs` | 旧表行数不再增长 |
| R25 | 回滚演练 | 切回旧读路径 | 5 分钟内完成 |

### Phase 6 · 观察、清理、恢复扩量（2 天）

| ID | 任务 | 产出 | 验收 |
|---|---|---|---|
| R26 | v3 48h 观察 | lag、P95、成功、误关、重复 | 达标才进入 G2/P1 |
| R27 | 清理旧数据 | 7 天后归档/删除旧表 | 有备份，不删唯一副本 |
| R28 | P1 导入 | 1,500 board（500+500） | 在 v3 上导入，不在旧表 |
| R29 | G3 准备 | 1,500 board 指标 | P95≤30、成功率≥99%、误关<0.2% |

## 6. 验收指标

### 6.1 同步

| 指标 | 目标 |
|---|---|
| feed candidate | 539k → ≤130k |
| 日常 feed lag P95 | ≤15 min |
| 日常成功判定 | 每轮 `caught_up_at` 滚动，不出现冻结 |
| catch-up 时长 | ≤30 min（500 board 积压） |
| row_failures | 连续 24h = 0 |
| 写入量 | 比现状下降 ≥60% |
| 重复 | `(source_key, external_job_id)` = 0 |
| 误关 | <0.1%（抽样 50 条关闭） |

### 6.2 数据库

| 指标 | 目标 |
|---|---|
| v3 切换后写入行/轮 | 下降 ≥60% |
| v3 active ATS 覆盖 | ≥99.5% 上游目标地区 |
| legacy active 覆盖 | ≥99.5% 旧库 |
| 唯一索引冲突 | 0 |
| 磁盘 | 切换后 ≥5 GB 余量 |
| 读 API P95 | 不高于现状 10% |

### 6.3 业务

- 50 条 ATS + 50 条 legacy 字段抽样 0 错误；
- 关闭岗位 100% 有 `closure_evidence`；
- 首页、搜索、岗位详情、AI 选岗抽样正常；
- 不出现“旧库有、v3 无”的 active 岗位。

## 7. 时间表（工作目标，不是承诺）

| 日期 | 阶段 | 产出 |
|---|---|---|
| 11-25 | Phase 0 | 备份、基线、告警、冻结 legacy 新增 |
| 11-26 | Phase 1 | 上游 `scope=ats`，feed 候选降 76% |
| 11-26 | Phase 2 | steady/catch-up、watermark、DLQ |
| 11-27 | Phase 3 | v3 schema + ATS/legacy 回填 |
| 11-28 | Phase 4 | 去重、影子写、对账 |
| 11-29 | Phase 5 | 切换，旧库只读 |
| 11-29–12-01 | Phase 6 | v3 48h 观察；达标后 P1 1,500 |

V02 48h 观察仍按原计划到 **2026-11-26 11:50 UTC（19:50 北京）**；v3 切换**不冒充旧库观察结果**，G2/P1 以 v3 自己的 48h 数据为准。

## 8. 风险与回滚

| 风险 | 处理 |
|---|---|
| 切换丢增量 | 5–10 分钟停写 + 追 watermark + 对账后切换 |
| v3 表占空间 | 影子期约 +5 GB；切换后旧表只读，7 天内清理 |
| legacy 被 ATS 关闭 | lane 约束 + close 路由 + 抽样 |
| 去重误合并 | canonical 只做映射，不物理删；人工抽查 53 组 |
| 上游 filter 漏 key | 对比 500 个 `source_key` 集合；缺 1 个即停 |
| 旧库回滚 | 旧读路径保留；回滚命令演练；备份可恢复 |
| G2 被跳过 | v3 观察独立；不拿旧库数据直接判 G2 |

**回滚命令**：切换前记录 release/DB snapshot；回滚只切读路径，不回滚已写入的 v3 增量；旧库保持只读，避免双写。

## 9. 立即执行（Phase 0）

1. R01 生产库备份，校验可读；
2. R02 生成 `tmp/v3-baseline.json`；
3. R03 加 feed lag / row_failures 告警；
4. R04 冻结 legacy 新增写入，保留 ATS feed；
5. 然后才进入 Phase 1，不在备份完成前改上游。

**当前不做**：不建 v3 表、不切读路径、不导入 P1、不删除旧数据。