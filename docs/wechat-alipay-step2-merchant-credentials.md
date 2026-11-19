# 第二步实操：申请微信 / 支付宝商户并拿到全部密钥

你现在的状态：**有营业执照 + 法人身份证 + 对公账户**，两个商户号都没有。
结论：**先跑通支付宝，再跑微信。** 支付宝是「开放平台建应用 → 上线 → 商家平台开通产品 → 填两个公钥」，全流程可以一天内自己走完；微信多一个绕不开的硬门槛（必须先有一个**已通过微信认证的 AppID**），周期取决于认证审核，卡点最多。

> 本文件是[wechat-alipay-integration-flow.md](wechat-alipay-integration-flow.md) 第二步的展开版。所有路径与参数名以 2025–2026 年官方文档为准，官方文档发版后以官网为准。

---

## 第 0 步：先确认一件事，否则两个渠道都过不了审核

两个渠道都要求：**网站能公网打开、已完成 ICP 备案、备案主体 = 商户主体**。

- 支付宝：网站必须 ICP 备案，且备案主体与支付宝账号主体一致；不一致要上传授权函。
- 微信：AppID 与商户号主体可以不一致，但**不一致要额外提交授权材料并多一道审核**。

所以：**营业执照是「成都数橙研策科技有限公司」，域名备案主体也必须是这家公司。**
项目里已备案的是 `liorvix.cn`（蜀ICP备2026019930号-2，主办单位成都数橙研策科技有限公司），主体一致 ✅。
美国站 `liorvix.com` 没有国内备案 —— 它可以是收银台地址（代码里的回调 URL），但**申请材料里填的「官方网站」请填备案站**，并把备案站做成「有经营内容 + 有完整商品价格 + 有售后说明」的样子。这两点审核都会打开看。

开始之前先自检一遍：

```bash
# 备案号能在工信部查到
open https://beian.miit.gov.cn/
# 站点能打开且展示价格/售后
curl -I https://liorvix.cn
```

---

## 第 1 步：支付宝（先做这个）

### 1.1 创建「网页/移动应用」拿 APPID

1. 用**企业支付宝账号**登录 <https://open.alipay.com>（不是支付宝 App 里那个个人号登录后台）。没实名就先完成企业实名。
2. 开放平台 → 控制台 → 创建应用 → 选 **网页/移动应用**（自研商家接入，不是「小程序」「第三方应用」）。
3. 应用建好后，详情页顶部那串 `2021xxxxxxxxxxxx` 就是 **APPID** → 记下来，后面填 `ALIPAY_APP_ID`。

**为什么**：APPID 是支付宝侧的唯一身份标识，之后每一次网关请求的 `app_id` 字段、每一次异步回调里的 `app_id` 都拿它比对。回调里 `app_id` 与你的应用不一致的，必须丢弃。

### 1.2 开发设置：一次填对四个项

进入 **开发 → 开发设置**：

| 配置项 | 选什么 | 为什么 |
| --- | --- | --- |
| 接口加签方式 | **公钥**（RSA2，2048 位） | 我们的代码是纯 Node `crypto` 手写签名（`alipay-provider.ts`），只支持公钥模式；**公钥证书模式不兼容**，选了证书模式代码会直接验签失败 |
| 服务器 IP 白名单 | 填美国生产机出口 IP `43.172.117.125` | 可选，但强烈建议：万私钥泄露，白名单是最后一道闸 |
| 应用网关 | 填 `https://liorvix.com/api/payments/alipay/notify`（或留空） | 必填项，但**交易回调实际走的是下单时传的 `notify_url`**，我们不订阅 From 消息服务，所以这里填同一个地址即可，不冲突 |
| 授权回调地址 | 留空 | 那是给「用户信息授权」用的，我们不拉取用户信息 |

### 1.3 生成密钥对（在你自己的电脑上，不要用在线工具或别人给你的密钥）

```bash
# 1) 生成 PKCS#8 私钥（这是唯一要保密的东西）
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out alipay_app_private_key.pem

# 2) 导出公钥（贴到后台的「应用公钥」）
openssl pkey -in alipay_app_private_key.pem -pubout -out alipay_app_public_key.pem

# 3) 各自导出成「单行 Base64」（去掉首尾 BEGIN/END 行，不留换行）
tail -n +2 alipay_app_private_key.pem | head -n -1 | tr -d '\n' > alipay_app_private_key.txt
tail -n +2 alipay_app_public_key.pem  | head -n -1 | tr -d '\n' > alipay_app_public_key.txt
```

