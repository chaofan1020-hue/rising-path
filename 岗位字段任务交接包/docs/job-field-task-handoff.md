# 岗位字段任务交接单

更新时间：2026-09-01

这份文档用于在没有本次对话记录的电脑上继续执行岗位字段补全。文档只保存在本地项目目录，服务器不作为文档存储；以项目文件和生产服务器状态为准，不要依赖聊天内容。开始前必须阅读 [`job-company-field-connector-runbook.md`](job-company-field-connector-runbook.md)。

## 生产连接信息

- 网站：`https://liorvix.com`
- SSH 用户：`ubuntu`
- 服务器地址：`43.172.117.125`
- 服务器项目目录：`/opt/liorvix`
- 生产 Supabase project ref：`weqvdtdjdzmqflhwobec`
- 生产回归基线：`/opt/liorvix/output/connector-regression-production.json`
- 本地密钥文件名：`正式发布服务器密钥.pem`

密钥文件只用于 SSH 认证，不能复制到 Git、日志、fixture 或文档；不要在命令输出中打印密码、Supabase key 或其他环境变量。

## 新电脑开始方式

1. 将项目目录和密钥文件放在同一台电脑，确认使用 `pnpm`，不要使用 npm/yarn。
2. 先只读连接生产服务器，确认目录和 project ref：

```bash
ssh -i "<项目根目录>/正式发布服务器密钥.pem" ubuntu@43.172.117.125 \
  'cd /opt/liorvix && sudo -n grep "^SUPABASE_URL=" .env.local | cut -d/ -f3 | cut -d. -f1'
```

输出应为 `weqvdtdjdzmqflhwobec`。如果不是，立即停止，不要运行写入命令。当前服务器 `.env.local` 为 `root:root`、权限 `600`，生产脚本需通过 `sudo -n bash -c` 加载该文件；不要修改其权限或打印环境变量。

PowerShell 可使用以下等价命令（在项目根目录执行）：

```powershell
  $key = Join-Path (Get-Location) '正式发布服务器密钥.pem'; & ssh.exe -i $key ubuntu@43.172.117.125 'cd /opt/liorvix && sudo -n grep "^SUPABASE_URL=" .env.local | cut -d/ -f3 | cut -d. -f1'
```

3. 在服务器执行命令时统一使用 `/opt/liorvix/.env.local` 的生产环境；本地工作区 `.env.local` 不代表生产库。

如需在新电脑保存一份回归基线，可只读下载（不包含任何密钥）：

```bash
scp -i "<项目根目录>/正式发布服务器密钥.pem" ubuntu@43.172.117.125:/opt/liorvix/output/connector-regression-production.json output/connector-regression-production.json
```

## 已完成公司

已完成首轮生产回填、字段证据核对和全公司回归的公司：

- Greenhouse、Ashby、Lever、Phenom 等此前已登记连接器公司（回归基线覆盖全部 75 家公司）。
- Workday：Houlihan Lokey、Bain Capital、Apollo Global Management、The Carlyle Group、Adobe、Brookfield、PIMCO、Blackstone、Barclays、Ares Management、Intel、State Street、Fidelity Investments、Bank of America、Vanguard、NVIDIA、Wells Fargo、Accenture。

已处理公司合计 45 家。此前已登记连接器公司的完整清单为：

- Greenhouse（17 家）：Cloudflare、Stripe、Datadog、Coinbase、Asana、Brex、Databricks、Figma、GitLab、Point72、Reddit、Robinhood、Twilio、Discord、TPG、Bridgewater Associates、General Atlantic。
- Ashby（8 家）：Runway、OpenAI、Cursor、Notion、Perplexity、Ramp、Vanta、Linear。
- Lever（1 家）：Palantir。
- Phenom（1 家）：Boston Consulting Group。
- Workday（18 家）：Houlihan Lokey、Bain Capital、Apollo Global Management、The Carlyle Group、Adobe、Brookfield、PIMCO、Blackstone、Barclays、Ares Management、Intel、State Street、Fidelity Investments、Bank of America、Vanguard、NVIDIA、Wells Fargo、Accenture。

