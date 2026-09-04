# 岗位字段任务完成总结

更新时间：2026-09-01

## 本轮完成：Barclays

- 来源：Barclays 官方 Workday
- 官方地址：`https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays`
- 生产服务器：`43.172.117.125`，项目目录 `/opt/liorvix`
- Supabase project ref：`weqvdtdjdzmqflhwobec`
- 生产在招岗位：158，全部保持 `is_active=true` 且 `is_closed=false`
- 首批 20 条：19 条详情成功并写入，1 条无公开正文
- 剩余 138 条：123 条详情成功并写入，12 条无公开正文，3 条没有缺失字段
- 合计写入：142 条；失败：0

字段审计（有值 / 已验证）：

| 字段 | 结果 |
| --- | ---: |
| 地点 | 158 / 158 |
| 岗位类型 | 146 / 144 |
| 经验 | 15 / 14 |
| 薪资 | 0 / 0 |
| 截止日期 | 74 / 74 |
| 工作方式 | 1 / 1 |

经验抽查：岗位 `13695` 的实习页面没有候选人工作年限，保持空；岗位 `13773` 的校招页面明确为 `Entry Level`，已标准化为 `0–1 年`。2 条历史记录的旧经验证据没有对应字段值，已通过审计脚本按“无可展示值不计 verified”处理，没有修改岗位数据。

## 验收结果

- 公司审计：Barclays 在招岗位 158 条，字段结果如上。
- 全公司回归：`company_count: 75`，`regressions: []`。
- 回归文件：`output/connector-regression-after-barclays.json`。
- 公网抽查：`https://liorvix.com/api/jobs/13695`、`https://liorvix.com/api/jobs/13773` 均返回 200。
- 服务状态：`liorvix` active；`https://liorvix.com/api/health` 返回 `{"status":"ok"}`。
- 仅补缺失或未验证字段，没有删除岗位、重建 ID 或修改上下架状态。

## 本轮完成：Ares Management

- 来源：Ares Management 官方 Workday，host `aresmgmt.wd1.myworkdayjobs.com`，tenant `aresmgmt`，site `External`。
- 生产服务器：`43.172.117.125`，项目目录 `/opt/liorvix`；Supabase project ref：`weqvdtdjdzmqflhwobec`。
- 生产在招岗位：181，全部保持 `is_active=true` 且 `is_closed=false`；历史关闭记录 14 条未被字段任务改变。
- 首批 20 条：dry-run 20/20，写入 20/20，失败 0。
- 剩余 161 条候选：dry-run 147 条详情成功、14 条跳过、失败 0；写入 147 条，5 条无公开正文、9 条无新增字段。
- 合计写入 167 条，失败 0；最后处理 ID 为 `21464`。

字段审计（有值 / 有值且 verified）：

| 字段 | 结果 |
| --- | ---: |
| 地点 | 181 / 181 |
| 岗位类型 | 176 / 176 |
| 经验 | 165 / 165 |
| 薪资 | 132 / 132 |
| 截止日期 | 0 / 0 |
| 工作方式 | 1 / 1 |

岗位 `58367` 存在历史经验 `verified` 证据但没有经验值，已按值感知统计排除，不填入推断经验并标为待复核；经验超过 30 年异常值为 0。数据库中已验证证据 URL 均使用 Ares 官方 host。公网 `/api/jobs/21409`、`/jobs/21409` 和 `/api/health` 均返回 200；未登录浏览器访问岗位页会进入登录页，字段展示以数据库和公开岗位 API 为准。

## 验收结果

- 公司审计：Ares 在招岗位 181 条，地点 181、岗位类型 176、经验 165、薪资 132、截止日期 0、工作方式 1。
- 全公司回归：`company_count: 75`，`regressions: []`。
- 回归文件：`/opt/liorvix/output/connector-regression-after-ares-management.json`。
- 服务状态：`liorvix` active；公网 `/api/health` 返回 `{"status":"ok"}`。
- 生产 `package.json` 未注册 `audit:connector-regression` 快捷命令，本轮使用等价直接入口 `pnpm exec tsx scripts/audit-connector-company-regression.ts ...` 完成回归。
- 服务器 `.env.local` 为 `root:root`、权限 `600`，本轮数据库审计通过 `sudo -n` 显式加载，未修改权限和环境文件。

