# 岗位同步运行说明

## 数据口径

- `jobs` 表保留历史岗位，以维持收藏、投递、AI 匹配等外键关系。
- `is_active = true` 才是平台当前可投递岗位，后台主指标和用户端只统计这一口径。
- 非目标地区岗位保留为关闭状态，不参与查询和 AI 选岗。

## 同步机制

1. 增量同步是常态路径，逐页保存 `feed_updated_at` 游标，并在追平后使用 10 分钟重叠窗口读取真实变更。
2. 上游只会在用户可见的岗位字段或状态改变时推进游标；普通爬取时间、重试和链接探测不会造成全量重传。
3. 上游明确返回关闭状态时，网站立即接收关闭事件。采集不完整、翻页失败或 Cloudflare 验证不能作为关闭依据。
4. 官方链接只做辅助核验；只有明确的 410 或重复确认的官网下架页面才允许关闭。403、429、超时、DNS 或验证页不会关闭岗位。
5. 全量对账仅用于人工发起的恢复审计，不能作为定时任务，也不能因“快照缺失”自动关闭岗位。超过 6 小时未完成的对账必须运行 `pnpm run abort:jobs-reconcile` 终止；该命令不会改动岗位状态。
6. 所有任务使用数据库租约，同一时间只能运行一个同步任务；崩溃后租约自动过期并可续跑。
7. 单条岗位写入、关闭事件或同步元数据写入失败时，批次会降级为逐条重试；仍失败的记录写入 `job_sync_failures`，不会阻塞主游标。只有上游页面不可读、数据库整体不可用或游标没有前进才会保留游标。

### 主增量同步性能策略

- 主增量同步按上游稳定游标顺序逐页处理，默认每轮最多 30 页；只有 `has_more=true` 才继续读取下一页，不并行猜测下一游标。
- 每完成一页就保存游标；达到 `JOBS_INCREMENTAL_MAX_DURATION_MS`（生产默认 4 分钟）或页数上限时，当前轮正常结束，下一轮从已保存游标继续，不回滚已成功写入的数据。
- `stop_reason=page_budget|time_budget` 表示本轮是预算停止，不代表同步失败；`fatal_failures` 仍是唯一会阻止游标推进的页面级失败指标。
- 生产建议保持 `JOBS_FEED_PAGE_SIZE=500`、`JOBS_INCREMENTAL_MAX_PAGES=30`、`JOBS_INCREMENTAL_MAX_DURATION_MS=240000`。若上游出现限流或数据库延迟，优先降低页数或时间预算，不提高并发读取同一游标。

### 数据库写入策略

- 正常岗位和同步元数据统一按 `JOBS_SYNC_WRITE_BATCH_SIZE` 分批写入，生产默认 100 条；更新按岗位主键批量 upsert，避免 25 条一组的单行请求风暴。
- 单批失败后才进入逐条降级，降级并发默认 8，最大 16；每条仍会经过有限重试，最终失败进入 `job_sync_failures`，不会阻塞其他批次。
- `write_batches`、`write_batch_failures`、`write_fallback_rows` 和 `write_duration_ms` 会随主同步日志输出，用于区分数据库批次压力、单条异常和上游页面问题。
- 写入使用稳定的 `source_system + company + external_job_id` 或岗位主键/官方 URL 幂等匹配，不删除重建岗位，也不因写入字段异常改变 `is_active` 或 `is_closed`。

### 失败记录口径

- 日志中的 `failed` 是兼容字段，表示本轮发现的失败总数；`row_failures` 表示已隔离并入失败队列的行级失败；`fatal_failures` 才表示阻止游标推进的页面级失败。
- `job_sync_failures` 使用岗位身份和操作生成幂等键，重复失败会合并并记录退避时间；失败处理 worker 按 `next_retry_at` 消费，达到最大次数后进入 `dead`，不会形成无限重试。
- 失败队列写入本身失败时，按数据库整体故障处理并保留主游标，避免出现“岗位失败记录丢失但游标已推进”。
- 失败 worker 使用 `job_sync_failures` 独立租约和 `FOR UPDATE SKIP LOCKED` 行领取；进程崩溃后超过 15 分钟的 `processing` 记录会自动重新进入处理范围。
- 管理员可通过 `GET /api/admin/job-sync-failures?status=pending|processing|resolved|dead|all` 查看失败明细与各状态数量；该接口只读，不直接改变岗位数据。
- 管理员可通过 `PATCH /api/admin/job-sync-failures` 携带 `{ "id": 123, "action": "retry" }`，或一次携带最多 100 个 ID，将 `dead` 记录恢复为 `pending`；恢复会清零本轮尝试次数并立即安排重试。`processing`、`resolved` 和不存在的记录会被跳过，所有恢复操作写入管理员审计日志。

