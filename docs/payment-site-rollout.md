# 支付站结算流程部署说明

主站继续承载登录、套餐、订单和积分账户。支付站运行本项目的 Next.js 应用，提供 `/pay` 服务说明页、`/pay/checkout` 结算页和 `/api/payments/*` 接口。静态备案官网不能承载本结算流程；如国内服务器仍只提供 `deploy/icp-site`，需先将应用部署到已备案且支付机构接受的支付域名。

## 域名和服务

- 主站：`https://liorvix.com`
- 国内支付站：部署完成后设置 `PAYMENT_SITE_URL=https://<已备案支付域名>`。
- 支付站必须使用同一份应用版本、同一个 Supabase 项目和相同的 `PAYMENT_HANDOFF_SECRET`。
- 主站与支付站均设置至少 32 字符的随机 `PAYMENT_HANDOFF_SECRET`。该值只在服务端环境中保存，不以 `NEXT_PUBLIC_` 开头。
- 两台服务器都必须配置 Supabase service role key；支付站需要它读取受限订单、兑换一次性票据和核对回调。
- 支付宝/微信通知地址配置为实际可公网访问且已在商户平台登记的接口地址。通知处理只在验签成功、订单金额匹配后完成订单和积分入账。

## 交接和状态

主站先按服务端套餐价格创建订单，然后签发 10 分钟有效的一次性票据。支付站兑换票据后设置 HttpOnly、Secure（生产）、SameSite=Lax 的两小时会话 cookie。票据数据库只保存 HMAC 摘要。状态页轮询支付服务端查询，浏览器回跳不会直接授予积分；已存在的 `complete_billing_order` 数据库事务负责幂等入账。

## 上线步骤

1. 应用 `supabase/migrations/0131_payment_handoff_tickets.sql` 到目标 Supabase 项目。
2. 在两端部署同一构建，设置一致的交接密钥、Supabase 配置、支付渠道密钥及正式回调 URL。保留 `BILLING_ENABLED=false` 直至正式环境验收。
3. 从主站登录后选择一个付费套餐，确认浏览器只通过短期 `ticket` 跳转，且 URL 不包含 Supabase access token、邮箱或 user ID。
4. 验证票据过期和重复兑换均失败，支付站刷新后会话仍能读取同一订单；其他用户不能通过猜订单 ID 访问订单。
5. 沙箱或低金额实付验证微信/支付宝支付、签名通知、重复通知幂等、未支付取消、过期和退款。
6. 从公网检查支付域名 `/pay`、`/pay/checkout`、服务协议/隐私/售后链接、备案信息和主体是否与商户材料一致。

此代码实现不替代备案、经营许可或支付机构的审核。域名、实际经营主体、网站内容和支付商户资料必须保持真实一致。