## 本轮完成：Intel

- 来源：Intel 官方 Workday，host `intel.wd1.myworkdayjobs.com`，tenant `intel`，site `External`。
- 生产在招岗位：236；全量 `collector_feed` 记录 294 条，其中历史关闭 58 条。236 条在招岗位均保持开放状态，字段任务未修改 `is_active` / `is_closed`。
- 首批 20 条：20 条详情成功并写入，失败 0，最后处理 ID `24622`。
- 后续分段：游标 `24622`、`24690`、`24774`、`24830`、`24862`、`24887`、`24911`、`24937`、`24968`、`41108`、`43981`，分别完成 19、19、20、20、20、18、19、19、20、16、11 条写入；无公开正文共跳过 12 条，失败 0，最后处理 ID `57874`。
- 合计写入：221 条；无公开正文跳过 12 条；无新增字段 3 条；失败 0。最后一次有界 dry-run 的首 20 条均为 `no_new_fields`，未发现可继续补充的字段。

字段审计（有值 / 已验证）：

| 字段 | 结果 |
| --- | ---: |
| 地点 | 236 / 236 |
| 岗位类型 | 225 / 225 |
| 经验 | 203 / 203 |
| 薪资 | 0 / 0 |
| 截止日期 | 0 / 0 |
| 工作方式 | 6 / 6 |

说明：Intel 官方 Workday 详情本轮没有提供可验证的薪资或截止日期字段，相关字段保持为空；工作方式只有 6 条具备明确官方证据。经验仅使用官方候选人要求中的明确年限，不从技能、公司背景或其他年限推断。

## 验收结果：Intel

- 官方来源已独立确认：`https://intel.wd1.myworkdayjobs.com/External`，官方详情 URL 使用 Intel 自有 Workday host。
- 生产 project ref：`weqvdtdjdzmqflhwobec`；生产在招岗位数写入前后均为 236。
- 公网抽查：`https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/57874`、`https://liorvix.com/jobs/57874` 和 Intel 官方详情页均返回 200；岗位 `57874` API 展示地点、岗位类型、经验和官方正文，薪资/截止日期无值。
- 全公司严格回归：`company_count: 75`、`regressions: []`；最终文件为 `/opt/liorvix/output/connector-regression-after-intel-final.json`。
- 仅补缺失或未验证字段，没有删除岗位、重建 ID 或修改上下架状态。

## 后续处理：生产自动队列已启用

生产已启用全局岗位同步与官方详情轮转队列：主 `collector_feed` 增量同步优先运行，Workday 公司使用独立的 `official:workday:<company>` 游标，已登记连接器公司使用独立的 `official:registered_connector:<company>` 游标，每轮处理 20 条、每轮 3 家。新岗位先由增量同步写入，随后由对应公司队列自动补齐有官方证据的字段；详情页失败只延后当前公司，不会阻塞其他公司，也不会改变岗位上下架状态或岗位 ID。连接器回填通过 `--after-id` 断点续跑，避免重复扫描同一家公司前面的岗位。

主同步已从此前的 `numeric field overflow` 卡点恢复，生产连续多页 `failed: 0`；官方队列已在同轮处理 Accenture、PIMCO、Vanguard。后续一轮中 Accenture 更新 11 条、Vanguard 更新 4 条，PIMCO 仅有 1 条瞬时失败并保留自己的游标，其他公司未受影响；该游标随后 dry-run 为 `failed: 0`。生产健康检查返回 `{"status":"ok"}`。

## State Street 完成快照

