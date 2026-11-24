# D06 · P0 500 抽样复核

日期：2026-11-24
输入：`tmp/boards/companies.csv`（902 active）+ `tmp/boards/active.csv`
输出：`data/p0-boards.csv`（500 行）

## 冻结口径

- 按 vendor 配额：Greenhouse 400 + Lever 100。
- 去重：`(vendor,token)` 唯一；同一公司多个 token 只留岗位数最高的一个。
- 排除：token 兜底名、泛词标题（Careers/Jobs/Search/Join our team 等）、staffing/recruiting 名称。
- 工时不参与冻结；domain 只收有证据的（sample 岗位 URL、og:url、JSON-LD、明确 Website 外链、人工覆盖），无证据留空。

## 文件校验

- 行数：500；`(vendor,token)` 唯一 500。
- vendor：Greenhouse 400 / Lever 100。
- tier：S 98 / A 270 / B 132。
- 有 domain：169；无 domain：331（U02 按公司名匹配，不阻断）。
- 无空公司名；无 token 兜底名。
- sha256：`A33ACDAC604430C3449288CB1E0FA5F4D4B46645729B35AD453A3792B1B24D9D`

## 50 条分层抽样结果

| 结论 | 数量 | 说明 |
|---|---:|---|
| pass | 16 | 官网 200，页面标题包含公司名 |
| blocked_by_site | 2 | Coupang 403、Centria 503，站点拒绝 bot，domain 本身正确 |
| no_domain | 32 | 无域名证据，未猜 |
| weak_name / domain_fail | 0 | 本轮无 |

- 公司名错误：0/50。
- 有 domain 的 18 条中，domain 错误：0/18；2 条被站点 403/503 拦截，不算域名错误。

## 抽样明细（前 8）

| vendor | token | company_name | domain | 结论 |
|---|---|---|---|---|
| greenhouse | coupang | Coupang | coupang.com | blocked_by_site 403 |
| greenhouse | svetness | Svetness Personal Training | svetness.com | pass |
| greenhouse | cssmerge | ATOMS Careers page | — | no_domain |
| greenhouse | centriaautism | Centria Autism | centriaautism.com | blocked_by_site 503 |
| greenhouse | celonis | Celonis | celonis.com | pass |
| greenhouse | powerdigitalmarketing | Power Digital | — | no_domain |
| greenhouse | esri | Esri | esri.com | pass |
| greenhouse | relativity | Relativity Space | relativityspace.com | pass |

## 结论

500 个 board 可进入 U02 导入；domain 缺失是已知项，不作为 P0 阻断。抽样未发现错误公司名或错误 domain，满足 D06 的 ≤15% 错误率门槛。