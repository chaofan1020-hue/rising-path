# 监控、告警与备份恢复演练

本文是 Liorvix 生产环境的"可观测性"说明书：谁在监控什么、异常发到哪里、怎么验证通道、
月度恢复演练怎么跑、以及收到告警后的处置顺序。

关联文档：

- 迁移与回滚：[supabase-selfhost-migration-plan.md](./supabase-selfhost-migration-plan.md)（§12 运维、§13 回滚）
- 岗位同步排障：[job-company-field-connector-runbook.md](./job-company-field-connector-runbook.md)

---

## 1. 三层监控，各管一段

| 层 | 在哪跑 | 频率 | 覆盖 | 挂了谁会发现 |
| --- | --- | --- | --- | --- |
| **本机巡检 + 邮件告警** | VPS（`liorvix-monitor.timer`） | 每 3 分钟 | 容器、端口、磁盘、数据库连接数、备份新鲜度、公网可达、岗位同步是否在动、写入新鲜度、5xx 比例、证书天数、演练报告是否过期 | 发邮件给 `ALERT_EMAIL_TO`（线上当前 `support@liorvix.com`；未设置才会回退到 `SMTP_ADMIN_EMAIL`） |
| **外部拨测** | GitHub Actions（`uptime-probe.yml`） | 每 15 分钟 | `https://liorvix.com/api/health`、首页、`https://supabase.liorvix.com/auth/v1/health` | Actions 失败 → GitHub 给仓库 owner 发失败通知 |
| **月度恢复演练** | VPS（`liorvix-restore-drill.timer`） | 每月 1 日 04:30 | dump 能否真的恢复、数据量是否对得上、RLS/函数/属主是否还在 | 演练报告邮件（通过/失败）+ 报告文件 |

三层各自独立：本机巡检挂了不影响外部拨测；外部拨测能发现"整台机器失联"这类本机发不出告警的故障；
恢复演练是"最坏情况兜底"的验收。

---

## 2. 本机巡检与邮件告警

### 2.1 装了什么

| 文件 | 作用 |
| --- | --- |
| `scripts/monitor/health-alert.sh` | 巡检 + 状态机 + 发信；异常退出码 1 |
| `scripts/monitor/send-mail.py` | 发信实现（复用自托管 GoTrue 的 Brevo SMTP，正文 UTF-8/HTML 双份） |
| `deploy/systemd/liorvix-monitor.service` / `.timer` | 每 3 分钟跑一次（`User=root`，需要 docker 权限） |
| `/etc/liorvix/monitor.env` | 收件人、阈值等（模板见 `deploy/monitor.env.example`） |
| `/var/lib/liorvix-monitor/state.json` | 最近一次巡检结果与告警状态（防轰炸用） |

`health-alert.sh` 第一段直接调用 `scripts/migrate/healthcheck.sh`，所以原来那套基础检查
（容器 healthy / 五个容器齐全 / auth·rest·storage·app 四端点 / 磁盘 85% / 连接数 80% / 备份 36h）
全部保留，只是现在"有问题会发邮件"，不再只是往 journal 写一行。

> 因此 `liorvix-healthcheck.timer` 已停用（它的检查被 monitor 覆盖，避免重复跑）。

### 2.2 检查项与阈值

| 检查 | 通过条件 | 失败阈值 | 提醒阈值 |
| --- | --- | --- | --- |
| 基础设施 | `healthcheck.sh --quiet` 退出 0 | 任意一项 | — |
| 公网应用健康 | `https://liorvix.com/api/health` = 200（失败重试 1 次） | 非 200 | — |
| 认证服务 | `https://supabase.liorvix.com/auth/v1/health` = 200 | 非 200 | — |
| 同步进程 | `job_sync_runs` 最新记录年龄 | > 45 分钟 | > 20 分钟 |
| 同步失败数 | 近 1 小时 `status='failed'` | ≥ 5 次 | > 0 次 |
| 岗位写入 | `jobs.updated_at` 最新年龄 | > 180 分钟 | > 90 分钟 |
| 应用 5xx | 近 10 分钟 nginx access | ≥ 5 条或占比 > 2% | > 0 条 |
| Supabase 网关 5xx | 近 10 分钟 supabase.access | ≥ 30 条 | ≥ 5 条 |
| TLS 证书 | 剩余天数 | < 14 天 | < 30 天 |
| 演练报告 | 最近 `restore-drill-*.json` | > 120 天 | 缺报告或 > 60 天 |