详细数字和异常原因见 [`job-company-field-execution-log.md`](job-company-field-execution-log.md)。不得把某家公司 Workday URL、字段路径或岗位数量复制到另一家公司。

## PIMCO 完成快照

- 生产在招岗位：117。
- 官方详情：首批 20 条 + 剩余 97 条，全部 dry-run 成功并写入，失败 0。
- 字段覆盖（均有官方证据）：地点 117，岗位类型 116，经验 83，薪资 64，截止日期 7，工作方式 0。
- 1 条岗位类型保持“未知”，工作方式为空是因为官方详情未提供结构化证据；这些不是失败。
- 经验超过 30 年的异常值：0；117 条均保持开放状态。
- 全公司回归：`regressions: []`，生产 project ref 为 `weqvdtdjdzmqflhwobec`。

## Blackstone 完成快照

- 生产在招岗位：139。
- 首批 20 条和剩余 119 条均已 dry-run；最终成功写入 137 条，3 条无公开正文，44 条详情没有新增字段，失败 0。
- 字段覆盖（均有官方证据）：地点 139，岗位类型 136，经验 126，薪资 109，截止日期 0，工作方式 0。
- 截止日期和工作方式为空是因为官方 Workday 没有提供可验证字段；经验异常值（超过 30 年）为 0，139 条均保持开放状态。
- 中途遇到 HTTP 429 后已使用服务器脚本的请求间隔和退避重试完成；生产回归仍为 `regressions: []`。

## Barclays 完成快照

- 官方 Workday：`https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays`。
- 生产在招岗位：158。
- 首批 20 条中 19 条详情成功并写入；剩余 138 条中 123 条成功并写入。合计写入 142 条，13 条无公开正文、3 条没有缺失字段，失败 0。
- 字段覆盖（有值 / 已验证）：地点 158 / 158，岗位类型 146 / 144，经验 15 / 14，薪资 0 / 0，截止日期 74 / 74，工作方式 1 / 1。
- 岗位 `13695` 实习官方没有候选人年限，保持空；岗位 `13773` 校招官方为 `Entry Level`，标准化为 `0–1 年`。
- 2 条旧记录的经验证据残留但没有值，已由审计脚本按“无可展示值不计 verified”处理；未修改岗位数据或上下架状态。
- 158 条均保持 `is_active=true` 且 `is_closed=false`；公网抽查两个岗位返回 200，`https://liorvix.com/api/health` 返回 `{"status":"ok"}`。
- 回归文件：`output/connector-regression-after-barclays.json`；结果 `company_count: 75`、`regressions: []`。

## Ares Management 完成快照

- 官方 Workday：`https://aresmgmt.wd1.myworkdayjobs.com/en-US/External`；host `aresmgmt.wd1.myworkdayjobs.com`，tenant `aresmgmt`，site `External`。
- 生产在招岗位：181；全量 `collector_feed` 记录 195 条，其中历史关闭 14 条。181 条在招岗位均保持 `is_active=true` 且 `is_closed=false`。
- 首批 20 条：dry-run 20/20 成功，写入 20/20，失败 0。
- 剩余批次：以实际处理的最后 ID `21464` 为游标，dry-run 候选 161 条、详情成功 147 条、跳过 14 条、失败 0；随后写入 147 条，跳过 5 条无公开正文和 9 条无新增字段。
- 合计成功写入 167 条，失败 0；未修改岗位 ID、上下架状态或删除岗位。
- 字段覆盖（有值 / 有值且 verified）：地点 181 / 181，岗位类型 176 / 176，经验 165 / 165，薪资 132 / 132，截止日期 0 / 0，工作方式 1 / 1。
- 经验超过 30 年的异常值为 0。岗位 `58367` 有历史经验 `verified` 证据但无经验值，按值感知统计不计入 verified，保持待复核，不补猜测值。
- 数据库证据 URL 的 host 与 Ares 官方 host 一致；公网 `/api/jobs/21409`、`/jobs/21409` 和 `/api/health` 均返回 200。未登录浏览器访问 `/jobs/21409` 会进入登录页，因此字段展示以生产数据库和公开岗位 API 为验收依据，不将登录页误判为字段缺失。
- 回归：`company_count: 75`、`regressions: []`，文件为 `/opt/liorvix/output/connector-regression-after-ares-management.json`。