写进 `.env.local` 时用 `.txt` 里那一整行（代码里的 `pem()` 只处理 `\n` 转义，不接受带换行的多行粘贴）。

**为什么**：支付宝是「你用私钥签名，支付宝用你上传的应用公钥验签」。私钥一旦泄露，任何人都能以你的身份下单、退款。私钥只存在服务器 `.env.local` 里，不要进 Git、不要发微信、不要截图。上传后支付宝后台会给出**支付宝公钥**——它和你的应用公钥是两把不同的钥匙，别贴混（这是最高频的报错来源）。

> 小提示：如果你更习惯图形化，支付宝开放平台也提供「密钥生成工具」和在线密钥工具，用它生成同样正确；唯一要守住的规则是**私钥只在你这台电脑生成、只交给你自己的服务器**。绝不要用「别人代生成」或「网上下载的密钥」。

### 1.4 上传应用公钥，拿回支付宝公钥

在「接口加签方式」里把 `alipay_app_public_key.pem` 的 Base64 内容（不含 `-----BEGIN/END-----`）粘贴提交，保存后页面会显示：

- **应用公钥**（你刚传的，可随时查看）
- **支付宝公钥** → 记下来，后面填 `ALIPAY_PUBLIC_KEY`

**为什么**：验证「支付宝 → 你」的通信（异步通知签名、网关响应签名）用的是支付宝公钥；证明「你 → 支付宝」的身份用的是你的私钥。方向搞反就会一直 `sign check fail`。

### 1.5 上线应用（一般 1 个工作日）

开发设置填完 → 提交审核 → 应用状态要变成 **已上线**。
**注意：应用不上线，线上环境调不通接口，只能走沙箱。**

### 1.6 开通「电脑网站支付」（或「当面付」）

商家平台 <https://b.alipay.com> → 产品中心 → **电脑网站支付** → 立即开通。

- 费率 0.6% 单笔；退款支持交易发生后 **12 个月内**原路退回（手续费不退）。
- 如果已经开通了**当面付**，就不用再开通电脑网站支付。
- 提交材料就是你的第一步资产：营业执照、法人身份证、备案站地址。网站必须**显示完整商品信息和价格**，否则会因「资料不完整」被降额或限制使用。

**为什么必须开通**：我们代码调的两个接口都属于由该产品授权的能力——

- `alipay.trade.wap.pay`（手机 H5 收银台，`product_code=QUICK_WAP_WAY`）→ 手机网站支付 / 电脑网站支付
- `alipay.trade.precreate`（桌面扫码，出二维码）→ 当面付

在没有开通对应产品的情况下调用，会返回 `ACQ.TRADE_NOT_ALLOWED` / 「产品未开通」之类业务错误。

### 1.7 配置回调地址（写进环境变量，不是后台）

支付宝的 `notify_url` / `return_url` 是**下单接口的入参**，代码里已经处理：

```bash
ALIPAY_NOTIFY_URL=https://liorvix.com/api/payments/alipay/notify   # 异步通知（唯一可信结果来源）
ALIPAY_RETURN_URL=https://liorvix.com/pay/checkout                 # 用户付款后同步跳回（仅做入口，不判定成败）
ALIPAY_GATEWAY_URL=https://openapi.alipay.com/gateway.do
```

**为什么同步跳回不算数**：用户付完款后可能关掉浏览器、断网、iOS 直接切回别的 App，同步跳转天然不可靠。代码里 `/pay/checkout` 只负责展示，最终状态来自验签回调 + `alipay.trade.query` 查单（`billing-order-service.ts` 每 4 秒查一次），所以 `ALIPAY_RETURN_URL` 填错也不会导致丢单，只会让用户回到一个空白页。

### 1.8 支付宝侧产物清单

| 变量 | 从哪来 |
| --- | --- |
| `ALIPAY_APP_ID` | 1.1 创建应用后得到 |
| `ALIPAY_PRIVATE_KEY` | 1.3 你生成的私钥（**只存服务器**） |
| `ALIPAY_PUBLIC_KEY` | 1.4 后台给的**支付宝公钥**（不是你的应用公钥） |
| `ALIPAY_NOTIFY_URL` | 1.7 |
| `ALIPAY_RETURN_URL` | 1.7 |
| `ALIPAY_ENABLED` | 验收全部通过后再改成 `true` |

