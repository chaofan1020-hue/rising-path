# 岗位新鲜度与失效链接治理方案

更新时间：2026-08-19

## 1. 目标与边界

岗位是否还能申请，不能只由“本站服务器能不能用 HTTPS 打开链接”决定。Google Careers、Amazon Jobs、Workday、Greenhouse 等站点会返回验证码、403、JS Challenge 或通用招聘首页；这些结果只能说明本站抓取器无法确认，不能说明岗位已经下架。

本方案的目标是：

1. 新岗位和岗位变更在 2～10 分钟内进入网站。
2. 上游已关闭的岗位最多在两次同步周期内从公共列表下架。
3. 失效链接不会继续作为“可申请岗位”长期展示。
4. 403、验证码、超时等不确定结果不误杀有效岗位，但要可见、可追踪、可重试。
5. 外部职位 ID、来源快照、同步游标和链接核验结果都能审计。

本方案不绕过验证码、不保存个人登录态 Cookie，也不使用非官方镜像冒充官方职位页。对于需要浏览器渲染的站点，优先依赖上游采集器的官方 API/connector；只有在获得明确授权并且有预算时，才增加隔离的浏览器渲染任务。

## 2. 根因判断

当前失效岗位持续出现在前端，主要是以下几个原因叠加：

### 2.1 链接巡检无法代表岗位状态

本站使用 Node HTTPS 请求检查官网链接，不执行 JavaScript。最近的巡检结果中，283 个链接全部是 `inconclusive`，没有办法证明它们是健康或下架。若把这类结果直接下架，会误伤真实存在的岗位；若完全忽略，又会留下失效链接。

### 2.2 上游关闭事件可能延迟到达

上游采集器才真正知道某个 ATS 中的职位是否还在开放列表。网站同步的是上游快照，不是实时查询公司官网，因此上游 crawl 的频率、分页失败、connector 变更都会直接影响本站新鲜度。

### 2.3 增量游标可能积压

增量同步只有在完整跑完当前批次后才记录成功时间。若待处理页数多，`last_incremental_success_at` 会显得长期不变，即使任务实际上一直在追赶。全量对账和链接巡检若与增量共用一个长任务，还会进一步拖慢最新岗位进入网站的时间。

### 2.4 ATS URL 会变化

公司可能保留同一个职位 ID，但更换职位 URL、地区参数或招聘系统。只用 URL 去重会产生重复岗位，或者把旧 URL 当成新岗位。稳定的 `source_system + external_job_id` 必须成为主键候选，URL 只作为可更新属性。

## 3. 统一状态模型

岗位状态和链接状态必须分开存储。

### 3.1 岗位业务状态

| 状态 | 含义 | 是否展示在公共岗位列表 |
| --- | --- | --- |
| `active` | 上游最近一次成功快照确认开放，且截止日期未到 | 是 |
| `closed` | 上游明确关闭、截止日期已过，或经过规定次数的确定性 404/410 | 否 |
| `missing_pending` | 在一次完整对账中暂时未出现，等待第二次确认 | 默认是，可标记“待确认” |
| `source_stale` | 上游源超过新鲜度阈值没有成功抓取 | 默认不批量下架，后台告警 |
| `manual_hold` | 管理员人工冻结，防止自动任务修改 | 按管理员决定 |

### 3.2 链接健康状态

建议在 `job_sync_records` 增加枚举或等价字段 `link_health`：

| 状态 | 触发条件 | 对岗位业务状态的影响 |
| --- | --- | --- |
| `valid` | 2xx 且页面包含职位正文或结构化职位数据 | 保持岗位状态 |
| `closed` | 410、明确关闭文案，或上游明确关闭 | 可下架 |
| `not_found` | 404 | 第一次仅记录；连续两次才下架 |
| `blocked` | 401/403、验证码、JS Challenge | 不下架，进入重试/浏览器任务 |
| `timeout` | DNS、TLS、连接或读取超时 | 不下架，降低重试频率并告警 |
| `unknown` | 其他无法分类的 5xx、解析错误 | 不下架，记录原因 |

`last_link_status` 仍可保留 HTTP 数字状态，但不能再用 `NULL` 表示所有失败原因。每次核验应同时写入：`link_health`、`last_link_status`、`last_link_checked_at`、`link_check_failures`、`last_link_error`、`resolved_url`。

## 4. 数据源优先级

下架判定使用明确的优先级，避免不同任务互相覆盖：

1. **上游明确关闭事件**：`sync_action=close`、`status=closed`、`closed_at` 或 connector 的关闭记录，立即关闭。
2. **上游完整快照缺失**：一次完整对账标记 `missing_pending`；第二次独立成功对账仍缺失，关闭。
3. **上游截止日期**：`valid_through`、`application_deadline` 或高置信度页面字段过期，关闭。
4. **官网链接确定性结果**：410、明确的“职位已关闭”文案立即关闭；404 需要第二次确认。
5. **官网不确定结果**：403、验证码、超时、5xx、空壳 HTML 只写链接健康度，不改变岗位业务状态。