## Intel 完成快照

- 官方 Workday：`https://intel.wd1.myworkdayjobs.com/External`；host `intel.wd1.myworkdayjobs.com`，tenant `intel`，site `External`。
- 生产在招岗位：236；全量 `collector_feed` 记录 294 条，其中历史关闭 58 条。236 条在招岗位均保持 `is_active=true` 且 `is_closed=false`。
- 首批 20 条：20 条详情成功并写入，失败 0，最后处理 ID `24622`。
- 后续十一个游标批次分别写入 19、19、20、20、20、18、19、19、20、16、11 条；失败 0。
- 合计写入：221 条；无公开正文跳过 12 条；无新增字段 3 条；最后一次有界 dry-run 的首 20 条均为 `no_new_fields`，未发现可继续补充的字段。
- 字段覆盖（有值 / 已验证）：地点 `236 / 236`，工作方式 `6 / 6`，岗位类型 `225 / 225`，经验 `203 / 203`，薪资 `0 / 0`，截止日期 `0 / 0`。
- 薪资和截止日期为空是因为 Intel 官方 Workday 没有可验证字段；经验只接受官方明确的候选人要求。详情不可用仅跳过字段，不作为下架证据。
- 公网 `/api/health`、`/api/jobs/57874`、`/jobs/57874` 和 Intel 官方详情页均返回 200；全公司严格回归为 `company_count: 75`、`regressions: []`。
- 回归文件：`/opt/liorvix/output/connector-regression-after-intel-final.json`。

## State Street 完成快照

- 官方 Workday：`https://statestreet.wd1.myworkdayjobs.com/Global`；host `statestreet.wd1.myworkdayjobs.com`，tenant `statestreet`，site `Global`。官方详情 URL 使用 `/job/...` 稳定岗位路径。
- 生产初始在招岗位为 257 条；最终审计为 252 条，外部 ID 为 285 条。期间生产源发生自然刷新，回填脚本始终只更新 `is_active=true` 的字段，不修改 `is_active` / `is_closed`，因此不把这 5 条数量变化归因于字段回填。
- 批次写入数量：`20、20、16、16、18、15、16、15、13、17、18、18、13`，合计写入 215 条；无公开正文跳过 35 条，无新增字段跳过 5 条，失败 0。最后处理 ID 为 `57963`；`after-id=57963` 的最终 dry-run 候选为 0。
- 最终字段审计（有值 / 已验证）：地点 `252 / 252`，岗位类型 `217 / 217`，经验 `137 / 137`，工作方式 `0 / 0`，薪资 `0 / 0`，截止日期 `0 / 0`。官方没有可验证的工作方式、薪资或截止日期时保持为空；经验只接受官方明确的候选人要求。
- 公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/57963` 和 State Street 官方详情页均返回 HTTP 200；岗位 API 展示地点、岗位类型、经验和官方正文。
- 用最终写入后的即时生产快照作为基线运行 strict 回归，结果为 `company_count: 75`、`regressions: []`；文件为 `/opt/liorvix/output/connector-regression-after-state-street-final.json`，即时基线为 `/opt/liorvix/output/connector-regression-before-state-street-final.json`。旧的长期基线同时检测到多家公司自然岗位数量下降，不能作为本轮字段回填回归判断。

## Fidelity Investments 完成快照

- 官方 Workday：`https://fmr.wd1.myworkdayjobs.com/en-US/fidelitycareers`；host `fmr.wd1.myworkdayjobs.com`，tenant `fmr`，site `fidelitycareers`。官方详情 URL 使用 `/job/...` 稳定岗位路径。
- 生产初始在招岗位为 377 条；最终审计为 381 条，外部 ID 为 444 条，历史关闭记录 63 条。期间生产源自然刷新，回填脚本只更新 `is_active=true` 的字段，不修改 `is_active` / `is_closed` 或岗位 ID。
- 首批 20 条：18 条写入，2 条无公开正文，失败 0，最后处理 ID `27098`。
- `after-id=27145` 首轮：324 条候选，243 条写入；80 条无新增字段、1 条无公开正文，失败 0，最后处理 ID `60765`。
- 发现官方详情正文明确提供 `base salary range`，已为回填脚本补上官方正文薪资回退解析。修复后全量 dry-run 识别 127 条薪资，最终写入 314 条记录，实际补入薪资 127 条；写入阶段失败 0。
- 最终字段审计（有值 / 已验证）：地点 `381 / 381`、岗位类型 `380 / 380`、经验 `177 / 191`、薪资 `128 / 128`、截止日期 `0 / 0`、工作方式 `35 / 35`。经验已验证数包含 14 条历史 verified 证据但无当前可展示值，不据此推断经验。
- 公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/27077`、`https://liorvix.com/jobs/27077` 和 Fidelity 官方详情页均返回 200；岗位 `27077` API 展示官方地点、岗位类型、经验、薪资和 verified evidence。
- 最终即时基线为 `/opt/liorvix/output/connector-regression-before-fidelity-final2.json`，strict 回归文件为 `/opt/liorvix/output/connector-regression-after-fidelity-final2.json`；结果 `company_count: 75`、`regressions: []`。服务 `liorvix` 保持 active。
- Fidelity 已完成本轮字段回填；随后 Bank of America 也已完成，下一家公司按岗位量顺序为 Vanguard。