- 官方 Workday：`https://statestreet.wd1.myworkdayjobs.com/Global`；host `statestreet.wd1.myworkdayjobs.com`，tenant `statestreet`，site `Global`。
- 生产初始在招岗位为 257 条，最终审计为 252 条；外部 ID 为 285 条。期间生产源发生自然刷新，字段脚本只对 `is_active=true` 岗位补字段，不修改 `is_active` / `is_closed`。
- 共 13 个批次写入 `20、20、16、16、18、15、16、15、13、17、18、18、13` 条，合计 215 条；无公开正文跳过 35 条，无新增字段跳过 5 条，失败 0；最后处理 ID `57963`，其后的最终 dry-run 候选为 0。
- 最终字段覆盖（有值 / 已验证）：地点 `252 / 252`、岗位类型 `217 / 217`、经验 `137 / 137`、工作方式 `0 / 0`、薪资 `0 / 0`、截止日期 `0 / 0`。官方没有可验证证据的字段保持为空，经验只接受官方明确的候选人要求。
- 公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/57963` 和 State Street 官方详情页均返回 HTTP 200；岗位 API 展示官方正文和已验证字段。
- 最终写入后生成即时生产快照并运行 strict 回归：`company_count: 75`、`regressions: []`。结果文件为 `/opt/liorvix/output/connector-regression-after-state-street-final.json`，即时基线为 `/opt/liorvix/output/connector-regression-before-state-street-final.json`。旧长期基线因生产同步期间多家公司岗位自然变化而报数量下降，未将其作为字段回填回归。

## 本轮完成：Fidelity Investments

- 来源：Fidelity Investments 官方 Workday，host `fmr.wd1.myworkdayjobs.com`，tenant `fmr`，site `fidelitycareers`；官方地址为 `https://fmr.wd1.myworkdayjobs.com/en-US/fidelitycareers`。
- 生产 project ref：`weqvdtdjdzmqflhwobec`。初始在招岗位 377 条，最终审计 381 条；外部 ID 444 条，历史关闭记录 63 条。数量变化发生于生产源刷新期间，字段任务没有修改 `is_active` / `is_closed`、岗位 ID 或历史记录。
- 首批 20 条：18 条写入、2 条无公开正文、失败 0，最后处理 ID `27098`。
- `after-id=27145` 首轮：324 条候选，323 条详情成功，243 条写入；80 条无新增字段、1 条无公开正文、失败 0，最后处理 ID `60765`。
- 抽查发现官方详情正文中的明确 `base salary range` 未被旧回填脚本读取。已补上官方正文薪资回退解析；本地 `pnpm run test:job-connectors`、`pnpm run test:job-standard-fields`、`pnpm ts-check` 均通过，生产脚本经哈希核对后替换。
- 修复后全量 dry-run：381 条候选、381 条详情成功、316 条有新增字段，识别 127 条官方薪资；最终写入：380 条详情成功、314 条实际更新、66 条无新增字段、1 条无公开正文、失败 0，实际补入薪资 127 条。

最终字段审计（有值 / 已验证）：

| 字段 | 结果 |
| --- | ---: |
| 地点 | 381 / 381 |
| 岗位类型 | 380 / 380 |
| 经验 | 177 / 191 |
| 薪资 | 128 / 128 |
| 截止日期 | 0 / 0 |
| 工作方式 | 35 / 35 |

经验已验证数包含 14 条历史 verified 证据但无当前可展示经验值，不据此推断年限；官方详情没有可验证截止日期时保持为空。公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/27077`、`https://liorvix.com/jobs/27077` 和 Fidelity 官方详情页均返回 HTTP 200；岗位 `27077` API 展示地点、岗位类型、经验、官方薪资 `$67,000-$127,000` 及 verified evidence。

最终即时生产基线为 `/opt/liorvix/output/connector-regression-before-fidelity-final2.json`，strict 回归文件为 `/opt/liorvix/output/connector-regression-after-fidelity-final2.json`，结果为 `company_count: 75`、`regressions: []`；服务 `liorvix` 保持 active。Fidelity Investments 本轮完成后，下一家公司为 Bank of America。

本地 Node 阻塞也已处理：Codex 工作区提供的 Node `v24.19.0` 已加入当前 Windows 用户 PATH；当前终端验证为 Node `v24.19.0`、pnpm `11.19.0`。

## 本轮完成：Bank of America

