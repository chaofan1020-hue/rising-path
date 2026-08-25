# 北美科技公司岗位池捕获计划

更新时间：2026-08-17

## 1. 已完成的基线检查

主服务器上的岗位抓取器为 `/opt/global-jobs`，由 API、Celery worker/beat、PostgreSQL 和 Redis 运行。当前数据库共有 75 家公司、97,906 条岗位；其中 Technology 分类有 35 家公司、39,135 条岗位。

当前 Technology 公司与岗位量如下（岗位量为数据库当前快照，不代表市场总量）：

| 公司 | 岗位数 | 来源边界 |
| --- | ---: | --- |
| Adobe | 860 | official |
| Amazon | 17,055 | official |
| Apple | 3,465 | Apple official API |
| Asana | 151 | official |
| Brex | 309 | official |
| Cloudflare | 418 | Greenhouse |
| Coinbase | 207 | Greenhouse |
| Cursor | 120 | official |
| Databricks | 850 | official |
| Datadog | 545 | Greenhouse |
| Discord | 53 | official |
| Duolingo | 71 | official |
| Elastic | 278 | official |
| Figma | 175 | official |
| GitLab | 210 | official |
| Google | 4,015 | official |
| Intel | 775 | official |
| Linear | 33 | official |
| Meta | 912 | official |
| Microsoft | 2,489 | official |
| MongoDB | 433 | official |
| NVIDIA | 2,193 | official |
| Notion | 141 | official |
| Okta | 373 | official |
| OpenAI | 785 | official |
| Palantir | 313 | official |
| Perplexity | 102 | official |
| Ramp | 141 | official |
| Reddit | 185 | official |
| Robinhood | 146 | official |
| Roblox | 240 | official |
| Runway | 48 | official |
| Stripe | 765 | Greenhouse |
| Twilio | 178 | official |
| Vanta | 101 | official |

## 2. 本轮已执行：Apple

- 已在 Technology catalog 注册 Apple，官方列表源为 `https://jobs.apple.com/api/v1/search`。
- 抓取范围为美国 `postLocation-USA` 与加拿大 `postLocation-CANC`，按 Apple `positionId` 去重。
- 已处理 Apple 对通用爬虫 UA 返回 403 的问题：列表和详情请求使用浏览器形态请求头；详情改用官方 `jobDetails/{id}` JSON 接口。
- 首次快照抓到 3,465 条；其中 71 条列表摘要短于质量阈值，已用官方详情接口全部补齐。
- 当前 Apple 质量结果：3,465 条开放岗位、3,465 条 `fetched_json` 详情、3,465 条 `complete`、0 个重复外部 ID、0 条详情错误。
- 远端 Apple 定向测试通过：`1 passed, 51 deselected`。镜像已重建，`api`、`worker`、`beat` 已重启。

首次 crawl run 仍保留 `partial` 状态，因为它准确记录了“列表入库时有 71 条短摘要”；详情修复后的数据库质量已是完整状态，不应将历史 warning 当作当前缺口。

## 3. 本轮复核与修复：BCG、Oliver Wyman、Cursor、Linear、Lazard

- **Boston Consulting Group**：官方 Phenom 源报告 899 条，数据库开放岗位 899 条；旧 Greenhouse 测试源已停用，4 条历史记录保留并关闭。列表抓取后 409 条短描述已通过官方详情页补齐，当前 899/899 无短描述。
- **Oliver Wyman**：官方 Phenom 源报告 344 条，数据库开放岗位 344 条；旧 Lever 源已停用，2 条历史记录保留并关闭。列表抓取后 218 条短描述已通过官方详情页补齐，当前 344/344 无短描述。
- **Cursor**：Ashby 官方源 114 条开放岗位（另有 6 条历史关闭），数量与源一致；职位链接均为可直接打开的 Ashby 详情 URL。
- **Linear**：Ashby 官方源 33 条开放岗位，其中 24 条地点明确为 `North America`；没有发现因地区名称过滤而漏收的岗位。
- **Lazard**：Oracle HCM 官方源 48 条开放岗位（另有 19 条历史关闭），与官方源一致；48 条链接均为 HTTPS，详情正文已覆盖 46 条，剩余 2 条为官方列表已提供但详情未返回正文的记录。

链接抽查结果：TPG 当前 17 条开放岗位全部返回 200；Rothschild & Co 已按官方页优先去重，当前 68 条开放岗位全部返回 200，历史 Tal 链接保留在审计字段；Citadel 当前 55 条开放岗位全部被 Cloudflare 按服务器出口返回 403，保留官方 canonical URL，不使用非官方镜像或绕过验证。

本轮数据已完成全量对账并同步到 Liorvix 公共岗位表：当前 36,796 条开放岗位，合并“北美”筛选可命中约 26,673 条，其中 28 条地点字段明确写作 `North America`。岗位源继续按美国、加拿大、英国、澳大利亚、香港和新加坡的目标地区边界同步。

## 4. 下一批公司捕获顺序

按“求职价值 × 北美岗位量 × 可稳定抓取性”分三波执行。每次只上线一个公司，完成验收后再进入下一个，避免一个反爬策略拖累全局任务。

