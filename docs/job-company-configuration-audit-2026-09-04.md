# 75 家公司来源配置盘点

生产只读盘点时间：2026-09-04（UTC）。数据来源是美国生产 Supabase 的 `job_company_sources`，并与上游 `/companies`、`/dashboard/company-directory` 的公司 ID 做了交叉核对。

## 结论

- 活跃公司：75 家，均有来源台账行和上游公司 ID。
- 已配置连接器：37 家，可按现有连接器执行 dry-run/canary。
- 来源族已识别但台账元数据未完全收口：21 家。它们不是“完全没配置”，主要是 Workday、Amazon Jobs、Apple API 等来源已经确认，但 `connector_name` 或官方 URL/host 元数据还不完整。
- 完全待探测：17 家。美国端不能直接启动官方字段写入，必须先完成官方来源、ATS、外部 ID 和字段证据确认。

## 已配置连接器（37）

Asana、Boston Consulting Group、Brex、Bridgewater Associates、Cloudflare、Coinbase、Cursor、Databricks、Datadog、Deloitte、Discord、Figma、General Atlantic、GitLab、Goldman Sachs、Google、Jefferies、JPMorgan Chase、Lazard、Linear、Meta、Microsoft、Morgan Stanley、Notion、Oliver Wyman、OpenAI、Palantir、Perplexity、Point72、Ramp、Reddit、Robinhood、Runway、Stripe、TPG、Twilio、Vanta。

## 来源族已识别（21）

这些公司已有可识别的官方来源，当前主要缺少台账元数据收口；不要把它们当作 20 家待探测公司重复处理。

| 公司 | 来源族 |
| --- | --- |
| Amazon | amazon_jobs |
| Apple | apple_official_api |
| Accenture、Citigroup、Wells Fargo、NVIDIA、Bank of America、Fidelity Investments、Vanguard、Intel、State Street、Ares Management、Barclays、Blackstone、PIMCO、Brookfield、Adobe、The Carlyle Group、Apollo Global Management、Bain Capital、Houlihan Lokey | workday |

下一步：补齐官方 careers URL、官方 host、连接器/详情规则和地区范围；对已有 Workday/专用适配器做真实样本 dry-run，不能仅把状态字符串改成 `configured_connector`。

## 完全待探测（17）

| 公司 | 上游当前来源标记 | 说明 |
| --- | --- | --- |
| UBS | talent_gateway | 自定义来源，需确认完整清单口径 |
| Jane Street | greenhouse | 需确认官方 Greenhouse board 和详情 URL |
| Deutsche Bank | beesite | 自定义来源，需确认接口和详情字段 |
| BlackRock | talentbrew | 自定义来源，需确认接口和岗位 ID |
| Roblox | greenhouse | 需确认官方 Greenhouse board 和详情 URL |
| Okta | greenhouse | 需确认官方 Greenhouse board 和详情 URL |
| MongoDB | greenhouse | 需确认官方 Greenhouse board 和详情 URL |
| Elastic | greenhouse | 需确认官方 Greenhouse board 和详情 URL |
| Millennium Management | eightfold | 需确认 Eightfold 租户和详情接口 |
| McKinsey & Company | mckinsey | 自定义/Avature 线索，需确认真实接口 |
| Bain & Company | avature | 需确认 Avature 入口和地区过滤 |
| KKR | greenhouse | 需确认官方 Greenhouse board 和详情 URL |
| Duolingo | greenhouse | 需确认官方 Greenhouse board 和详情 URL |
| Evercore | rss | 需确认 RSS 是否完整，不能作为精确总数的唯一依据 |
| Two Sigma | avature | 需确认 Avature 入口和详情字段 |
| Rothschild & Co | rothschild_web | 同时出现官网和 Workday host，必须先拆分来源再配置 |
| Citadel | sitemap | 需确认 sitemap 是否覆盖全部在招岗位 |

上游的 `connector_type=official`、`auto_discover=true` 只表示上游允许自动探测，不代表美国应用已有可执行连接器。上述来源标记也不能直接当作连接器类型写入生产台账。

## 推进顺序

1. 先收口 21 家“来源族已识别”公司的官方 URL、host、外部 ID 和连接器元数据；对 Workday 统一做样本 dry-run，Amazon/Apple 按既有专用开关执行。
2. 再按岗位量从高到低处理 17 家待探测公司：UBS、Jane Street、Deutsche Bank，然后按表中顺序推进。
3. 每家公司固定执行“官方源探测 → 真实样本 dry-run → 20 条 canary → 分批写入 → 三周期观察”。来源未验收前保持 `discovery_required`，不启动历史字段回填。
4. 全部来源配置验收完成后，才继续 P2 字段 canary。此期间主 Feed 不暂停、不改并发/轮换逻辑。

## 可重复审计

新增了只读脚本 `scripts/audit-company-configuration.ts`（命令：`pnpm run audit:company-configuration`），输出 75 家的状态、来源、是否可执行、官方元数据完整性、复核队列和下一步动作。脚本只读取 `job_company_sources` 和历史复核队列，不修改岗位、游标或来源状态；数据库尚未部署阶段六迁移时会自动省略复核详情。