- 来源：Bank of America 官方招聘站对应的 Workday 详情源，host `ghr.wd1.myworkdayjobs.com`，tenant `ghr`，site `lateral-us`；官网入口为 `https://careers.bankofamerica.com/en-us/job-search.html?ref=search&search=getAllJobs`。
- 生产 project ref：`weqvdtdjdzmqflhwobec`。生产在招岗位 459 条，历史关闭记录 43 条；字段回填没有修改 `is_active` / `is_closed`、岗位 ID 或历史记录。
- 官方岗位详情样本确认提供稳定 requisition ID、地点、Full time、岗位正文、经验要求、班次和部分岗位的 Pay Transparency 薪资。详情 URL 使用 `https://ghr.wd1.myworkdayjobs.com/en-us/lateral-us/job/...`。
- 首批 20 条 dry-run：16 条详情成功但无新增字段，4 条无公开正文，失败 0；从 `after-id=26982` 写入 17 条；剩余 `after-id=27002` dry-run 发现 143 条可写入，最终写入 144 条，失败 0。生产自然刷新使该批次最终抓取 150 条详情，其中 9 条无公开正文、6 条无新增字段。
- 发现正文薪资回退规则会把客户收入区间 `$20-50 m` 误当薪资；已收紧 `extractSalaryFromDescription`，排除 revenue/assets/portfolio/loan 等业务指标语境，并加入回归测试。修复后 Bank of America 批次薪资候选从 74 条降为 73 条，未写入业务收入金额；生产源码已按 SHA256 核对部署。

最终生产字段审计（有值 / 已验证）：

| 字段 | 结果 |
| --- | ---: |
| 地点 | 459 / 459 |
| 岗位类型 | 409 / 406 |
| 经验 | 211 / 230 |
| 薪资 | 232 / 232 |
| 截止日期 | 0 / 0 |
| 工作方式 | 54 / 54 |

经验已验证数包含历史 verified 证据但无当前可展示经验值的记录，不据此推断年限；官方详情没有可验证截止日期时保持为空。公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/26984`、`https://liorvix.com/jobs/26984` 和 Bank of America 官方详情页均返回 HTTP 200。岗位 `26984` API 展示 Boston、官方薪资 `$150,000.00 - $235,000.00`，薪资 evidence 状态为 `verified`。

生产游标末端 `after-id=62429` dry-run 为 0 候选。以当前时点生产快照 `/opt/liorvix/output/connector-regression-before-bank-of-america-final.json` 为基线的 strict 回归结果为 `company_count: 75`、`regressions: []`，最终文件为 `/opt/liorvix/output/connector-regression-after-bank-of-america-final.json`。旧长期基线因多家公司岗位自然刷新会报告数量变化，不作为本轮字段回填回归依据。

Bank of America 本轮生产字段回填完成；下一家公司按岗位量顺序为 Vanguard。

## 本轮完成：Vanguard

- 来源：Vanguard 官方 Workday，host `vanguard.wd5.myworkdayjobs.com`，tenant `vanguard`，site `vanguard_external`；详情 URL 使用无语言段的 `/vanguard_external/job/.../apply` 形式。
- 生产 project ref：`weqvdtdjdzmqflhwobec`。当前在招 `collector_feed` 岗位 415 条，均保持 `is_active=true` 且 `is_closed=false`；字段回填没有修改岗位 ID、上下架状态或历史记录。
- 分段写入：首批 20 条，随后 99、99、92 条；合计写入 310 条，失败 0。末端 `after-id=62077` dry-run 候选 0。
- 本轮修复了 Workday CXS 详情 URL 解析：支持 Vanguard 这类无语言段 URL，同时保留 Citi 等带语言段 URL，并统一去除末尾 `/apply`。修复已部署，生产服务重建后保持 active。

字段审计（有值 / 已验证）：

| 字段 | 结果 |
| --- | ---: |
| 地点 | 415 / 411 |
| 岗位类型 | 413 / 413 |
| 经验 | 310 / 332 |
| 薪资 | 3 / 3 |
| 截止日期 | 0 / 0 |
| 工作方式 | 77 / 77 |

经验 verified 数包含历史证据但当前没有可展示经验值的记录；不据此补猜测。官方没有可验证截止日期时保持为空。岗位 `9263` 已通过生产数据库、岗位 API、岗位页和 Vanguard 官方详情页抽查，官方证据 URL host 正确，岗位仍保持开放。

## Vanguard 验收结果

- 全公司严格回归：`company_count: 75`、`regressions: []`；即时基线为 `/opt/liorvix/output/connector-regression-before-vanguard-final.json`，结果为 `/opt/liorvix/output/connector-regression-after-vanguard-final.json`。
- 公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/9263`、`https://liorvix.com/jobs/9263` 和 Vanguard 官方详情页均返回 HTTP 200。
- 生产 `.env.local` 已恢复为正确 project ref `weqvdtdjdzmqflhwobec`；部署脚本已加入 project ref 校验，错误环境会在构建前停止。
- 本地 Node 阻塞已处理：当前终端为 Node `v24.19.0`、pnpm `11.19.0`；Vanguard 修复的本地测试和 `pnpm ts-check` 已通过。