### Wave A：北美核心雇主

Salesforce、Oracle、Cisco、IBM、ServiceNow、Workday、Dell Technologies、Qualcomm、AMD、Broadcom、Shopify、Uber、Airbnb、DoorDash、Lyft。

验收重点：美国/加拿大过滤是否真实生效、Workday/官方 API 分页是否能对账、职位详情是否能稳定补齐、是否需要把全球岗位拆成地区 scope。

### Wave B：成长型 SaaS、云和消费互联网

Snowflake、Confluent、HashiCorp、Zoom、Dropbox、Box、DocuSign、HubSpot、LinkedIn、Pinterest、Snap、GitHub、Instacart、Chime、Plaid。

验收重点：Greenhouse、Lever、Ashby、SmartRecruiters 等 ATS 的 source discovery 是否能得到稳定的 board token；同一职位多地区发布时以外部职位 ID 去重。

### Wave C：AI、开发者工具和高增长公司

Anthropic、Cohere、Scale AI、Hugging Face、xAI、Mistral AI、Anduril、Ramp 生态内的同类公司，以及经审核后新增的北美 AI 初创公司。

验收重点：对动态渲染和短期招聘页只使用官方公开接口、RSS、sitemap 或已授权的远端采集源；不把登录态、验证码绕过或个人账号 cookie 写入抓取器。

## 5. 单家公司接入流程

1. **登记**：写入 `companies` 与 `company_sources`，记录公司名、行业、官网 careers URL、来源类型、地区 scope 和 connector 配置；重复执行必须幂等。
2. **源探测**：优先检测官方 JSON/API，其次是 Greenhouse、Lever、Ashby、Workday、SmartRecruiters、iCIMS 等公开 ATS，再退回 sitemap/RSS/公开详情页。
3. **小样本验证**：先抓一页或不超过 20 条，确认标题、稳定外部 ID、URL、地点、部门和正文都能解析。
4. **全量抓取**：分页直到 `reported_total` 对账；若结果提前结束、第一页为空或分页超过上限，run 必须失败或 partial，不能静默写入不完整快照。
5. **详情修复**：对短描述、未验证详情和结构化字段缺失执行有界 repair；对 401/403/404 记录 `detail_unavailable`，不要无限重试。
6. **质量验收**：外部 ID 重复为 0，覆盖率达到来源报告值，详情完整率达到目标，错误原因可追踪；通过后才纳入夜间全量任务。
7. **上线观察**：连续 3 个周期稳定后再把公司标记为常规来源；每周复核来源 URL、分页总量、关闭岗位同步和详情错误率。

## 6. 运行指标与告警

| 指标 | 目标 | 动作 |
| --- | --- | --- |
| 来源覆盖率 | `discovered / expected >= 99%` | 低于目标标记 partial，暂停扩大该源 |
| 外部 ID 重复 | 0 | 立即停止该公司写入并检查去重键 |
| 详情完整率 | 抓取后 `>=95%`，repair 后 `>=99%` | 进入有界详情修复；403/404 单独归因 |
| 24 小时新鲜度 | 活跃公司至少 1 次成功/partial run | 连续 2 次失败转人工检查 |
| 请求错误率 | `<2%`，429/5xx 可重试 | 指数退避并限制并发；禁止无限重试 |
| 地区边界 | 美国/加拿大 scope 可审计 | 未能确认地区字段时不声称为北美完整池 |

当前 beat 已配置每日 crawl、详情 repair、listing promotion、enrichment、结构化字段回填和审计任务。新增公司必须复用这套任务，不另起临时 cron。

## 7. 安全与回滚

- 主服务器密码只用于本地 SSH 认证；不得进入 Git、Docker 镜像、环境变量日志、测试 fixture 或计划文档。
- 每次远端 connector/seed/services 修改前保留带日期的备份；出现连续失败时先停用该 `CompanySource`，保留已有岗位，不删除历史数据。
- 发现来源协议变化时优先回滚单个 connector 或 source 配置，不回滚数据库整体，不执行破坏性清库。
- 临时部署脚本在验证结束后删除，仓库只保留正式代码、测试和本计划文档。

## 8. 下一步执行清单

- [x] 检查现有公司与岗位池基线。
- [x] 注册并上线 Apple 官方北美源。
- [x] 完成 Apple 列表分页、去重和详情修复验证。
- [x] 切换 BCG、Oliver Wyman 到官方 Phenom，完成 899 + 344 条全量抓取与详情修复。
- [x] 复核 Cursor、Linear、Lazard 的官方源数量、链接和 `North America` 地点字段。
- [x] 抽查 Citadel、TPG、Rothschild 链接并记录上游 403/超时边界。
- [x] 将 `North America` 纳入地区识别器、公共岗位 API 和岗位筛选，并完成全量同步对账。
- [ ] 按 Wave A 顺序逐家公司做源探测和小样本验收。
- [ ] 每新增 5 家公司生成一次来源覆盖率、详情完整率和失败原因报告。
- [ ] 每周复核 Technology 公司清单，补齐关闭岗位同步和地区标签。