## 官方字段自动补全

### 官网岗位总数口径

看板的“官网岗位数”只接受上游 `/dashboard/company-directory` 的官方计数证据，不使用美国站岗位数、主 Feed 接收数或本地活跃岗位数代替。`official_count_status` 的含义是：

- `publisher_reported`：官网接口发布的总数，或官网返回的相互独立分区聚合计数经一致性校验后的总数。
- `complete_official_list`：连接器完整遍历官方列表并计数。
- `capped_unavailable`：官方接口到达供应商上限，只能显示 `official_count_lower_bound`，不能把上限值当精确总数。
- `unavailable`：当前没有可验证的官方总数，必须显示“未知”，不能显示 0、9999 或 99999。

新增或修复公司时必须保留 `official_count_source` 和 `official_count_observed_at`，并在真实官方接口上验证计数证据。官方没有提供精确总数时，保持上述状态并显示原因，不得通过本地岗位数量反推。

网站后台的增量同步和官方详情补全是两条独立队列：

- 增量同步优先消费上游游标。单条岗位的异常字段会被标准化层隔离，不能阻塞同页其他公司和后续游标。
- 官方详情补全按已验证的 Workday 官方链接自动发现公司，并以 `official:workday:<company>` 保存独立游标和租约。它使用独立的 2 分钟调度节奏，不再等待 10 分钟主 Feed 周期；每家公司每轮仍只处理有限批次，详情页超时、限流或无正文只延后该批次。
- 同一轮选中的不同官方 host 会并行运行，每家公司内部仍保持并发 1 和 1.2 秒请求间隔；同一 host 的公司自动串行，避免把并行优化变成对单一 ATS 的请求风暴。
- 已登记的 Greenhouse、Ashby、Lever、Phenom 来源使用各自连接器做字段回填，并以 `official:registered_connector:<company>` 保存独立游标和租约；每家公司按岗位 ID 分批断点续跑，不会每轮重复从第一条开始。未完成来源探测的公司不会猜测接口。
- 公司选择使用数据库持久化公平调度：从未处理的公司优先，其次选择最久未处理的公司；租约占用或仍在退避时间内的公司会跳过。失败后的退避为 1 分钟、5 分钟、30 分钟、2 小时，后续失败最多每 2 小时重试。服务重启或多实例运行不会重置顺序，也不会让一家公司独占队列。
- 新岗位先由上游同步写入；下一轮官方详情队列会自动补齐缺失且有官方证据的地点、岗位类型、经验、工作方式、薪资或截止日期。没有官方证据的字段保持为空。
- 官方官网岗位总数与上游目录总数是两个口径。详情补全不会凭空导入上游缺失的岗位，也不会修改 `is_active`、`is_closed` 或岗位 ID。

生产环境当前显式开启以下配置，每家公司每轮最多 100 条、每轮 3 家：

```bash
JOBS_AUTO_WORKER=true
JOBS_OFFICIAL_DETAILS_AUTO_SYNC=true
JOBS_OFFICIAL_DETAILS_INTERVAL_MINUTES=0.1
JOB_BACKFILL_WRITE_ENABLED=true
JOB_BACKFILL_REQUEST_DELAY_MS=1200
JOBS_OFFICIAL_DETAILS_BATCH_SIZE=100
JOB_BACKFILL_CONCURRENCY=3
JOBS_OFFICIAL_DETAILS_COMPANIES_PER_CYCLE=3
```

查看进度时分别检查 `collector_feed` 的主同步状态和 `job_sync_state` 中 `official:%` 前缀的公司状态；后台大屏不展示内部游标数字，而显示运行台账中的“本轮总岗位、已处理、剩余、已写入、失败”和最近心跳。`last_attempted_at`、`last_success_at`、`next_retry_at` 可以判断成功时间和退避状态。使用 `pnpm tsx scripts/check-job-sync-state.ts` 查看底层状态。

完整对账需要在受控维护窗口设置 `JOBS_ALLOW_FULL_RECONCILE=true`，不能通过管理端按钮直接启动。

## 首次部署

项目默认安装在 `/opt/liorvix`，服务用户为 `liorvix`。若实际路径或用户不同，先修改 `deploy/systemd/*.service`。