## 本轮环境事故与防错修复

2026-09-01 生产服务器 `.env.local` 曾被错误覆盖为另一 Supabase project，原因是部署流程重新创建环境文件。已恢复正确生产配置，旧文件备份为 `/root/liorvix-env-before-weqv-20260901`；当前服务器文件保持 `root:root`、权限 `600`。`scripts/deploy-production.sh` 现在默认校验 `weqvdtdjdzmqflhwobec`，未通过时不会进入构建或部署。

## 本轮完成：NVIDIA

- 来源：NVIDIA 官方 Workday，host `nvidia.wd5.myworkdayjobs.com`，tenant `nvidia`，site `NVIDIAExternalCareerSite`；详情 URL 使用 `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/...`。
- 生产 project ref：`weqvdtdjdzmqflhwobec`。初始来源矩阵为 932 条在招岗位，最终审计为 938 条；历史关闭记录 101 条、外部 ID 1,039 条。数量变化发生于生产源自然刷新，字段回填没有修改岗位 ID、`is_active` 或 `is_closed`。
- 首批 20 条和随后分段中，前 40 条因自动队列已追平而无新增字段；人工正式写入批次为 19、98、100、97、100、56 条，合计写入 470 条，失败 0。末端 `after-id=62639` dry-run 候选 0。

字段审计（有值 / verified 证据）：

| 字段 | 结果 |
| --- | ---: |
| 地点 | 938 / 938 |
| 岗位类型 | 841 / 841 |
| 经验 | 524 / 528 |
| 薪资 | 0 / 0 |
| 截止日期 | 0 / 0 |
| 工作方式 | 15 / 15 |

经验 verified 数包含历史证据但当前没有可展示经验值的记录，不据此补猜测；NVIDIA 官方详情本轮没有可验证薪资或截止日期时保持为空。岗位 `25328` 已通过生产数据库、公开 API、岗位页和 NVIDIA 官方详情页抽查，官方 URL 使用 NVIDIA 自有 Workday site。

## NVIDIA 验收结果

- 全公司严格回归：`company_count: 75`、`regressions: []`；即时基线为 `/opt/liorvix/output/connector-regression-before-nvidia-final.json`，结果为 `/opt/liorvix/output/connector-regression-after-nvidia-final.json`。
- 公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/25328`、`https://liorvix.com/jobs/25328` 和 NVIDIA 官方详情页均返回 HTTP 200。
- 所有写入均使用正确生产 ref、单并发和 `1200ms` 请求间隔；详情失败或字段缺失只跳过字段，不作为岗位关闭证据。
- 下一家公司按最新生产来源矩阵为 Wells Fargo，当前在招岗位 1,075 条，观察到官方 host `wf.wd1.myworkdayjobs.com`；正式处理前仍需独立确认 tenant、site、稳定 ID 和真实样本。

## Wells Fargo 处理启动记录

- 官方 Workday 已独立确认：host `wf.wd1.myworkdayjobs.com`，tenant `wf`，site `wellsfargojobs`；详情 URL 使用 `/en-US/wellsfargojobs/job/...`。
- 首批 20 条 dry-run：20 条详情成功，1 条有官方薪资新增字段，19 条无新增字段，失败 0；抽查岗位 `27202` 的生产 API、岗位页和官方详情页均返回 200，随后正式写入 1 条薪资。
- 自动队列当前游标为 `51427`。从该游标抽查 20 条：18 条详情成功，17 条有新增字段，2 条无公开正文，1 条无新增字段，失败 0；随后正式写入 17 条。
- 当前 Wells Fargo 审计：在招岗位 1,075 条，地点 1,075、工作方式 44、岗位类型 716、经验 717、薪资 149、截止日期 0；尚未完成全量回填，不计入已完成公司总数。

## 当前已处理公司总表

当前已完成首轮字段回填、官方证据核对和全公司回归的公司共 45 家：

