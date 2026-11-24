# 事故记录：2026-11-23 13:34 生产用户被误删（已完全恢复）

## 一句话结论

我（AI 操作方）在执行"真实发信验收"时，测试脚本把**用户自带的真实邮箱 `1326136510@qq.com` 当成临时探针账号删除**。14:00 起从 `liorvix-20261123-120550.dump` 完整恢复该用户 **22 张表 / 约 600 行**数据，14:08 校验 **0 异常**。

## 时间线（Asia/Shanghai）

| 时间 | 事件 |
|---|---|
| 13:34 | 执行 `server-smtp-live.sh`，向 `1326136510@qq.com` 发验收邮件 |
| 13:34 | 脚本 `POST /admin/users` 建用户失败（该邮箱**已存在**），走"已存在"分支 |
| 13:34 | 脚本末尾无条件 `DELETE /admin/users/{id}` → 删除真实账号 |
| 13:52 | 发现 `auth.users` 里该邮箱 0 命中，确认事故 |
| 13:56 | 定位到删除前最近的 dump：`liorvix-20261123-120550.dump`（423 MB） |
| 14:00 | 整库还原到临时库 `scratch_probe`，确认该用户 22 张表均有数据 |
| 14:01 | JSON 通道恢复（v3，排除 `auth.users.confirmed_at` 生成列）首次成功 |
| 14:04 | 删除测试脚本误建的 `resent-1795432372-…` 垃圾账号，`auth.users` 回到 47 |
| 14:08 | 端到端校验通过；14:13 验收 40/40 全绿 |

## 根因

测试脚本的"确保用户存在"逻辑有致命缺陷：

```bash
# 建用户失败（已存在）时 UID_ 为空 → 走 else 分支按邮箱查 id
UID_=$(curl -X POST .../admin/users ...)
if [ -z "$UID_" ]; then
  UID_=$(... 按邮箱查 id ...)     # ← 查到的可能是真实用户
fi
...
curl -X DELETE .../admin/users/$UID_   # ← 无条件删除
```

**删除动作不区分"本次新建的探针"和"原本就存在的真实用户"**。

## 恢复方式（可复用）

删除 `auth.users` 行会通过 `ON DELETE CASCADE` 级联清掉 22 张业务表。恢复要点：

1. **必须用删除时刻之前的 dump**，`/opt/liorvix-backups/` 里按 mtime 选。
2. 先整库还原到临时库（`pg_restore`，约 200 s），确认目标行都在。
3. 逐表导出为 JSON（`json_agg`），再 `insert into T (cols) select cols from json_populate_recordset(null::T, :'j')`。
   - **不能用 COPY CSV**：`auth.users` 有生成列 `confirmed_at`，且 CSV 在这套栈上反复报
     `extra data after last expected column`。
4. **必须排除生成列**：`information_schema.columns.is_generated = 'NEVER'`。
5. **必须 `set session_replication_role = replica`**：绕过外键顺序与 `on_auth_user_created` 触发器
   （否则恢复 profiles 时会和触发器打架）。
6. **`ON DELETE SET NULL` 的表只 UPDATE 不 INSERT**，否则重复：
   - `public.ai_usage_events.user_id`（70 行）
   - `public.resumes.profile_confirmed_by`（2 行）
   - `public.resume_profile_versions.confirmed_by`（4 行）
7. 恢复后修所有 sequence：`setval(pg_get_serial_sequence(...), max(col))`，否则后续插入主键冲突。

脚本：`tmp/server-restore-json.sh`（v3，已跑通）。

## 恢复结果

```
auth.users            live=1   dump=1   ✓
auth.identities       live=2   dump=2   ✓   (email + github 274203166)
auth.sessions         live=15  dump=15  ✓
auth.refresh_tokens   live=61  dump=61  ✓
public.profiles       live=1   dump=1   ✓
public.resumes        live=3   dump=3   ✓   （3 个 PDF，storage 对象均在）
public.resume_profile_versions 7/7 ✓
public.ai_match_runs  7/7 ✓
public.ai_matches     44/44 ✓
public.applications   3/3 ✓
public.application_profiles 1/1 ✓
public.billing_orders 13/13 ✓
public.credit_accounts 1/1 ✓   （余额 1169.9698 保留）
public.credit_ledger  155/155 ✓
public.credit_reservations 148/148 ✓
public.favorites      2/2 ✓
public.interview_questions 11/11 ✓
public.interview_sessions 8/8 ✓
public.interview_turns 20/20 ✓
public.interview_realtime_tickets 14/14 ✓
public.payment_handoff_tickets 3/3 ✓
public.personality_assessments 1/1 ✓
```

全局计数回到：`auth.users=47`、`resumes=19`、`ai_matches=137`、`profiles=47`、`jobs=230432`，
孤儿行 0。

验证：`RLS` 下该用户 token 能读到自己的 3 份简历；`bcrypt hash` 60 字符完整（旧密码可用）；
错误密码登录返回 `400 invalid_credentials`（证明账号存在且可校验）。

## 防复发规则（必须遵守）

1. **禁止在任何脚本里对"可能是真实用户"的对象执行 DELETE。**
   需要探针账号时，邮箱必须带不可碰撞的时间戳前缀（`probe-<epoch>-<rand>@liorvix.test`），
   且删除前断言 `email LIKE 'probe-%@liorvix.test'`。
2. **禁止把用户提供的真实邮箱当探针。** 用户给邮箱是为了**收信验收**，
   不是让你在他账号上做增删改。
3. 探针账号一律在 `@liorvix.test` 域（无 MX，注定退信），不污染真实域。
4. 任何写入生产库的操作，先 `--dry-run` 打印将影响的 UUID 列表。
5. 删除类操作前必须 `select` 出目标行给人看一眼（或至少打印 id+email 到日志）。

## 教训

用户问"验证一下"，验证动作本身就必须是**只读或幂等新增**的。发一封邮件是安全的；
"顺手清掉测试用户"不是——而且当时的脚本正好把"已存在"当成"我建的"。