## 生产自动队列（已接管后续公司）

生产已启用全局岗位同步与官方详情轮转队列：

- `collector_feed` 增量同步每 10 分钟优先运行；单条异常字段会被隔离，不再阻塞全站游标。
- Workday 公司按 `official:workday:<company>` 保存独立游标，每轮每家公司 20 条、每轮 3 家；Greenhouse、Ashby、Lever、Phenom 等已登记连接器按 `official:registered_connector:<company>` 保存独立游标。详情失败只重试当前公司批次，不会卡住主岗位同步或其他公司。
- 连接器回填脚本支持 `--after-id`，worker 会把每家公司的 `job_sync_state.cursor` 传入脚本；因此每批按岗位 ID 向后推进，不会重复从第一条岗位开始。
- 生产官方请求间隔为 `1200ms`，用于降低 Workday 限流风险。
- 新岗位先由增量同步写入，下一轮对应公司队列自动补齐有官方证据的缺失字段；不会修改上下架状态和岗位 ID。
- 当前官方详情队列每家公司每轮最多处理 100 条、每轮最多 3 家；Workday 详情最多 3 个受控并发 worker，但全局仍保持 `JOB_BACKFILL_REQUEST_DELAY_MS=1200` 请求启动间隔。
- 生产开关已确认：`JOBS_OFFICIAL_DETAILS_AUTO_SYNC=true`、Workday 写入开关已开启，每轮每家公司最多 20 条、每轮最多 3 家。Fidelity 使用的官方正文薪资回退解析已部署到生产脚本，后续 Fidelity 及其他 Workday 公司新增岗位可沿用该规则。
- 自动处理不是实时单条触发，而是由增量同步和官方详情轮转队列按周期处理；只有岗位被同步为 `collector_feed` 且保留官方 Workday/连接器 URL 时才会进入对应队列。没有官方证据的字段继续留空，不会用模型猜测补齐。
- 当前队列已在生产运行；一轮中处理 Accenture `9` 条、PIMCO `1` 条、Vanguard `1` 条更新且失败均为 `0`。随后一轮 Accenture `11` 条、Vanguard `4` 条成功，PIMCO 出现 `1` 条瞬时失败并保留游标 `9158`；同一游标的生产 dry-run 随后为 `failed: 0`、20 条 `no_new_fields`，证明失败只隔离在 PIMCO 当前批次。主增量同步连续多页 `failed: 0`，生产配置为每轮 3 家。

因此不需要再人工按公司接力执行下面的首批命令。下面的 State Street 步骤保留为队列异常时的人工审计/恢复流程，执行前仍须遵守 runbook 的 dry-run 和生产环境确认。

## 人工恢复流程：State Street（已完成，作为故障恢复参考）

按下面顺序执行，每次只推进一家公司。State Street 的来源、tenant、host、site 和稳定岗位 ID 必须重新独立确认，不能复制 Intel 的 URL 或字段假设。

1. 先独立确认 State Street 的官方 Workday host、tenant、站点和岗位 ID，再做生产 dry-run（不带 `--write`），最多 20 条真实样本：