- Greenhouse 17 家：Cloudflare、Stripe、Datadog、Coinbase、Asana、Brex、Databricks、Figma、GitLab、Point72、Reddit、Robinhood、Twilio、Discord、TPG、Bridgewater Associates、General Atlantic。
- Ashby 8 家：Runway、OpenAI、Cursor、Notion、Perplexity、Ramp、Vanta、Linear。
- Lever 1 家：Palantir。
- Phenom 1 家：Boston Consulting Group。
- Workday：Houlihan Lokey、Bain Capital、Apollo Global Management、The Carlyle Group、Adobe、Brookfield、PIMCO、Blackstone、Barclays、Ares Management、Intel、State Street、Fidelity Investments、Bank of America、Vanguard、NVIDIA、Wells Fargo、Accenture。

这些公司均已纳入生产官方详情轮转队列。新岗位先由 `collector_feed` 增量同步，再按官方 URL 进入对应公司的独立游标队列；当前配置为每家公司每轮最多 100 条、每轮最多 3 家、最多 3 个受控详情 worker、全局请求启动间隔 `1200ms`。队列按周期运行，不是实时单条触发；只补有官方证据的缺失或未验证字段，不修改岗位上下架状态或岗位 ID。Fidelity、Bank of America、Vanguard 与 NVIDIA 使用的官方详情解析修复已部署，后续 Workday 新岗位会沿用经过验证的规则，同时排除明显业务收入区间误报。

## 人工恢复流程：State Street（已完成，作为故障恢复参考）

若队列异常需要人工恢复，先独立确认 State Street 的 Workday host、tenant、站点和稳定岗位 ID，不能复制 Intel 的 URL 或字段假设；本轮初始基线为 257 条，最终审计为 252 条，执行时仍以生产 dry-run 为准。

```bash
sudo -n bash -c 'cd /opt/liorvix && set -a && . ./.env.local && set +a && JOB_BACKFILL_CONCURRENCY=1 JOB_BACKFILL_REQUEST_DELAY_MS=1200 pnpm exec tsx scripts/backfill-official-job-details.ts --company="State Street" --limit=20'
```

20 条样本通过数据库、官方 URL、公网 API 和岗位页核验后，才使用 `--write` 写入；生产机未注册 `backfill:official-details` 快捷脚本时使用上述直接入口。随后运行：

```bash
sudo -n bash -c 'cd /opt/liorvix && set -a && . ./.env.local && set +a && pnpm run audit:connector-backfill -- --company="State Street"'
sudo -n bash -c 'cd /opt/liorvix && set -a && . ./.env.local && set +a && pnpm exec tsx scripts/audit-connector-company-regression.ts --out=output/connector-regression-after-state-street.json --baseline=output/connector-regression-production.json --strict'
```

## 跨电脑接续方式

本总结、状态和交接文档只保存在本地项目目录；服务器只保留程序和生产数据，不作为文档存储。不要依赖聊天记录。把项目目录和同目录的 `正式发布服务器密钥.pem` 放到新电脑，先阅读：

1. `AGENTS.md`
2. `docs/job-company-field-connector-runbook.md`
3. 本文件
4. `docs/job-field-task-handoff.md`
5. `docs/job-company-field-execution-log.md`

然后只读确认生产项目：

```powershell
$key = Join-Path (Get-Location) '正式发布服务器密钥.pem'; & ssh.exe -i $key ubuntu@43.172.117.125 'cd /opt/liorvix && sudo -n grep "^SUPABASE_URL=" .env.local | cut -d/ -f3 | cut -d. -f1'
```

输出必须是 `weqvdtdjdzmqflhwobec`。确认无误后，严格按 runbook 重新确认下一家公司 Accenture 的官方来源、真实样本和字段证据，再继续生产流程；密钥只用于 SSH，不复制到代码、日志或文档。

## Wells Fargo 完成验收（2026-09-01）