上游的开放快照必须能够反向确认“看到过哪些岗位”。如果上游只返回新增记录而没有关闭事件，必须补充带 `status`、`closed_at`、`snapshot_id` 和 `snapshot_completed_at` 的快照接口，否则网站无法可靠地区分“暂时没抓到”和“职位已下架”。

## 5. 上游采集服务器改造

### 5.1 统一职位契约

每条记录至少返回：

```json
{
  "external_job_id": "stable-id",
  "company_name": "Example",
  "title": "Software Engineer",
  "source_url": "https://company.example/jobs/stable-id",
  "canonical_url": "https://company.example/jobs/stable-id",
  "status": "open",
  "closed_at": null,
  "date_posted": "2026-08-01T00:00:00Z",
  "valid_through": null,
  "source_updated_at": "2026-08-19T02:55:00Z",
  "snapshot_id": "company-2026-08-19T03:00:00Z"
}
```

`external_job_id` 必须来自官方职位 ID、ATS requisition ID 或稳定 URL ID；禁止每次根据标题生成随机 ID。

### 5.2 快照和增量接口同时保留

- 增量接口：按 `cursor` 或 `since` 返回新增、更新、关闭事件。
- 快照接口：按公司和 `snapshot_id` 分页返回当前全部开放岗位。
- 每个快照返回 `reported_total`、`page_count`、`completed_at`、`connector_version`。
- 如果分页中断、数量低于来源报告、详情补全失败率超阈值，run 标记为 `partial/failed`，不能把不完整快照当成完整快照。

### 5.3 公司级健康度

每个 company/source 记录：

- `last_success_at`
- `last_complete_snapshot_at`
- `last_partial_at`
- `open_count`
- `discovered_count`
- `coverage_ratio`
- `detail_success_ratio`
- `error_code`、`error_message`
- `connector_version`

这样可以定位是“网站没同步”还是“某一家公司的采集器已经坏了”，而不是只看到一个全局同步时间。

## 6. 网站同步任务编排

同步任务拆成三个互不阻塞的队列：

### A. 增量同步队列

- 运行间隔：生产环境建议 2 分钟；本地 worker 可配置 5～10 分钟。
- 每轮只做有限页数，但每页成功后立即持久化游标。
- 页面有写入失败时不推进该页游标，下一轮幂等重试。
- 增量优先级高于对账和链接巡检。
- 记录 `cursor_lag_seconds = now - source_updated_at`，后台直接显示延迟。

### B. 全量对账队列

- 每家公司每日最少一次；大型公司可按 6 小时一次。
- 使用 `snapshot_id` 标记本轮范围，只有完整快照结束后才执行 missing 计数。
- 缺席一次不关闭；连续两次完整快照缺席才关闭。
- 对账期间不阻塞增量同步，使用独立租约 `reconcile`。

### C. 链接健康队列

- 只处理上游最近确认开放的岗位。
- 低风险域名批量检查；对 403、验证码、超时单独进入重试队列。
- 检查任务不能更新 `is_active`，除非结果是明确 410、明确关闭文案，或同一岗位连续两次 404。
- 对动态招聘站点优先使用上游 connector 的详情状态；本站 Node 请求只做轻量辅助。

当前代码已有增量、对账和维护入口，后续应把维护中的链接巡检从主同步周期中拆出，避免 283 个不可判定链接占用岗位增量的执行时间。

## 7. 浏览器渲染与反爬站点策略

不要让每个用户请求都同步打开外部官网，也不要在本站服务中无限重试反爬站点。建议按以下顺序处理：

1. 上游 connector 已能读取官方 API：直接使用 connector 结果。
2. 公开 ATS 有稳定 JSON：在上游采集服务器读取列表和详情 JSON。
3. 只有公开 HTML 且需要执行 JS：将 URL 投递到独立 Playwright worker，限制域名白名单、并发、响应体大小和超时。
4. 返回验证码、登录页或风控页：记录 `blocked`，保留官方 URL，不尝试绕过。

Playwright worker 的结果只写入 `job_link_evidence` 或 `job_sync_records`，不直接决定岗位下架；浏览器渲染失败也不能影响增量同步队列。

## 8. 前端与用户体验

岗位列表默认只展示 `active`，但在用户点击前增加轻量保护：

