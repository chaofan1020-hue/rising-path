# 支付基础层

真实微信/支付宝支付默认关闭。本地代码已经把下单、回调、查单、过期、取消和退款链路补到可接商户密钥的状态；生产密钥只能写入美国服务器 `.env.local`。

## 已落地

- `billing_plans`：销售套餐目录，价格使用最小货币单位（人民币为分），包含积分、有效期、版本和多语言文案。
- `billing_orders`：业务订单事实，保存套餐快照、金额、应发积分和支付时间。同一用户同时只能有一笔待支付订单。
- `payment_attempts`：一笔业务订单可以有多次支付尝试，每次尝试都有独立商户订单号。
- `BillingProvider`：统一创建支付会话、查单、关单、退款、退款查询和回调验签接口。
- `ManualBetaBillingProvider`：占位渠道，不创建真实支付、不接受外部回调。
- `GET /api/billing/plans`：读取当前币种的有效套餐，并返回渠道是否配置完成。
- `POST /api/billing/orders`：认证用户按套餐创建微信/支付宝订单；已有待支付订单会恢复或先关闭再新建。
- `GET /api/billing/orders`：读取当前用户订单列表。
- `GET /api/billing/orders/:id/status`：查单、过期关单，并用渠道金额入账。
- `POST /api/billing/orders/:id/cancel`：用户取消待支付订单，并关闭渠道订单。
- `POST /api/payments/wechat/notify`：微信 API v3 回调验签、解密、支付/退款入账。
- `POST /api/payments/alipay/notify`：支付宝 RSA2 回调验签和幂等入账。
- `complete_billing_order`：同一订单只发放一次积分；金额必须匹配；延迟回调在本地取消/过期后仍可入账。
- `complete_billing_refund`：退款回调扣回积分，已退款订单保持幂等。

## 订单状态

业务订单和支付尝试共用以下状态语义：

`created` / `pending` -> `paid`、`failed`、`cancelled`、`expired`；支付成功后允许进入 `partially_refunded` 或 `refunded`。

旧版 `billing_orders` 使用 `pending` 作为初始状态，因此迁移保留该值以兼容历史记录。订阅套餐尚未开放自动续费，当前结账只接受一次性套餐。

## 安全边界

- 套餐页展示 `billing_plans.display_amount_minor` 里固定的美元标价。国内微信 Native/H5 和支付宝 QR/WAP 只能收人民币，下单仍发送 `billing_plans.amount_minor` 的人民币分。页面金额不能改写实付金额。境外收单（微信/支付宝按实时汇率换算美元）需要单独的跨境商户号，当前国内接口做不到。
- 金额由数据库套餐决定，客户端不能提交价格或积分数量。
- 支付回调必须由 Provider 验签并按 `provider + event_id` 幂等处理。
- 查单入账必须使用渠道返回的金额，不能用本地订单金额代替。
- 只有服务端确认订单成功后才允许写入 `credit_ledger`，前端成功页不能直接发放积分。
- 微信、支付宝密钥只能放在生产服务器 `.env.local`，不进入仓库、构建产物或浏览器代码。
- `BILLING_ENABLED`、`WECHAT_PAY_ENABLED`、`ALIPAY_ENABLED` 默认均为 `false`。

## 后续接入顺序

1. 把 `0116` 到 `0119` 的迁移应用到目标 Supabase，并确认 `liorvix_migration_history`。
2. 部署包含支付代码的应用版本到美国服务器，但先保持三个支付开关为 `false`。
3. 在沙箱/测试商户环境写入密钥和 HTTPS 回调地址，先只打开一个渠道。
4. 覆盖重复回调、金额篡改、支付取消、超时订单、关浏览器、退款和双开订单测试。
5. 再开放第二个渠道。H5/WAP 已实现，JSAPI 和自动续费仍不在本阶段。

## 阶段五准备（不含生产密钥）

- 使用 `pnpm run check:billing-readiness` 检查当前环境的支付变量是否齐全；脚本只输出变量名和 HTTPS 告警，不输出任何密钥。
- 使用 `pnpm run test:billing`、`pnpm run test:billing-contract`、`pnpm run test:billing-payment` 验证开关、合约和时区/状态映射。
- 生产迁移顺序固定为 `0116_payment_foundation.sql` -> `0117_payment_order_settlement.sql` -> `0118_billing_refund_settlement.sql` -> `0119_billing_payment_hardening.sql` -> `0120_billing_usd_catalog.sql`，先在目标 Supabase 环境 dry-run，再执行并查询迁移记录。
- 后台支付订单工作台提供订单查询、待支付取消和退款入口；退款先锁定并扣回已到账积分，外部渠道失败时自动恢复积分，PROCESSING 退款可再次查询完成。
- 回调失败或中断的 `received` 事件可以安全重试；已处理或已忽略的事件仍保持幂等，不会重复发放积分。
- 生产商户 ID、私钥、API v3 Key、平台证书、公钥、生产 `.env.local` 和支付开关留到最终发布窗口，不进入 GitHub 或前端构建产物。