阈值都能用环境变量覆盖（见 `deploy/monitor.env.example`），改完下一次巡检生效。

### 2.3 告警节奏（不会轰炸你）

状态写 `/var/lib/liorvix-monitor/state.json`：

- **正常 → 异常**：立刻发一封【告警】，正文含失败项、关键指标、排查入口；
- **持续异常**：每 `ALERT_REMINDER_SEC`（默认 1 小时）提醒一次，不会每 3 分钟一封；
- **异常 → 正常**：发一封【已恢复】。

同一类问题在 1 小时内只发一封。发信失败（比如 SMTP 挂了）不会吞掉信息：正文路径会写进 journal，
用 `journalctl -u liorvix-monitor -n 50` 能看到。

### 2.4 收件人怎么改

```bash
# 1) 拷贝模板
sudo mkdir -p /etc/liorvix
sudo cp /opt/liorvix/deploy/monitor.env.example /etc/liorvix/monitor.env

# 2) 编辑，把 ALERT_EMAIL_TO 换成你的常用/值班邮箱（逗号分隔可多人）
sudo nano /etc/liorvix/monitor.env

# 3) 立刻验证通道（会真发一封"当前状态"邮件，不需要等到出事）
sudo bash /opt/liorvix/scripts/monitor/health-alert.sh --force-mail
```

`monitor.env` 每次发信都会重新读取，改完不用重启服务（unit 的 EnvironmentFile 只影响进程环境，
脚本自己会读这个文件）。

> **⚠️ 收件人必须显式写**：本机 `SMTP_ADMIN_EMAIL=noreply@liorvix.com` 是 GoTrue 的发件人，
> 不是一个会有人看的信箱。`ALERT_EMAIL_TO` 留空时邮件会回退到它——看起来"发送成功"，
> 但 `support@liorvix.com` 永远收不到（2026-11-24 实际踩过）。当前线上已设为
> `ALERT_EMAIL_TO=support@liorvix.com`。

### 2.5 手工运维命令

```bash
# 人读一次完整巡检（所有检查项 + 指标）
sudo bash /opt/liorvix/scripts/monitor/health-alert.sh

# 只看结论，不打扰（--quiet 只在异常时输出）
sudo bash /opt/liorvix/scripts/monitor/health-alert.sh --quiet

# 只检查、不发信（调阈值或排查发信问题时用）
sudo bash /opt/liorvix/scripts/monitor/health-alert.sh --dry-run

# 强制发一封当前状态邮件（验证 SMTP 通道）
sudo bash /opt/liorvix/scripts/monitor/health-alert.sh --force-mail

# 看最近状态与历史
cat /var/lib/liorvix-monitor/state.json | jq .
journalctl -u liorvix-monitor --since '-1 hour' --no-pager
systemctl list-timers liorvix-monitor.timer
```

---

## 3. 外部拨测（GitHub Actions）

文件：`.github/workflows/uptime-probe.yml`

- 每 15 分钟跑一次，从 GitHub 的 runner（外部网络）curl 三个公网端点，每个最多重试 3 次；
- 失败 → 该 workflow 变红 → GitHub 按你的通知设置给仓库 owner 发邮件；
- 也可以在 Actions 页面点 **Run workflow** 手动跑。

启用步骤（一次性）：

1. 把该文件提交并推到 GitHub（见 §5 的提交说明）；
2. **必须让这个文件出现在默认分支 `main` 上**——GitHub 只对默认分支的 `schedule` 生效，
   只推到功能分支时"定时"永远不会触发（2026-11-24 就是这样：文件在
   `codex/ui-overlay-from-ui-change`，跑到 `main` 后 schedule 才真正启动）；