```bash
sudo -n bash -c 'cd /opt/liorvix && set -a && . ./.env.local && set +a && JOB_BACKFILL_CONCURRENCY=1 JOB_BACKFILL_REQUEST_DELAY_MS=1200 pnpm exec tsx scripts/backfill-official-job-details.ts --company="State Street" --limit=20'
```

2. 对这 20 条完成数据库字段和官方 URL 抽样，再请求公网 `/api/jobs` 与至少一个 `/api/jobs/{id}`，确认地点、岗位类型、经验、薪资、截止日期只在有证据时出现。确认在招岗位数量没有下降后，才写入：

```bash
sudo -n bash -c 'cd /opt/liorvix && set -a && . ./.env.local && set +a && JOB_BACKFILL_CONCURRENCY=1 JOB_BACKFILL_REQUEST_DELAY_MS=1200 JOB_BACKFILL_WRITE_ENABLED=true pnpm exec tsx scripts/backfill-official-job-details.ts --company="State Street" --limit=20 --write'
```

3. 写入后查询公司覆盖率：

```bash
sudo -n bash -c 'cd /opt/liorvix && set -a && . ./.env.local && set +a && pnpm run audit:connector-backfill -- --company="State Street"'
```

4. 找到最后一条已处理岗位 ID 后，先对剩余岗位 dry-run，再使用同一个 `--after-id` 写入。不要直接猜 ID，也不要跳过 dry-run。

5. 每次写入后都运行全公司回归：

```bash
sudo -n bash -c 'cd /opt/liorvix && set -a && . ./.env.local && set +a && pnpm exec tsx scripts/audit-connector-company-regression.ts --out=output/connector-regression-after-state-street.json --baseline=output/connector-regression-production.json --strict'
```

结果必须包含 `company_count: 75` 和 `regressions: []`。当前生产 `package.json` 未注册 `audit:connector-regression` 快捷命令时，使用等价直接入口：`pnpm exec tsx scripts/audit-connector-company-regression.ts --out=... --baseline=... --strict`。若岗位数下降、详情失败异常增多或 project ref 不一致，停止当前公司并记录原因，不扩大重试。

## 固定规则

- 字段回填只补缺失或非 `verified` 字段，不修改 `is_active` / `is_closed`，不删除岗位，不重建岗位 ID。
- 经验只接受官方明确的候选人工作经验；排除公司历史、产品周期、roadmap、contract/eligibility window、技能熟练度和其他背景年限。
- 薪资必须同时有官方币种和金额；截止日期必须来自官方结构化字段或官方详情页明确标签。没有证据就留空。
- 详情不可用、403、429、超时或反爬只记为待复核，不视为岗位下架。
- 遇到官网限流时将 `JOB_BACKFILL_CONCURRENCY` 降到 1，并设置 `JOB_BACKFILL_REQUEST_DELAY_MS=1200`；脚本会对 408/425/429/5xx 做退避重试。
- 每家公司至少完成 20 条真实样本、生产 dry-run、只补字段写入、数据库/API/页面抽样和全公司回归后，才能进入下一家公司。

## 继续顺序

PIMCO、Blackstone、Barclays、Ares Management、Intel、State Street、Fidelity Investments、Bank of America、Vanguard、NVIDIA、Wells Fargo 已完成。后续不再人工逐家公司接力；全局队列会按公司独立游标持续处理 Accenture、Citigroup 及已登记连接器公司。每家公司仍需独立确认官方 host、tenant、site、稳定 ID 和详情字段；来源不明的公司先做探测，不直接回填。

## Bank of America 完成快照

