# 新增公司岗位接入运行手册

更新时间：2026-09-01

这份文档是以后新增公司时的固定入口。新增公司不是只在前端增加一个公司名，而是要同时登记上游采集服务、阶段六来源台账和官方字段补全规则。

## 系统边界

- 上游采集服务：维护公司、官方来源、抓取任务和 `/dashboard/company-directory`。
- 美国应用服务器：运行 Liorvix、主 Feed 同步、官方字段补全和同步大屏。
- 阶段六台账：美国 Supabase 的 `job_company_sources`，是后台大屏的公司全集和来源矩阵权威来源。
- 岗位生命周期：由上游明确关闭事件和独立链接健康规则控制。新增公司或字段解析失败不能直接修改 `jobs.is_active` / `jobs.is_closed`。

服务器地址和登录材料只从工作区的凭据文件读取，不把密码、API Key、Cookie 或私钥写进本文件、代码、fixture 或聊天记录。当前凭据文件名包括 `服务器账号密码.txt` 和 `正式发布服务器密钥.pem`。

## 上游接口契约

上游 `GET /dashboard/company-directory` 必须保持“数组”顶层结构。每家公司至少返回：

```json
{
  "id": "upstream-company-id",
  "name": "Example Corp",
  "open_jobs": 12,
  "last_crawl_at": "2026-09-01T02:00:00Z",
  "latest_run_status": "success",
  "generated_at": "2026-09-01T02:01:00Z",
  "contract_version": "job-company-directory-v1"
}
```

旧客户端使用的 `job_count`、`last_crawled_at`、`last_crawl_status` 等字段必须继续保留。不要把数组改成 `{ companies: [...] }`，除非同步修改美国应用的解析器、测试和部署。

美国应用通过 `JOBS_FEED_URL` 去掉 `/integrations/v1/jobs` 后访问 `/dashboard/company-directory`，并使用 `X-Integration-Key`。浏览器刷新大屏不会直接探测上游；后台 worker 定期读取接口并把快照写入 `job_company_sources`。

## 标准接入流程

开始任何新增公司或 P2 字段任务前，先运行只读配置盘点：

```bash
pnpm run audit:company-configuration
```

该命令以 `job_company_sources` 为权威全集，明确区分“已配置连接器”“来源族已识别”和“完全待探测”；不要依据上游 `auto_discover` 标记直接把公司提升为已配置。

上游目录已经确认、但美国台账缺少 careers URL 或官方 host 时，先执行只读预览：

```bash
pnpm run sync:company-source-metadata
```

确认预览中的公司、URL 和 host 后，才在生产环境显式开启 `SOURCE_MATRIX_WRITE_ENABLED=true` 并加 `--write`。这个命令只补来源元数据，保留 `discovery_required`、`source_family_identified`、`configured_connector` 原状态，不会修改岗位、游标、复核进度或岗位生命周期。

### 1. 先做重复和官方来源检查

- 确认公司尚未存在于上游 `GET /companies` 和美国 `job_company_sources`。
- 确认唯一官方 careers URL、官方 ATS host、地区范围、时区和外部岗位 ID。
- 确认不能用搜索结果、聚合站或模型猜测替代官方来源。

### 2. 在上游登记公司和来源

上游管理 API 使用管理员 API Key。典型顺序如下，具体字段以当前上游 OpenAPI/管理页面为准：

```text
POST /companies
POST /companies/{company_id}/sources
POST /admin/ingest/{company_id}
```

公司资料至少要有名称、官方 careers URL、`connector_type` 和来源 URL。来源要填写 `source_type`、`priority`、官方 URL 及连接器配置。提交后先做一次小范围抓取，不要直接全量回填。

### 3. 验证上游目录

确认 `/dashboard/company-directory`：

- 能返回新公司的稳定 `id` 和正确名称。
- `open_jobs`、`last_crawl_at`、`latest_run_status` 类型正确；未知值必须是 `null`，不能伪造为 0 或成功。
- 官方总数必须同时返回 `official_open_jobs`、`official_count_status`、`official_count_source`、`official_count_observed_at`；状态含义固定为 `publisher_reported`（官网发布总数）、`complete_official_list`（完整遍历官网列表）、`capped_unavailable`（接口上限，只能给下限）或 `unavailable`。
- `last_crawl_expected` / `last_crawl_discovered` 可以来自最近一次 `success` 或 `partial` 抓取：`partial` 只表示部分岗位字段质量告警时，官方总数仍可用于对账；失败运行不得覆盖上一次可信数量。`9999`、`99999` 等占位值必须返回 `null`，不能进入美国端看板。接口上限（例如 Amazon 列表 10,000 条）不得作为精确总数；若官方提供相互独立且一致的聚合分区计数，可记录为 `publisher_reported`，并在 `official_count_source` 写明证据维度。
- 原有公司仍然全部返回，不能因为新公司导致目录截断。

### 4. 更新美国阶段六来源台账

在美国应用服务器 `/opt/liorvix` 上使用生产 `.env.local` 执行：

```bash
cd /opt/liorvix
sudo env SOURCE_MATRIX_WRITE_ENABLED=true pnpm run audit:company-source-matrix -- --write
sudo pnpm run check:company-source-matrix
```

写入的是元数据台账，不会改变岗位上下架。重点核对新公司的：