```bash
sudo cp deploy/systemd/liorvix-jobs-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liorvix-jobs-incremental.timer
sudo systemctl enable --now liorvix-jobs-maintenance.timer
```

## 运维检查

```bash
systemctl list-timers 'liorvix-jobs-*'
journalctl -u liorvix-jobs-incremental.service -n 100 --no-pager
journalctl -u liorvix-jobs-maintenance.service -n 100 --no-pager
```

管理端 `GET /api/jobs/sync-feed` 返回最后成功时间、游标、连续失败数和错误信息，可用于健康告警。
管理端 `GET /api/admin/job-rotation` 的 `officialDetails.states` 返回每家公司调度状态，`dueCompanies` 表示当前已到重试时间且没有有效租约的公司数。
第六阶段来源台账通过 `pnpm run audit:company-source-matrix -- --out=output/company-source-matrix.json` 只读生成；生产写入必须显式设置 `SOURCE_MATRIX_WRITE_ENABLED=true` 并追加 `--write`。写入的是 `job_company_sources` 元数据表，不会改变岗位状态。管理员可通过 `GET /api/admin/job-sources` 查询公司、来源类型、官方 host、外部 ID 字段、详情规则、调度状态和六项字段覆盖率。
来源台账的状态含义为：`configured_connector` 表示已登记连接器，`source_family_identified` 表示已从真实官方 host 识别来源族，`discovery_required` 表示尚未取得足够官方证据。来源台账只记录当前活跃 `collector_feed` 公司；下一次矩阵同步会把不再活跃的旧公司标记为 `inactive`，不会删除历史岗位。
可用 `pnpm run check:company-source-matrix` 检查台账行数、活跃公司数、来源族分布和最近观测时间；生产环境同样必须显式加载 `/opt/liorvix/.env.local`。
# 同步大屏人工干预说明

大屏只展示数据库快照；页面刷新不会探测上游。管理员可以在“同步大屏”中执行下列低风险、可审计操作：

- 立即增量同步：最多 10 页，只沿用现有 `collector_feed` 游标；不会启动全量对账。
- 处理该公司：仅当来源台账有 `upstream_company_id` 且 `JOBS_FEED_COMPANY_FILTER_ENABLED=true` 时执行，使用 `feed:company:<companyId>` 独立游标。
- 补全官方字段：只处理已有官方连接器且对应写入开关已开启的公司，使用 `official:*` 游标。
- 清理过期对账：只清除超过安全时限的历史全量对账进度，不修改岗位生命周期。
- 释放过期租约：仅当 `lease_expires_at` 已过去时允许；有效租约绝不强制释放。
- 失败队列重试：只把 `dead` 记录重新放回 `pending`，具体记录仍在失败队列页处理。

每次操作都会写入 `admin_audit_logs`。系统不提供任意改游标、回退游标、强制下架岗位或全量重建按钮；这些操作必须在维护窗口由运维脚本执行并留存证据。
这些按钮需要独立的 `admin.job-sync.write`（代码常量 `ADMIN_PERMISSIONS.jobSyncWrite`）权限；只有查看权限的管理员仍然只能读大屏。

## 如何判断“卡住”

运行中的 `job_sync_runs` 会每页更新 `current_stage`、`current_company_name`、累计接收/写入/失败数，以及 `total_candidates`、`processed_candidates`、`remaining_candidates` 和 `last_heartbeat_at`。大屏显示的“当前公司/总岗位/已处理/剩余/最近心跳”均来自这条运行台账，不依赖人工解读游标。页面级失败会把运行标记为 `failed` 并保留同步状态游标；行级失败只进入失败队列，主游标仍可推进。

部署新环境时必须依次执行 `0099_job_sync_dashboard_telemetry.sql`、`0100_job_sync_official_upstream_counts.sql`、`0101_job_sync_run_live_progress.sql`、`0102_clear_legacy_zero_count_placeholders.sql` 和 `0103_job_sync_run_candidate_progress.sql`。其中 `0102` 只清理历史上把 JSON `null` 错记成 `0` 的数量观测，`0103` 只增加运行进度计数列；两者都不删除岗位、不修改岗位上下架状态。若接口提示缺少迁移，先停止人工操作并补齐数据库迁移。