- 官方入口：`https://careers.bankofamerica.com/en-us/job-search.html?ref=search&search=getAllJobs`；详情由 Bank of America 官方招聘站对应到 Workday，host `ghr.wd1.myworkdayjobs.com`，tenant `ghr`，site `lateral-us`。
- 生产在招岗位 459 条，历史关闭记录 43 条。首批 20 条 dry-run 中 16 条无新增字段、4 条无公开正文；`after-id=26982` 写入 17 条，`after-id=27002` 写入 144 条，合计写入 161 条，失败 0。
- 最终字段覆盖（有值 / 已验证）：地点 `459 / 459`、岗位类型 `409 / 406`、经验 `211 / 230`、薪资 `232 / 232`、截止日期 `0 / 0`、工作方式 `54 / 54`。历史 verified 但无当前经验值的记录不据此补猜测。
- 发现并修复正文薪资回退对客户收入区间 `$20-50 m` 的误识别；加入 revenue/assets/portfolio/loan 业务指标语境排除规则，本地连接器测试、标准字段测试和 TypeScript 检查均通过，生产源码已核对部署。
- 生产游标末端 `after-id=62429` dry-run 为 0 候选；公网健康接口、岗位 API、岗位页和官方详情页均返回 200。岗位 `26984` API 展示官方 Boston 地点、`$150,000.00 - $235,000.00` 薪资和 verified evidence。
- 当前时点 strict 回归：`company_count: 75`、`regressions: []`；基线 `/opt/liorvix/output/connector-regression-before-bank-of-america-final.json`，结果 `/opt/liorvix/output/connector-regression-after-bank-of-america-final.json`。旧长期基线的数量变化属于生产自然刷新。

## Vanguard 完成快照

- 官方 Workday：`https://vanguard.wd5.myworkdayjobs.com/vanguard_external`；host `vanguard.wd5.myworkdayjobs.com`，tenant `vanguard`，site `vanguard_external`。详情 URL 使用无语言段的 `/vanguard_external/job/.../apply` 路径。
- 生产在招 `collector_feed` 岗位 415 条，均保持 `is_active=true` 且 `is_closed=false`。分段写入为 20、99、99、92 条，合计 310 条，失败 0；末端 `after-id=62077` dry-run 候选 0。
- 最终字段审计（有值 / 已验证）：地点 `415 / 411`、岗位类型 `413 / 413`、经验 `310 / 332`、薪资 `3 / 3`、截止日期 `0 / 0`、工作方式 `77 / 77`。经验 verified 数含历史证据残留但无当前可展示值的记录，不据此补猜测。
- 已修复 Workday CXS 详情 URL 对无语言段 URL 的解析，并保留带语言段 URL；修复已部署，未修改岗位 ID、上下架状态或历史记录。
- 岗位 `9263` 已完成生产数据库、公开 API、岗位页和官方详情抽查；公网 `/api/health`、`/api/jobs/9263`、`/jobs/9263` 和官方详情页均返回 200。
- 当前时点 strict 回归：`company_count: 75`、`regressions: []`；即时基线 `/opt/liorvix/output/connector-regression-before-vanguard-final.json`，结果 `/opt/liorvix/output/connector-regression-after-vanguard-final.json`。

本轮还恢复了服务器被错误覆盖的 `.env.local`，正确生产 project ref 为 `weqvdtdjdzmqflhwobec`；旧文件备份在 `/root/liorvix-env-before-weqv-20260901`。`scripts/deploy-production.sh` 已加入 project ref 校验，生产配置文件保持 `root:root`、权限 `600`。下一家公司是 NVIDIA，先独立确认其 Workday host、tenant、site、稳定 ID 和 20 条真实样本，再决定是否回填。

## NVIDIA 完成快照

- 官方 Workday：`https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`；host `nvidia.wd5.myworkdayjobs.com`，tenant `nvidia`，site `NVIDIAExternalCareerSite`。官方详情 URL 使用 `/job/...` 稳定路径。
- 生产初始来源矩阵为 932 条在招岗位，最终审计为 938 条；历史关闭记录 101 条，外部 ID 1,039 条。数量变化发生于生产源刷新期间，字段回填只更新缺失或未验证字段。
- 前 40 条真实样本已由自动队列追平；随后人工批次正式写入 `19、98、100、97、100、56` 条，合计 470 条，失败 0。末端 `after-id=62639` dry-run 为 0 候选。
- 最终字段审计（有值 / verified 证据）：地点 `938 / 938`、岗位类型 `841 / 841`、经验 `524 / 528`、薪资 `0 / 0`、截止日期 `0 / 0`、工作方式 `15 / 15`。经验 verified 数包含历史证据但当前没有可展示值的记录，不据此补猜测。
- 岗位 `25328` 已完成生产数据库、公开 API、岗位页和官方详情抽查；公网 `/api/health`、`/api/jobs/25328`、`/jobs/25328` 和官方详情页均返回 200。
- 当前时点 strict 回归：`company_count: 75`、`regressions: []`；即时基线 `/opt/liorvix/output/connector-regression-before-nvidia-final.json`，结果 `/opt/liorvix/output/connector-regression-after-nvidia-final.json`。