- 详情 API 读取到上游已关闭或本地明确失效状态时返回 410，并从列表缓存中移除。
- `blocked/timeout/unknown` 不向用户显示为“岗位已失效”，而是保留申请入口并提示“官网暂时需要验证，请稍后重试”。
- 详情页显示 `最后由上游确认：xx 分钟前`，使用户知道数据新鲜度。
- 有截止日期时显示“距离岗位投递关闭还剩 X 天”；没有截止日期时显示“官网未提供明确截止日期”，不要猜测日期。
- 申请前记录一次 `application_link_check`，把最终 URL、状态和时间写入网申审计日志。

## 9. 管理后台必须可见的指标

轮换页面至少显示：

1. 上游源：最近成功、最近完整快照、当前源数据年龄。
2. 本站同步：增量游标、游标延迟、当前批次、连续失败次数、最后错误。
3. 岗位变更：新增、更新、关闭、待确认缺失、截止日期过期。
4. 链接健康：`valid / closed / not_found / blocked / timeout / unknown` 数量。
5. 公司维度：最近一次 crawl、coverage、详情完整率、失败原因。
6. 操作：一键执行小批量增量、继续对账、重试失败链接；所有操作记录管理员审计日志。

告警建议：

- 游标延迟超过 15 分钟：黄色。
- 源数据超过 2 小时没有成功 crawl：橙色。
- 连续两次完整快照 coverage < 99%：红色并暂停该公司自动下架。
- `blocked + timeout` 超过全部活跃岗位的 30%：红色，说明链接巡检策略失效，不要继续扩大并发。

## 10. 数据库迁移建议

在现有 `job_sync_records` 基础上增加：

```sql
alter table public.job_sync_records
  add column if not exists link_health text not null default 'unknown',
  add column if not exists last_link_error text,
  add column if not exists resolved_url text,
  add column if not exists source_snapshot_id text,
  add column if not exists source_updated_at timestamptz;

alter table public.job_sync_records
  add constraint job_sync_records_link_health_check
  check (link_health in ('valid','closed','not_found','blocked','timeout','unknown'));

create index if not exists job_sync_records_health_idx
  on public.job_sync_records (source_system, link_health, last_link_checked_at);
```

在 `job_sync_state` 增加 `source_generated_at`、`cursor_started_at`、`cursor_lag_seconds`、`last_complete_snapshot_at`，并在管理员接口返回这些字段。若上游支持公司级状态，增加独立的 `job_source_health` 表，不要把公司级错误塞进单个岗位记录。

## 11. 上线顺序和回滚

### 第一阶段：只观测，不自动扩大下架

1. 上游补齐稳定 external ID、关闭事件和快照元数据。
2. 网站记录六类链接健康状态，后台显示来源年龄和游标延迟。
3. 保持现有“410/关闭文案立即下架、404 两次下架、403/超时不下架”规则。
4. 连续观察 3 个完整对账周期，确认 coverage 和关闭事件稳定。

### 第二阶段：启用公司级质量门禁

1. coverage >= 99%、详情完整率 >= 99% 的公司进入自动对账。
2. partial/failed 的公司只做增量更新，不执行缺席关闭。
3. 每家公司连续 3 个成功周期后才降低链接巡检频率。

### 第三阶段：启用浏览器证据队列

1. 只选择少数确实需要 JS 的域名。
2. 采用域名白名单和固定资源上限。
3. 浏览器证据只改善链接健康，不绕过风控，也不成为唯一的下架依据。

回滚时按公司/connector 停用来源即可；保留历史岗位和审计数据，不清空岗位表，不重置全局游标。

## 12. 验收标准

部署完成后必须用真实数据验证：

- 最近 24 小时新增/更新岗位的 `source_updated_at` 到网站 `updated_at` P95 小于 10 分钟。
- 上游明确关闭的岗位在两个增量周期内不再出现在公共列表。
- 连续两次完整对账缺席的岗位 100% 被关闭，单次 partial 对账不误关闭。
- 403、验证码、超时岗位不会因为巡检失败被批量下架。
- 同一 `source_system + external_job_id` 永远只有一条岗位记录，URL 变化只更新原记录。
- 详情页对已关闭岗位返回 410；用户不会进入自动网申流程。
- 后台能够直接回答：数据来自哪个源、源最后何时成功、游标落后多久、岗位为什么被关闭、链接最后一次是什么结果。

## 13. 最终结论

真正可靠的方案不是把本站链接巡检做得更激进，而是把“岗位业务状态”交给有官方来源能力的采集服务器，把本站巡检降级为证据和兜底。上游通过稳定职位 ID、关闭事件和完整快照保证业务正确性；网站通过增量游标、可恢复对账、分级链接状态和点击前核验保证用户看到的岗位尽量新鲜。这样既能覆盖 Google、Amazon 等反爬站点，也不会因为一次 403 或超时误杀仍然有效的岗位。