### 1.9 立刻验一次（不花真钱的回环测试）

`alipay.trade.query` 是最轻的接口，用它验证「签名 + 网关 + 验签 + 应用已上线」这四件事，而不产生订单。把变量写进 `.env.local` 后：

```bash
pnpm run check:billing-readiness     # 先确认 alipay.missing 为空
```

再用最小金额套餐下一单，页面上能看到二维码，就说明整条链路通了。
如果连二维码都没出来，看服务端日志里的支付宝返回码，按下面这张表定位：

| 现象 | 原因 |
| --- | --- |
| `status-query` 报错 + `sign check fail` / 验签失败 | `ALIPAY_PUBLIC_KEY` 填成了应用公钥（这是最高频的错） |
| `isv.app-not-online` / 「产品未开通」 | 1.5 应用没上线，或 1.6 产品没开通 |
| `ACQ.TRADE_NOT_EXIST` | 正常——说明请求已经到了支付宝、密钥是对的，只是这条订单还不在支付宝侧 |
| 二维码出来了，但付了钱积分不到账 | `ALIPAY_NOTIFY_URL` 不是公网 HTTPS、Nginx 拦了 POST、或回调 body 被中间件改写；查 `billing_webhook_events` 有没有记录 |

---

## 第 2 步：微信支付（支付宝验收通过后再做）

### 2.1 先想清楚一件事：你需要一个 AppID

微信支付不是独立账号体系，它必须「挂」在一个微信社交载体上：

| 载体 | 适合谁 | 对我们的意义 |
| --- | --- | --- |
| **已认证服务号**（公众号） | 有 wx 认证的服务号（认证费 300 元/年） | ✅ 推荐：将来还能做公众号通知、JSAPI |
| 已认证小程序 | 有认证小程序 | 也可以，但和网页支付关系不大 |
| 开放平台移动应用 | 有 App | ❌ 我们是纯网页，没必要 |

**为什么这一步最卡人**：文档明确只有「已通过微信认证的服务号、政府或媒体类公众号、小程序、企业微信、移动应用」这几种可以绑定。「空壳」未认证公众号绑定会被拒。服务号认证要对企业主体做验证，常见 1–3 个工作日，加上每年 300 元认证费，这一步花的时间可能比后面所有步骤加起来都多。

**现在就去做的动作**：如果公司还没有已认证服务号，今天就去 <https://mp.weixin.qq.com> 注册并提交认证；认证审核和下面 2.2 的商户号申请是**可以并行**的。

### 2.2 申请普通商户号（mchid）

1. 用营业执照申请 **普通商户号**（不是服务商）。入口：<https://pay.weixin.qq.com> → 接入微信支付 → 普通商户入驻。
2. 主体类型：**企业**（入驻支持个体工商户、企业、政府机关、事业单位、社会组织）。
3. 经营场景选**网站**，填备案站 `liorvix.cn`（与营业执照主体一致）。
4. 类目选**软件服务 / 在线信息服务**，不要选人力资源中介（会触发人力资源许可证前置要求）。
5. 准备好：营业执照彩照、法人身份证正反面、对公账户、法人手机号（收签约验证码）。

**为什么必须企业主体**：个人主体做不了微信网站支付。

申请通过后，微信会给注册邮箱发邮件，里面是 **mchid 和登录账号密码**。
**注意：商户号一旦确立，主体类型和统一社会信用代码不可变更**，只剩公司名称和法人可以按工商信息改。所以申请时务必用最终主体。

### 2.3 绑定 AppID（去后台走授权流程，不是等审核）

两个入口：

1. 商户平台 → **产品中心 → APPID账号管理 → 我关联的APPID账号**（查看已绑定）
2. 商户平台 → **产品中心 → APPID授权管理 → +关联AppID → 新增授权**，填 AppID 提交

提交后**不会自动生效**，还要去另一侧确认：

- 服务号/公众号：登录 <https://mp.weixin.qq.com> → **微信支付 → 商户号管理 → 待关联商户号 → 确认授权**
- 小程序：同路径，或在「公众平台安全助手」的模板消息里确认

关键规则（都来自官方文档，照着避坑）：