- `upstream_company_id` 与上游目录完全一致。
- `source_type`、`source_basis`、`official_hosts`、`official_careers_url`。
- `connector_name`、`connector_board`、`external_job_id_field`、`detail_url_rule`。
- `region_scope`、`timezone`、`status` 和 `discovery_status`。

### 5. 做真实样本 dry-run

已有连接器先执行不写入的预览：

```bash
cd /opt/liorvix
pnpm run sync:job-connector -- --company="Example Corp"
```

至少检查 20 条真实岗位或当前全部不足 20 条的岗位：标题、外部 ID、官方 URL、地点、工作方式、岗位类型、经验、薪资、截止日期和正文。解析丢失、地区过滤、官方关闭和行级失败必须分别统计。

没有官方证据的字段保持为空；`unavailable_on_official_source` 只能显示为“官网未提供”，不能算解析失败。

### 6. 判断是否需要新连接器

- 已登记的 Greenhouse、Ashby、Lever、Phenom 等连接器：按现有规则和真实样本验收即可。
- Workday：使用官方详情调度规则，确认官方链接和公司标识后再进入队列。
- 新 ATS 或来源族：先按 `docs/job-company-field-connector-runbook.md` 增加连接器、字段规则、脱敏 fixture 和测试，再部署，不要把公司强行标成已配置。

来源证据不足时，台账状态保持 `discovery_required`，主 Feed 仍可同步岗位，但官方字段补全不会猜测接口或字段。

### 7. 生产写入和验收

通过样本 dry-run 后才允许生产写入或只补缺失字段回填。必须同时记录：

- 目标 Supabase project ref 和 UTC 时间。
- dry-run 的官方接收、解析、过滤、匹配和候选写入数量。
- 写入后的生产数据库字段证据和 `job_company_sources` 台账。
- 公网 `/api/jobs`、至少一个 `/api/jobs/{id}` 和后台同步大屏抽样结果。

数据库、API 和页面三处不一致时，暂停当前公司，不重建岗位、不清空岗位、不修改生命周期。

## 新公司暂时没有岗位

当前 `audit:company-source-matrix` 主要从活跃 `collector_feed` 岗位聚合公司。如果上游公司已经建立但暂时没有任何岗位，美国台账脚本可能不会自动生成该公司行，导致大屏没有卡片。

遇到这种情况：

1. 先确认上游目录仍返回该公司，并完成一次抓取。
2. 不要用 0 伪造岗位数量，也不要直接关闭公司。
3. 记录为台账接入缺口，优先补充“以上游目录为公司全集”的矩阵同步逻辑；临时处理必须使用生产数据库的显式、可审计台账写入。

## 发布和回滚

## 接入后的大屏操作

公司进入 `job_company_sources` 且完成一次目录快照后，后台同步大屏会自动生成卡片。卡片详情中的“处理该公司”使用 `feed:company:<upstream_company_id>` 独立游标；“补全官方字段”使用 `official:*` 独立游标。两者均有页数/批次预算，不会回退主 Feed，也不会因字段失败关闭岗位。

只有拥有 `admin.job-sync.write` 权限的管理员能执行操作。所有操作通过 `POST /api/admin/job-sync-dashboard/actions`，并写入 `admin_audit_logs`。如果看到“公司没有上游 ID”“上游未声明公司过滤能力”或“官方写入开关未启用”，不要绕过保护直接改游标；先补齐来源台账或连接器配置，再重新执行 dry-run。

只改上游接口字段时，在上游服务器执行：

```bash
cd /opt/global-jobs
docker compose build api worker beat
docker compose up -d api worker beat
docker compose ps
```

不要为接口字段变更重建数据库或 Redis。修改前先备份 `app/main.py`，例如 `app/main.py.backup.before-<task>-<UTC时间>`。回滚时恢复备份后重新 build/up，并验证目录接口。

美国应用代码、迁移或连接器有变化时，使用仓库的 `scripts/deploy-production.sh`，不要把 `.env.local`、密钥或历史发布包上传到服务器。

## 常见问题定位

| 现象 | 优先检查 |
| --- | --- |
| 大屏没有新公司 | 上游目录是否返回；台账是否有行；`upstream_company_id` 是否一致 |
| 上游数量显示未知 | 先看 `official_count_status`：`capped_unavailable` 是官网接口上限而非 0；否则检查 `official_open_jobs` 及 `official_count_observed_at`，再检查快照是否过期 |
| 状态显示失败但上游成功 | `latest_run_status` 与 `job_sync_state` 的主 Feed/官方游标是否混淆 |
| 401 或目录为空 | `JOBS_FEED_URL`、`X-Integration-Key` 和上游路径是否正确 |
| 岗位数量突然变 0 | 先检查上游快照和抓取失败，不能直接执行关闭或全量重建 |
| 字段待处理很多 | 查看官方连接器 dry-run、`official:*` 游标和失败队列；官网未提供不算失败 |

## 完成标准

- 新公司在上游目录和美国来源台账中均存在，ID 一致。
- 至少一页真实样本 dry-run 通过，字段证据和过滤数量可解释。
- 主 Feed 和官方字段是独立状态，游标、租约和失败原因可在大屏钻取看到。
- 生产数据库、公网 API、岗位详情页和大屏数量口径一致。
- 连续三个同步周期稳定后，才把公司标记为常规来源。