官方字段补全默认每轮并发处理 3 家企业（`JOBS_OFFICIAL_DETAILS_COMPANIES_PER_CYCLE`）。大屏顶部会逐家公司显示活动任务；只有租约有效且最近两分钟有心跳的任务才算“正在处理”，旧任务会标为停滞并保留在详情的运行历史中。官方字段子任务会持续回写当前公司、当前游标、已读取和已写入数量；如果长时间停留在“读取官方页面”，应先检查上游页面响应和服务日志，再决定是否释放过期占用。

历史字段复核使用 `job_historical_field_reviews` 独立队列（迁移 `0104_job_historical_field_review_queue.sql`、`0105_historical_review_fair_claim.sql`、`0106_seed_historical_review_totals.sql`）。它按公司逐批处理，每批最多 `JOBS_HISTORICAL_FIELD_REVIEW_BATCH_SIZE` 条；同一家公司会持续处理到当前候选岗位耗尽（`JOBS_HISTORICAL_FIELD_REVIEW_BATCHES_PER_COMPANY` 默认 1000，仅作为防失控上限），默认同时处理 `JOBS_HISTORICAL_FIELD_REVIEW_COMPANIES_PER_CYCLE=2` 家。健康公司不会因批次数到达而主动切换，只有页面级失败、整批失败或进程卡住才释放名额；因此不会每 5 条岗位就切换公司，也不会让一个异常公司阻塞另一个并行槽。它不读取、推进或锁定 `collector_feed` / `official:*` 游标。生产启用前先将 `JOBS_HISTORICAL_FIELD_REVIEW_ENABLED=true`，设置为 `false` 即可暂停，已领取任务会在租约到期后自动恢复。运行租约最长 15 分钟，但每 15 秒续租；服务重启或进程崩溃后，只要 60 秒没有心跳，后台看门检查会把任务和遗留运行记录自动恢复/标记失败，不会等满租约时间。页面级异常只让该公司延后 5 分钟；整批失败才保留游标重试，混合行级失败会跳过失败行并继续后续岗位，不影响主 Feed、官方增量或岗位上下架。

来源台账为 `discovery_required` 的公司会在历史队列中显示为“来源待探测/已暂停”，但不会被领取，也不会阻塞已完成来源探测的公司。完成来源矩阵后，下一次队列维护会自动将该公司恢复为可处理状态。队列初始化会用 `job_company_sources.active_jobs` 填充本轮总数，首次子任务返回精确候选数后再校正；看板应显示持久化的公司累计已处理、剩余和游标，而不是仅显示当前正在运行的最后一批。

历史复核会把官网明确没有提供的字段记录为 `unavailable_on_official_source`，不会把它们继续算作失败；只有官网有值才写入标准字段和官方证据。每家公司完成当前历史候选后进入 24 小时冷却，后续仍可手动重新排队。大屏会显示“历史字段复核”的已处理、剩余和本轮更新数量，并明确标注它与主岗位同步相互独立。

官方字段队列到达某公司的当前最大岗位 ID 后会保留末端游标，并进入 10 分钟完成复查冷却。游标已达到当前最大岗位 ID 的公司不会再次启动详情子进程；后续新增且 ID 更大的岗位会在下一次复查时进入队列。这样不会因为官网未提供某个字段（例如截止日期）而把已完成公司从头重复扫描。

### 看板中的“已完成”与“字段待复核”

两者是不同口径：

- “本轮已完成/当前增量已追平”表示该公司的官方游标已经检查到当前本站岗位 ID 尾部，本轮没有新的岗位候选；它不表示历史岗位的每一个字段都已经有官方证据。
- “历史字段待复核”表示现有岗位中仍有字段值没有被官方详情证据验证，或旧字段证据被标记为 `pending_recheck`。这些记录可能早于当前游标，因此不会因为正常复查冷却而自动从头扫描。
- `unavailable_on_official_source` 表示官网没有提供该字段，不计入失败；`rejected_legacy` 表示旧证据已隔离，也不等同于本轮页面失败。

因此，看到公司“当前增量已追平”同时有“历史字段待复核”是正常的监控组合；前者回答“同步任务有没有继续推进”，后者回答“字段证据还有多少缺口”。看板不会把正常的下一次复查时间误报为“等待重试”。

Workday 详情请求使用最多 3 个并发 worker，但由 `JOB_BACKFILL_REQUEST_DELAY_MS` 统一限制请求启动间隔；并发只重叠 DNS/TLS/响应等待，不改变请求频率上限。若官方源出现 429，应先将 `JOB_BACKFILL_CONCURRENCY` 调回 1，并保留退避和失败隔离。
