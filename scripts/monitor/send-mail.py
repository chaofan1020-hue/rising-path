#!/usr/bin/env python3
"""统一告警发信：复用自托管 GoTrue 的 Brevo SMTP 配置，给运维/站长发中文告警邮件。

为什么单独一个文件：
  * bash 里拼邮件正文/头部容易踩引号、编码、换行的坑，改用 email 库最稳；
  * SMTP 密码只从 .env 读，不落进命令行（`ps` 里看不到），也不打印。

用法：
  python3 scripts/monitor/send-mail.py --subject "主题" --body "正文"
  python3 scripts/monitor/send-mail.py --subject "主题" --body-file /tmp/body.txt
  python3 scripts/monitor/send-mail.py --subject "主题" --body "正文" --to a@x.com,b@y.com
  python3 scripts/monitor/send-mail.py --subject "主题" --body "正文" --dry-run   # 只解析配置

收件人优先级：--to > /etc/liorvix/monitor.env 的 ALERT_EMAIL_TO > .env 的 SMTP_ADMIN_EMAIL。
SMTP 配置默认从 /opt/supabase/.env 读（可用 --env-file 覆盖）。
"""
from __future__ import annotations

import argparse
import smtplib
import ssl
import sys
import time
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from pathlib import Path

DEFAULT_SMTP_ENV = "/opt/supabase/.env"
DEFAULT_MONITOR_ENV = "/etc/liorvix/monitor.env"
DEFAULT_PREFIX = "[Liorvix]"


def read_env_file(path: str) -> dict[str, str]:
    """解析 KEY=VALUE 形式的 env 文件；不展开变量、不执行任何东西。"""
    values: dict[str, str] = {}
    try:
        raw = Path(path).read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return values
    except OSError as exc:
        print(f"[mail] 读取 {path} 失败：{exc}", file=sys.stderr)
        return values
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values.setdefault(key, value)
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description="发送 Liorvix 运维告警邮件")
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body")
    parser.add_argument("--body-file")
    parser.add_argument("--to", help="逗号分隔收件人，覆盖默认收件人")
    parser.add_argument("--env-file", default=DEFAULT_SMTP_ENV)
    parser.add_argument("--monitor-env", default=DEFAULT_MONITOR_ENV)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timeout", type=int, default=25)
    args = parser.parse_args()

    if args.body_file:
        body = Path(args.body_file).read_text(encoding="utf-8", errors="replace")
    elif args.body is not None:
        body = args.body
    else:
        parser.error("必须提供 --body 或 --body-file")

    smtp = read_env_file(args.env_file)
    monitor = read_env_file(args.monitor_env)

    host = monitor.get("SMTP_HOST") or smtp.get("SMTP_HOST", "")
    port_raw = monitor.get("SMTP_PORT") or smtp.get("SMTP_PORT", "587")
    user = monitor.get("SMTP_USER") or smtp.get("SMTP_USER", "")
    password = monitor.get("SMTP_PASS") or smtp.get("SMTP_PASS", "")
    sender = monitor.get("SMTP_ADMIN_EMAIL") or smtp.get("SMTP_ADMIN_EMAIL", "")
    sender_name = monitor.get("SMTP_SENDER_NAME") or smtp.get("SMTP_SENDER_NAME", "Liorvix")

    if not host or not sender:
        print("[mail] 缺少 SMTP_HOST 或 SMTP_ADMIN_EMAIL，无法发信", file=sys.stderr)
        return 2
    try:
        port = int(port_raw)
    except ValueError:
        port = 587

    recipients: list[str] = []
    if args.to:
        recipients = [item.strip() for item in args.to.split(",") if item.strip()]
    elif monitor.get("ALERT_EMAIL_TO"):
        recipients = [item.strip() for item in monitor["ALERT_EMAIL_TO"].split(",") if item.strip()]
    else:
        recipients = [sender]

    prefix = monitor.get("ALERT_SUBJECT_PREFIX", DEFAULT_PREFIX)
    subject = args.subject if args.subject.startswith(prefix) else f"{prefix} {args.subject}"

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((sender_name, sender))
    message["To"] = ", ".join(recipients)
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=sender.split("@", 1)[-1] or "liorvix.com")
    message.set_content(body if body.endswith("\n") else body + "\n", charset="utf-8")
    message.add_alternative(
        "<div style=\"font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;"
        "white-space:pre-wrap;line-height:1.5\">"
        + body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        + "</div>",
        subtype="html",
        charset="utf-8",
    )

    if args.dry_run:
        print(f"[mail] dry-run：host={host}:{port} from={sender} to={','.join(recipients)} "
              f"subject={subject!r} body_bytes={len(body.encode('utf-8'))}")
        return 0

    started = time.time()
    try:
        if port == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, timeout=args.timeout, context=context) as client:
                if user:
                    client.login(user, password)
                client.send_message(message, from_addr=sender, to_addrs=recipients)
        else:
            with smtplib.SMTP(host, port, timeout=args.timeout) as client:
                client.ehlo()
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
                if user:
                    client.login(user, password)
                client.send_message(message, from_addr=sender, to_addrs=recipients)
    except Exception as exc:  # noqa: BLE001 - 告警通道本身失败时必须说清原因
        print(f"[mail] 发送失败（{type(exc).__name__}）：{exc}", file=sys.stderr)
        return 1

    print(f"[mail] 已发送 {len(recipients)} 封（{host}:{port}，{time.time() - started:.1f}s）：{subject}")
    return 0


if __name__ == "__main__":
    sys.exit(main())