NVIDIA 完成后进入 Wells Fargo。最新来源矩阵显示其在招岗位约 1,075 条，观察到官方 host `wf.wd1.myworkdayjobs.com`；执行时独立确认了其 tenant、site、稳定 ID 和真实样本。

Wells Fargo 已完成：官方 Workday tenant 为 `wf`、site 为 `wellsfargojobs`，详情路径为 `/en-US/wellsfargojobs/job/...`。最终在招 1,076 条；完整 dry-run 为 507 条候选、474 条详情成功、235 条有新增字段、失败 0；正式写入更新 228 条、失败 0，末端 ID `62650`，最终 dry-run 候选为 0。最终字段审计为地点 `1,076 / 1,076`、工作方式 `47 / 46`、岗位类型 `1,042 / 1,042`、经验 `1,032 / 1,041`、薪资 `363 / 363`、截止日期 `0 / 0`；官网没有可验证截止日期，保持为空。全公司 strict 回归 `company_count: 75`、`regressions: []`，公网/API/官方详情抽样均返回 200。下一家公司为 Accenture，必须重新确认其官方 host、tenant、site、稳定 ID 和真实样本。

Accenture 已完成：官方 host `accenture.wd103.myworkdayjobs.com`、tenant `accenture`、site `AccentureCareers`；最终生产在招 2,380 条，官方字段队列游标 `46960 → 64264`，末端无候选并进入 10 分钟复查冷却。最终字段审计为地点 `2,380 / 2,292`、工作方式 `428 / 428`、岗位类型 `1,564 / 1,540`、经验 `1,134 / 1,429`、薪资 `710 / 710`、截止日期 `0 / 0`；失败 0。公网 `/api/health`、`/api/jobs/6767`、`/jobs/6767` 和官方详情页均返回 200，严格回归 `company_count: 75`、`regressions: []`。经验 verified 多于当前有值是历史证据残留，不据此补猜测；官网未提供可验证截止日期时保持为空。

## 2026-09-02 队列性能修复

- 根因是完成公司在官网未提供的字段仍被判定为候选，扫到末尾后游标清空，下一轮从头重复扫描。
- 现在完成一轮会保留末端岗位 ID；达到当前最大岗位 ID时不再启动详情子进程，并进入 10 分钟复查冷却。新增岗位仍会按更大的岗位 ID自动进入。
- Workday 详情请求最多 3 个并发 worker，仍由全局 `JOB_BACKFILL_REQUEST_DELAY_MS=1200` 限制请求启动间隔；生产实测 100 条批次约 122 秒、失败 0。

## 2026-09-02 生产运行复核

- 生产 project ref：`weqvdtdjdzmqflhwobec`；`liorvix.service=active`；公网 `/api/health` 返回 `{"status":"ok"}`。
- 发现服务器 `.env.local` 曾回到旧的批次 20、间隔 0.5 分钟配置，已备份为 `/root/liorvix-env-before-official-details-config-20260902` 后恢复为批次 100、间隔 0.1 分钟、每轮 3 家、Workday 并发 3、全局请求间隔 1200ms。
- Accenture 已完成并退出 focus；公平队列已继续处理其他公司。复核期间 Accenture、Bain Capital、Ares Management、Rothschild & Co、Adobe、Brookfield、State Street、Vanguard、Intel、Apollo Global Management、Wells Fargo、PIMCO 均无失败；Intel 游标已从 `24882` 推进到 `64073`。
- Intel/Blackstone 的旧租约没有被强制释放，而是自然过期；目前完成公司保留末端游标并按 10 分钟复查，避免从头重复扫描。
- 后续无需人工逐家公司启动脚本；只要队列正常，新增岗位会由 `collector_feed` 和对应公司的独立官方游标自动补齐有证据字段。
