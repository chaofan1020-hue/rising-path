# 岗位同步运行说明

## 数据口径

- `jobs` 表保留历史岗位，以维持收藏、投递、AI 匹配等外键关系。
- `is_active = true` 才是平台当前可投递岗位，后台主指标和用户端只统计这一口径。
- 非目标地区岗位保留为关闭状态，不参与查询和 AI 选岗。

## 同步机制

1. 增量同步每 2 分钟运行，逐页保存游标，并在追平后使用 10 分钟重叠窗口读取最新变化。
2. 完整对账每天运行，从上游完整读取当前岗位。任务完整结束前不会因“快照缺失”关闭岗位。
3. 岗位连续两次完整对账都消失后才关闭，避免上游一次漏页导致批量误关。
4. 上游明确返回关闭状态或 `valid_through` 已过期时立即关闭。
5. 官方链接每小时分批核验；连续两次明确返回 404/410 才关闭。403、429、超时、DNS 或 Cloudflare 限制不会关闭岗位。
6. 所有任务使用数据库租约，同一时间只能运行一个采集任务；崩溃后租约自动过期并可续跑。

## 首次部署

项目默认安装在 `/opt/liorvix`，服务用户为 `liorvix`。若实际路径或用户不同，先修改 `deploy/systemd/*.service`。

```bash
sudo cp deploy/systemd/liorvix-jobs-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liorvix-jobs-incremental.timer
sudo systemctl enable --now liorvix-jobs-reconcile.timer
sudo systemctl enable --now liorvix-jobs-maintenance.timer
```

## 运维检查

```bash
systemctl list-timers 'liorvix-jobs-*'
journalctl -u liorvix-jobs-incremental.service -n 100 --no-pager
journalctl -u liorvix-jobs-reconcile.service -n 100 --no-pager
journalctl -u liorvix-jobs-maintenance.service -n 100 --no-pager
```

管理端 `GET /api/jobs/sync-feed` 返回最后成功时间、游标、连续失败数和错误信息，可用于健康告警。