- **一个商户号最多关联 50 个 AppID**。
- **主体不一致**时，要在新增授权页额外填 AppID 认证主体，并勾选《微信支付联合营运承诺函》，会多一道审核。
- **绑定的 AppID 如果已经绑过其他商户号**，新商户号费率必须与它**一致**，否则不支持线上绑定。→ 不要拿别人的商户号共用 AppID。
- **一旦绑定，暂不支持解绑**，每条关系独立存在。→ 别拿测试商户号乱绑。
- 商户号或 AppID 有风险（资料不全、有处罚单据未处理）时，平台会加审或驳回。

### 2.4 商户平台三样东西，缺一不可

登录 <https://pay.weixin.qq.com>（超级管理员），进入 **账户中心 → API安全**：

#### ① 设置 APIv3 密钥（`WECHAT_PAY_API_V3_KEY`）

账户中心 → 账户设置 → API安全 → **APIv3密钥** → 设置 → 确认与技术负责人沟通过 → 输入密钥 → 操作密码 + 短信验证。

- **32 个字符**，支持数字和大小写字母组合。
- **设置后平台不支持查看**，丢了只能重置（重置会让所有回调解密失败）。
- 与 APIv2 密钥相互隔离，互不影响。

**为什么必须 32 字节**：微信回调报文是 `AEAD_AES_256_GCM` 加密的，密钥长度不对，Node 的 `createDecipheriv('aes-256-gcm', ...)` 会直接抛错，表现为「回调处理失败」。

生成一个：`openssl rand -hex 16`（32 个十六进制字符）。

#### ② 申请商户 API 证书（`WECHAT_PAY_PRIVATE_KEY` + `WECHAT_PAY_SERIAL_NO`）

账户中心 → API安全 → **商户API证书** → 申请证书 → 下载「证书工具」→ 复制商户号/商户名称 → 工具里申请 → 复制证书请求串回填 → 复制证书串回填工具 → 完成。

产出文件里两个关键：

- `apiclient_key.pem` → `WECHAT_PAY_PRIVATE_KEY`（**私钥只能由证书工具导出，丢失无法找回，只能作废重申**）
- 证书序列号（32 位十六进制）→ `WECHAT_PAY_SERIAL_NO`

查序列号三种方式，任选：

```bash
openssl x509 -in apiclient_cert.pem -noout -serial     # 输出 serial=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
# 或 商户平台 账户中心 → API安全 → 商户API证书 → 管理证书 查看
```

**为什么**：APIv3 的每个请求都要在 `Authorization` 头里带私钥签名 + 证书序列号，微信用序列号找到对应证书来验签。私钥和序列号必须来自**同一份证书**，配错就是 `401 签名错误`。证书有效期 5 年，到期前要换（最多 3 份同时生效，可平滑替换）。

#### ③ 获取微信支付公钥（`WECHAT_PAY_PLATFORM_PUBLIC_KEY`）

账户中心 → API安全 → **微信支付公钥** → 申请公钥 → 下载公钥文件，并记下 **公钥 ID**。

**为什么不下载平台证书**：官方明确「新接入按公钥方案获取即可，无需再获取平台证书」——公钥**长期有效**，平台证书每 5 年要换一次。代码同时支持两种：

```ts
const platformCertificate = process.env.WECHAT_PAY_PLATFORM_CERTIFICATE;
const platformPublicKey = process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY;
const key = platformCertificate || platformPublicKey;
```

填公钥走 `WECHAT_PAY_PLATFORM_PUBLIC_KEY`，填证书走 `WECHAT_PAY_PLATFORM_CERTIFICATE`，二选一，另一个留空。

**为什么必须要有**：微信回调带 `Wechatpay-Signature` 头，代码用这把公钥做 `RSA-SHA256` 验签（`wechat-pay-provider.ts:154`）。没有它，任何自称「微信」的 POST 都能伪造成功回调、白拿积分。

### 2.5 配置回调地址

微信的 `notify_url` 也是**下单时传的入参**（`wechat-pay-provider.ts:84`），代码读环境变量：

```bash
WECHAT_PAY_NOTIFY_URL=https://liorvix.com/api/payments/wechat/notify
```

产品中心的「支付回调地址」配置项也建议填同一个地址（部分产品页面会引导配置），两边保持一致最省事。

### 2.6 开通 Native 支付

商户平台 → **产品中心 → 产品大全 → Native支付** → 开通。
H5 支付审核更严（可能要求经营性 ICP 许可证），**第一阶段先不开**，等 Native 验收通过再说。

**为什么只开 Native**：桌面结账用的就是 Native（`/v3/pay/transactions/native` 返回 `code_url` 出二维码）。手机端走的是 `wechat_h5`，那是另一个产品能力，需要单独开通；没开通时手机会下单失败，但不影响桌面用户。

