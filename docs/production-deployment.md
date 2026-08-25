# Liorvix 生产发布手册

## 发布前必须完成的外部配置

1. 为最终生产域名创建 DNS `A` 记录，指向腾讯云美国服务器公网 IP。
2. 在 Supabase 生产项目创建名为 `resumes` 的私有 Storage bucket，并配置 Auth：
   - Site URL: `https://<production-domain>`
   - Redirect URLs: `https://<production-domain>/**`
3. 从 Supabase Dashboard 的 Connect 页面复制生产 PostgreSQL connection string；从 API 设置页面复制生产 URL、anon key 和 service role key。
4. 在 Cloudflare Turnstile 将生产域名加入 Widget 的允许域名；准备生产 site key 和 secret key。
5. 确认腾讯云安全组仅开放 TCP `80`、`443` 和受限来源的 `22`。不要开放 `5000`。

## 服务器首装

以具有 sudo 权限的 SSH 用户连接 Ubuntu/Debian 服务器后执行：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
sudo useradd --system --create-home --home-dir /opt/liorvix --shell /usr/sbin/nologin liorvix || true
sudo install -d -o liorvix -g liorvix /opt/liorvix
```

## 应用发布

将当前仓库（不含 `.env.local` 与 `node_modules`）上传或 clone 到 `/opt/liorvix`，然后：

```bash
sudo chown -R liorvix:liorvix /opt/liorvix
sudo -u liorvix cp /opt/liorvix/deploy/production.env.example /opt/liorvix/.env.local
sudo -u liorvix chmod 600 /opt/liorvix/.env.local
sudo -u liorvix nano /opt/liorvix/.env.local
sudo bash /opt/liorvix/scripts/deploy-production.sh
```

`.env.local` 中必须全部使用生产项目的密钥，尤其需要将 `AUTH_SITE_URL` 改成 `https://<production-domain>`。不要把此文件提交、上传到仓库或粘贴到聊天中。

发布脚本会启用内置的岗位后台任务，并自动停用旧版 `liorvix-jobs-*` systemd timers，避免同一任务被重复调度。

## Nginx 与 TLS

将 `deploy/nginx/liorvix.conf` 中的 `YOUR_DOMAIN` 替换为真实域名后安装：

```bash
sudo install -m 0644 /opt/liorvix/deploy/nginx/liorvix.conf /etc/nginx/sites-available/liorvix
sudo ln -sfn /etc/nginx/sites-available/liorvix /etc/nginx/sites-enabled/liorvix
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d <production-domain> --redirect --non-interactive --agree-tos -m <operations-email>
```

## 验收与日常检查

```bash
curl --fail https://<production-domain>/api/health
sudo systemctl status liorvix
sudo journalctl -u liorvix -n 200 --no-pager
sudo systemctl status certbot.timer
```

完成后，使用一个测试账号依次验证：邮箱登录/注册、简历上传与后台解析、岗位列表、AI 匹配和模拟面试的音频与 WebSocket。首次出现问题时先检查 `journalctl -u liorvix` 和 Nginx error log，切勿打开 `5000` 端口绕过 HTTPS。