- 生产环境：`43.172.117.125:/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。
- 官方来源已独立确认：host `wf.wd1.myworkdayjobs.com`，tenant `wf`，site `wellsfargojobs`，详情路径 `/en-US/wellsfargojobs/job/...`。
- 完整 dry-run：507 条候选，474 条详情成功，235 条有新增字段，跳过 272 条，失败 0，末端 ID `62650`。
- 正式写入：463 条详情成功，更新 228 条，跳过 279 条，失败 0；最终 dry-run `candidate_jobs=0`。
- 最终在招岗位 1,076 条；有值 / verified 证据：地点 `1,076 / 1,076`、工作方式 `47 / 46`、岗位类型 `1,042 / 1,042`、经验 `1,032 / 1,041`、薪资 `363 / 363`、截止日期 `0 / 0`。经验 verified 多于当前有值是历史证据保留，不据此补猜测；官网未提供可验证截止日期，保持为空。
- 岗位生命周期保持安全：在招 `1,076`，历史关闭 `668`；回填未修改岗位 ID、`is_active`、`is_closed`、收藏、投递或历史记录。
- 公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/27178`、`https://liorvix.com/jobs/27178` 和 Wells Fargo 官方详情页均返回 HTTP 200；岗位 API 展示官方地点、岗位类型、经验及 verified evidence。
- 全公司 strict 回归：`company_count: 75`、`regressions: []`；即时基线 `/opt/liorvix/output/connector-regression-before-wells-fargo-final.json`，结果 `/opt/liorvix/output/connector-regression-after-wells-fargo-final.json`。
- Wells Fargo 已完成本轮生产字段回填；Accenture 随后完成。已完成公司的新增岗位由生产官方详情队列按公司独立游标自动同步有官方证据的字段，官网未提供的字段继续保持为空。

## 本轮完成：Accenture（2026-09-02）

- 生产环境：`43.172.117.125:/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。
- 官方 Workday：host `accenture.wd103.myworkdayjobs.com`，tenant `accenture`，site `AccentureCareers`；官方详情页、平台 API 和岗位页样本均返回 HTTP 200。
- 自动队列最终批次从游标 `46960` 推进到 `64264`，100 条候选、详情成功 94 条、跳过 100 条、更新 0 条、失败 0；末端游标已达到当前在招岗位最大 ID，后续 dry-run 无候选并进入 10 分钟复查冷却。
- 最终生产在招 `collector_feed` 岗位 2,380 条；字段审计（有值 / verified）：地点 `2,380 / 2,292`、工作方式 `428 / 428`、岗位类型 `1,564 / 1,540`、经验 `1,134 / 1,429`、薪资 `710 / 710`、截止日期 `0 / 0`。经验 verified 多于当前有值是历史证据残留，不据此补猜测；官网没有可验证截止日期时保持为空。
- 公网验收：`/api/health`、`/api/jobs/6767`、`/jobs/6767` 和 Accenture 官方详情页均返回 200；岗位 `6767` 仍为开放状态并展示官方字段。
- 严格回归：`company_count: 75`、`regressions: []`；生产文件为 `output/connector-regression-before-accenture-20260902.json` 和 `output/connector-regression-after-accenture-20260902.json`。
- 本轮未修改岗位 ID、`is_active`、`is_closed`、收藏或投递记录。Accenture 已完成本轮生产字段回填，新增岗位由独立官方详情游标自动处理。

## 官方字段队列性能修复（2026-09-02）

- 根因：字段缺失但官网未提供证据的岗位会持续满足候选条件；旧逻辑扫到末尾后把游标置 `null`，下一轮又从头扫描，造成游标看似回退和重复耗时。
- 修复：完成一轮后保留末端岗位 ID；游标达到当前最大岗位 ID时不再启动详情子进程，并设置 10 分钟复查冷却，以便新岗位仍可自动进入队列。
- 速度：Workday 详情请求使用最多 3 个并发 worker，同时保持全局 `1200ms` 请求启动间隔。生产实测 100 条批次约 122 秒，失败 0；未放宽上游请求频率。

## 生产配置复核与后续自动轮转（2026-09-02）

- 生产 project ref 已核对为 `weqvdtdjdzmqflhwobec`，服务 `liorvix` active，公网健康检查通过。
- 发现服务器曾使用旧的批次 20、间隔 0.5 分钟配置，已先备份再恢复为批次 100、间隔 0.1 分钟、每轮 3 家、Workday 并发 3、全局请求间隔 1200ms；Accenture focus 已清空，恢复公平轮转。
- 旧的 Intel/Blackstone 租约均按 TTL 自然过期，没有强制释放有效租约；随后队列继续成功处理多家公司，失败队列为 0，Intel 游标从 `24882` 推进到 `64073`。
- Accenture 已完成本轮，后续不再人工接力；Citigroup 及其他已登记公司由独立游标自动处理。新岗位只有在保留官方 URL 且有官方字段证据时才会更新，官网未提供证据的字段继续为空。