3. 打开仓库 → **Actions** → `uptime-probe` → **Run workflow** 手动跑一次，确认绿；
4. 仓库头像 → **Settings → Notifications**，确认 `Actions` 的失败邮件是开的（默认开）。

线上现状（2026-11-24 11:24 验证）：

- workflow 已注册为 `state=active`，默认分支 `main` 上有该文件（提交 `27d97f3`）；
- 手动 dispatch 一次跑通：run [45319228895](https://github.com/chaofan1020-hue/rising-path/actions/runs/45319228895)
  在 GitHub runner 上对三个公网端点全部 200（说明外部网络到站点是通的、workflow 本身没问题）；
- 定时（`event=schedule`）第一次触发可能比 cron 晚几分钟到半小时，用
  `Actions → uptime-probe` 看有没有 `schedule` 事件的运行即可。

限制与取舍：

- GitHub 的 `schedule` 在高峰期可能延迟几分钟，它是"机器整体失联"的兜底，不是秒级 SLA；
- 私有仓库会消耗 Actions 分钟数：15 分钟一次 ≈ 每月 2880 次 × 约 15 秒 ≈ 720 分钟，免费额度 2000 分钟够用；
- 如果你要秒级、要页面状态、要多地探测，注册 [UptimeRobot](https://uptimerobot.com) 或
  [BetterStack](https://betterstack.com)（免费档即可），加两个 HTTP(s) 监控：
  `https://liorvix.com/api/health` 与 `https://supabase.liorvix.com/auth/v1/health`，
  告警联系人填同一个邮箱。两者不冲突，可以都开。

---

## 4. 备份恢复演练

### 4.1 为什么每月跑

`db-backup.sh` 只保证"dump 能读"（`pg_restore -l` 条目数正常）。真正的风险在恢复侧：
扩展缺失、schema 冲突、属主不对、RLS 策略没回来、函数依赖断掉——这些只有**真恢复一遍**才知道。
2026-11-23 的真实切流就是被"重复恢复时 `DROP auth` 被依赖挡住"卡过（见迁移计划 §5.2），
所以这条路径必须定期再走。

### 4.2 它具体做什么

`scripts/migrate/restore-drill.sh`：

1. 取 `BACKUP_DIR` 里最新的 `liorvix-*.dump`，`pg_restore -l` 校验可读；
2. 建**临时库** `liorvix_drill_<时间戳>`（绝不碰 `postgres` 生产库）；
3. 跑伴生 `*.pre.sql` 预装扩展（备份按设计不含 `CREATE EXTENSION`）；
4. 用与生产恢复相同的过滤口径（去掉 `SCHEMA - public`、`DEFAULT ACL`）做 `pg_restore --disable-triggers`；
5. 逐表比对演练库 vs 生产库行数（auth.users / profiles / resumes / ai_matches / jobs / jobs_active …）；
6. 保真性检查：`pg_trgm` 在 public、`jobs` 开 RLS 且有策略、`search_ai_match_candidates_v7` 存在、
   `auth.users` 属主是 `supabase_auth_admin`；
7. 白名单过滤 `pg_restore` 错误（`scripts/migrate/restore-benign-errors.txt`），非白名单错误 = 失败；
8. 写报告到 `/opt/liorvix-backups/drills/restore-drill-<ts>.{md,json,log}`，只留最近 12 份；
9. **无论成功失败都会 DROP 临时库**（`KEEP_DRILL_DB=1` 可保留排查）；
10. 发一封"演练通过/失败"邮件。

### 4.3 手工跑一次

```bash
# 完整演练（会自动删临时库；磁盘需预留约 3.5 GB 峰值）
sudo bash /opt/liorvix/scripts/migrate/restore-drill.sh

# 指定某一天的 dump
sudo DUMP_FILE=/opt/liorvix-backups/liorvix-20261123-163353.dump \
  bash /opt/liorvix/scripts/migrate/restore-drill.sh

# 不发邮件（本地排查时）
sudo NO_MAIL=1 bash /opt/liorvix/scripts/migrate/restore-drill.sh

# 失败后保留临时库，进去手工看
sudo KEEP_DRILL_DB=1 bash /opt/liorvix/scripts/migrate/restore-drill.sh
```

报告：

```bash
ls -lht /opt/liorvix-backups/drills/ | head
cat /opt/liorvix-backups/drills/restore-drill-<最新>.md
```

### 4.4 注意

- 演练会在同一套 PostgreSQL 实例里建临时库，**跑的时候会占 CPU/IO/磁盘**，所以放在凌晨 04:30；
- 数据库操作一律走**容器内**的 `psql` / `pg_restore`（`docker exec` + `docker cp` dump）：
  宿主机的 `pg_hba` 只对 `postgres` 库配了免密，连其它库会弹 `Password for user supabase_admin`，
  在无人值守脚本里就是永久挂起（2026-11-24 首次实跑就卡在这里，已改为容器内执行）；
- 峰值磁盘约 +3.5 GB；当前 50 GB 盘、使用率 67%，够用。如果长期吃紧，先加盘或把
  `BACKUP_DIR` 挪到大盘；
- 脚本会用 `DROP DATABASE ... WITH (FORCE)` 清掉同名遗留库（只匹配 `liorvix_drill_*`
  和历史的 `liorvix_restore_drill`，不碰其它库）。

### 4.5 首次实跑结果（2026-11-24 10:00–10:03）

| 项目 | 结果 |
| --- | --- |
| dump | `liorvix-20261124-032117.dump`（424 MB，03:21 生成） |
| pg_restore | 退出码 **0**，耗时 223 s，错误行 **0**（白名单外 0） |
| 数据对照 | users 49/50、profiles 49/50、resumes 20/20、ai_matches 152/152、applications 21/21、interview_sessions 18/18；jobs 231,354/232,953、jobs_active 113,960/114,483（差值 = dump 后 6.7 小时的正常增长） |
| 保真性 | `pg_trgm@public` ✓、`jobs` RLS ✓、≥1 条 `jobs` 策略 ✓、`search_ai_match_candidates_v7` ✓、`auth.users` 属主 `supabase_auth_admin` ✓ |
| 收尾 | 临时库已自动删除，报告 + 邮件（`[Liorvix] 备份恢复演练：通过`）已产出 |

结论：备份**确实可恢复**，恢复后的权限/RLS/函数与生产一致；下次自动演练 12-01 04:31。

---

## 5. 收到告警之后怎么做（处置清单）

1. **先确认是不是误报**
   `sudo bash /opt/liorvix/scripts/monitor/health-alert.sh`——人读输出里能看到每一项的实际值。
   公网探测偶发失败（Cloudflare 抖动）会在重试后自愈，不必立刻动手。
2. **按告警类型分派**：

   | 告警 | 先看什么 | 常见原因 |
   | --- | --- | --- |
   | 应用健康 5xx / 非 200 | `journalctl -u liorvix -n 200`、`systemctl status liorvix` | 应用崩溃、环境变量错、端口占 |
   | 认证服务不可用 | `docker ps --filter name=liorvix-supabase`、`docker logs --since 30m liorvix-supabase-auth` | GoTrue 容器挂、DB 连不上 |
   | 容器 unhealthy | `docker inspect --format '{{.State.Health.Log}}' <容器>` | DB 慢查询/磁盘满/配置错 |
   | 同步进程停 | `journalctl -u liorvix | grep 'Job Worker'`、`/api/admin/job-sync-dashboard` | worker 崩、租约卡住、上游 429 |
   | 岗位写入停更 | 同上 + `select max(updated_at) from jobs` | 上游无数据 / 写入全失败 |
   | 5xx 比例高 | `awk '$9 ~ /^5/ {print $7, $9}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head` | 某个 API 回归、PostgREST 批量写失败 |
   | 磁盘/连接数/备份 | `df -h`、`select * from pg_stat_activity`、`ls -lht /opt/liorvix-backups` | 备份堆积、长事务、日志膨胀 |
   | 证书将过期 | `certbot renew --dry-run`，再 `systemctl reload nginx` | 自动续期失败 |
   | 演练失败/报告过期 | 看 `drills/` 里的报告与 `failure-*.log` | dump 损坏、扩展/角色缺失、磁盘不足 |

3. **改完验证**：`health-alert.sh --force-mail` 应看到"已恢复"或全部 ok；
   收到恢复邮件后把 `state.json` 里的 `first_fail_epoch` 对照一下，确认持续时长。
4. **需要回滚应用环境**（切回 Cloud Supabase）时走迁移计划 §13，不要临时改 `.env`。

### 5.1 收不到告警邮件，按这个顺序查

1. **先看收件人到底是谁**（最常见原因）：

   ```bash
   grep ALERT_EMAIL_TO /etc/liorvix/monitor.env
   sudo bash /opt/liorvix/scripts/monitor/health-alert.sh --force-mail   # 输出里带 [mail] 已发送 … 收件人
   ```

   没设置时脚本会回退到 `SMTP_ADMIN_EMAIL=noreply@liorvix.com`——那是**发件人**，不是值班信箱，
   日志照样写"已发送"，人却永远收不到（2026-11-24 踩过）。
2. **翻垃圾邮件/拦截记录**：`liorvix.com → liorvix.com` 经过外部中继（Brevo）属于"外站假冒本域"
   的典型可疑形态，容易被企业邮箱判垃圾。把 `noreply@liorvix.com` 加白名单即可。
3. **看 Brevo 侧状态**：Brevo 后台 → Transactional → Logs，能看到每封是 `delivered` / `bounced` /
   `blocked`（被 Brevo 抑制列表拦下的收件人不会投递）。
4. **想要更稳的同域投递**：把 `monitor.env` 的 SMTP 通道换成阿里云企业邮箱
   （`SMTP_HOST=smtp.qiye.aliyun.com`、`SMTP_PORT=465`、`SMTP_USER=support@liorvix.com`、
   `SMTP_PASS=该邮箱的 SMTP 授权码`），脚本支持 `SMTP_SSL`；这样发信和收信都在同一套邮件系统里。
5. **认证 DNS 现状**：SPF 已含 `spf.brevo.com`（`~all`），DMARC 为 `p=none`；如需进一步降垃圾率，
   可在 Brevo 完成 domain authentication 补 DKIM 记录。

---

## 6. 安装/重装（换机器或重建时）

```bash
# 1) 代码与脚本
sudo rsync -a --delete /path/to/repo/ /opt/liorvix/     # 或按现有发布流程

# 2) 配置文件
sudo mkdir -p /etc/liorvix
sudo cp /opt/liorvix/deploy/monitor.env.example /etc/liorvix/monitor.env
sudo editor /etc/liorvix/monitor.env

# 3) systemd 单元
sudo cp /opt/liorvix/deploy/systemd/liorvix-monitor.service \
        /opt/liorvix/deploy/systemd/liorvix-monitor.timer \
        /opt/liorvix/deploy/systemd/liorvix-restore-drill.service \
        /opt/liorvix/deploy/systemd/liorvix-restore-drill.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liorvix-monitor.timer liorvix-restore-drill.timer
sudo systemctl disable --now liorvix-healthcheck.timer   # 被 monitor 覆盖

# 4) 验证
sudo systemctl start liorvix-monitor.service        # 立即跑一次
sudo bash /opt/liorvix/scripts/monitor/health-alert.sh --force-mail   # 验证邮件通道
sudo systemctl list-timers liorvix-monitor.timer liorvix-restore-drill.timer
```

依赖：`curl`、`jq`、`openssl`、`python3`、docker。当前 VPS 全部具备。
演练用的 `psql` / `pg_restore` 在容器内执行，不依赖宿主机的 PostgreSQL 客户端。