### 2.7 微信侧产物清单

| 变量 | 从哪来 | 形态 |
| --- | --- | --- |
| `WECHAT_PAY_MCH_ID` | 2.2 邮件 | 10 位数字 |
| `WECHAT_PAY_APP_ID` | 2.1 公众平台 | `wx` 开头 |
| `WECHAT_PAY_SERIAL_NO` | 2.4② 证书序列号 | 32 位十六进制 |
| `WECHAT_PAY_PRIVATE_KEY` | 2.4② `apiclient_key.pem` | PEM，单行 `\n` 转义 |
| `WECHAT_PAY_API_V3_KEY` | 2.4① | 32 字符 |
| `WECHAT_PAY_PLATFORM_PUBLIC_KEY` | 2.4③ | PEM，单行 `\n` 转义 |
| `WECHAT_PAY_NOTIFY_URL` | 2.5 | HTTPS |
| `WECHAT_PAY_ENABLED` | 验收后再开 | `true` |

密钥文件转单行（代码会自动把 `\n` 还原成换行，见 `pem()`）：

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' apiclient_key.pem
# 整段输出（不含最外层引号）就是 .env.local 里 WECHAT_PAY_PRIVATE_KEY 的值
```

### 2.8 常见卡点对照

| 现象 | 原因 |
| --- | --- |
| 绑定 AppID 被拒 | AppID 未认证 / 主体不一致没填授权材料 / 该 AppID 已绑别的商户号且费率不一致 |
| `401 签名错误` | `WECHAT_PAY_SERIAL_NO` 与私钥不是同一份证书；或服务器时间漂移 > 5 分钟 |
| `PARAM_ERROR: appid` | AppID 与商户号未成功绑定，或绑定还在「待确认」 |
| 回调一直报「解密失败」 | `WECHAT_PAY_API_V3_KEY` 不是 32 字符，或已被重置 |
| 回调一直报「验签失败」 | 公钥/平台证书没填对，或填了旧证书 |
| 扫码后没到账但钱扣了 | 回调进来了但验签没过 → 看服务器日志 `[Billing] WeChat notify failed`，查 `billing_webhook_events` |

---

## 第 3 步：验证这一步是否真的做完

把两边的变量都写进服务器 `.env.local`（开关保持 `false`），然后：

```bash
pnpm run check:billing-readiness
```

期望输出（`missing` 全空、`warnings` 全空）：

```json
{
  "enabled": false,
  "checkoutReady": false,
  "wechat": { "enabled": false, "configured": true, "missing": [], "warnings": [] },
  "alipay": { "enabled": false, "configured": true, "missing": [], "warnings": [] }
}
```

- `configured: true` = 密钥齐全且回调地址是 HTTPS → **第二步完成**。
- `missing` 还有名字 = 对应变量没填。
- `warnings` 有 `must use HTTPS` = `*_NOTIFY_URL` 不是 https。
- 脚本**只输出变量名，不打印密钥**，可以安全地贴到群里。

另外做两个手工校验，避免「能过检查但实际调不通」：

```bash
# 1. 私钥能被 Node 解析（不能有缺行/中文引号/多余空格）
node -e "const{createPrivateKey}=require('crypto');const{readFileSync}=require('fs');createPrivateKey(readFileSync('apiclient_key.pem','utf8'));console.log('ok')"

# 2. 支付宝私钥同理
node -e "const{createPrivateKey}=require('crypto');const{readFileSync}=require('fs');createPrivateKey(readFileSync('alipay_app_private_key.pem','utf8'));console.log('ok')"

# 3. 服务器时钟（微信验签时间窗 5 分钟）
date -u && curl -sI https://api.mch.weixin.qq.com | grep -i '^date'
```

另外提醒：生产服务器上的 `.env.local` 权限收紧到 `chmod 600`，别让其他 ftp/宝塔账号能读到。

---

## 第 4 步：这一步的收尾动作

第二步做完，先别开 `BILLING_ENABLED`。回到主文档 [wechat-alipay-integration-flow.md](wechat-alipay-integration-flow.md) 的第三步往下：跑迁移 → 部署 → 先只开支付宝 → 打一遍验收清单。

顺序不能反：**第二步只产出密钥，不产出流量**。开关打开的瞬间，任何一次配置错误都会变成真实资金问题。
