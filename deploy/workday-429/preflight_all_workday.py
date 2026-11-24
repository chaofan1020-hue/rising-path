#!/usr/bin/env python3
"""全量前门预检：对采集器里已配置的每一家 Workday 公司，逐家对比两个 zone。

它是 `verify_front_door.py` 的静态版本：不需要在容器里跑，只要网络能通两个域，
就能一次性拿到全量证据（谁的主路通、谁的 total 对得上、谁 wdN 不在已知 pod）。

2026-11-19 实测：54/54 site 域 200，同刻 jobs 域 15/54 仍是 429 challenge，
54/54 两边 `total` 完全一致。

用法：
  python3 preflight_all_workday.py --api https://hfscareer.com/collector-api --key $KEY
  python3 preflight_all_workday.py --json out.json --table out.md --sample 5

来源优先级：命令行 > 环境变量 > 仓库 .env.local。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from workday_front_door import SHARED_SITE_PODS, split_workday_host  # noqa: E402

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def read_env_file(path: str) -> dict:
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def resolve_source(args) -> tuple[str, str]:
    base = args.api or os.environ.get("COLLECTOR_API_URL")
    key = args.key or os.environ.get("JOBS_FEED_API_KEY") or os.environ.get("INTEGRATION_API_KEY")
    if not (base and key):
        env = read_env_file(os.path.join(HERE, "..", "..", ".env.local"))
        feed = env.get("JOBS_FEED_URL") or ""
        base = base or (feed.replace("/integrations/v1/jobs", "") if feed else "")
        key = key or env.get("JOBS_FEED_API_KEY")
    if not (base and key):
        sys.exit("需要 /companies 地址和 X-Integration-Key：--api / --key，或环境变量，或 .env.local")
    return base.rstrip("/"), key


def fetch_companies(base: str, key: str) -> list[dict]:
    req = urllib.request.Request(f"{base}/companies", headers={
        "Accept": "application/json",
        "X-Integration-Key": key,
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def post_list(url: str, limit: int = 5, timeout: float = 20.0) -> dict:
    body = json.dumps({"appliedFacets": {}, "limit": limit, "offset": 0, "searchText": ""}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": UA,
    })
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw, status = resp.read(), resp.status
            mitigated = resp.headers.get("cf-mitigated")
    except urllib.error.HTTPError as exc:
        raw, status = exc.read(), exc.code
        mitigated = exc.headers.get("cf-mitigated") if exc.headers else None
    except Exception as exc:  # noqa: BLE001
        return {"status": 0, "error": f"{type(exc).__name__}: {exc}", "ms": round((time.time() - started) * 1000)}
    out = {"status": status, "cf_mitigated": mitigated, "ms": round((time.time() - started) * 1000)}
    try:
        payload = json.loads(raw)
    except Exception:  # noqa: BLE001
        out["body_head"] = raw[:120].decode("utf-8", "replace")
        return out
    out["total"] = payload.get("total")
    out["count"] = len(payload.get("jobPostings") or [])
    posts = payload.get("jobPostings") or []
    if posts:
        out["sample_title"] = posts[0].get("title")
        out["sample_path"] = posts[0].get("externalPath")
    return out


def parse_api_url(api: str):
    if not api or "/wday/cxs/" not in api:
        return None
    head, tail = api.split("/wday/cxs/", 1)
    host = head.split("//", 1)[-1].split("/")[0].lower()
    seg = tail.split("/")
    if not split_workday_host(host) or len(seg) < 2:
        return None
    return host, seg[0], seg[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", help="/companies 的 base，例如 https://hfscareer.com/collector-api")
    ap.add_argument("--key", help="X-Integration-Key")
    ap.add_argument("--json", default=os.path.join(HERE, "preflight_all_workday.json"))
    ap.add_argument("--table", default=os.path.join(HERE, "preflight_all_workday.md"))
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.35)
    args = ap.parse_args()

    base, key = resolve_source(args)
    companies = [c for c in fetch_companies(base, key) if str(c.get("connector_type") or "").lower() == "workday"]
    companies.sort(key=lambda c: c["name"])
    if args.sample:
        companies = companies[: args.sample]
    print(f"workday companies: {len(companies)}")

    rows = []
    for index, company in enumerate(companies, start=1):
        api_url = (company.get("connector_config") or {}).get("api_url") or ""
        parsed = parse_api_url(api_url)
        row = {
            "name": company.get("name"),
            "id": company.get("id"),
            "active": company.get("is_active"),
            "api_url": api_url,
            "source_url": company.get("source_url"),
            "last_crawled_at": company.get("last_crawled_at"),
        }
        if not parsed:
            row["error"] = "api_url 不是 /wday/cxs/{tenant}/{site}/jobs 形式"
            rows.append(row)
            print(f"[{index:2d}/{len(companies)}] {row['name']:<26} SKIP {row['error']}")
            continue
        host, tenant, site = parsed
        wd = split_workday_host(host)[1]
        row.update({"host": host, "tenant": tenant, "site": site, "wd": wd,
                    "wd_in_shared_pods": wd in SHARED_SITE_PODS})

        if row["wd_in_shared_pods"]:
            site_url = f"https://{wd}.myworkdaysite.com/wday/cxs/{tenant}/{site}/jobs"
            row["site_url"] = site_url
            row["site_zone"] = post_list(site_url)
            time.sleep(args.sleep)
        else:
            row["site_zone"] = {"status": 0, "error": "wdN 不在已知 site pod 列表"}

        row["jobs_zone"] = post_list(api_url)
        time.sleep(args.sleep)

        rows.append(row)
        site_zone, jobs_zone = row["site_zone"], row["jobs_zone"]
        flag = "PARITY" if site_zone.get("total") == jobs_zone.get("total") and site_zone.get("status") == 200 else ""
        print(f"[{index:2d}/{len(companies)}] {row['name']:<26} wd={wd:<5} "
              f"site={site_zone.get('status')}/{site_zone.get('total')} "
              f"jobs={jobs_zone.get('status')}/{jobs_zone.get('total')} {flag}")

    site_ok = sum(1 for r in rows if (r.get("site_zone") or {}).get("status") == 200)
    jobs_ok = sum(1 for r in rows if (r.get("jobs_zone") or {}).get("status") == 200)
    jobs_throttled = sum(1 for r in rows if (r.get("jobs_zone") or {}).get("status") == 429)
    parity = sum(1 for r in rows
                 if (r.get("site_zone") or {}).get("status") == 200
                 and (r.get("jobs_zone") or {}).get("status") == 200
                 and (r.get("site_zone") or {}).get("total") == (r.get("jobs_zone") or {}).get("total"))
    comparable = sum(1 for r in rows if (r.get("site_zone") or {}).get("status") == 200
                     and (r.get("jobs_zone") or {}).get("status") == 200)
    not_shared = [r["name"] for r in rows if r.get("wd_in_shared_pods") is False]
    unresolved = [r["name"] for r in rows if r.get("error")]

    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "base": base,
        "sleep_seconds": args.sleep,
        "limit": 5,
        "rows": rows,
    }
    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    lines = [
        f"生成时间：{report['generated_at']}　limit={report['limit']}　间隔={args.sleep}s",
        "",
        "| 公司 | tenant | site | wd | site 域 | total | jobs 域 | total |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        if row.get("error"):
            lines.append(f"| {row['name']} | - | - | - | 解析失败 | - | - | - |")
            continue
        site_zone, jobs_zone = row["site_zone"], row["jobs_zone"]
        lines.append(
            f"| {row['name']} | {row['tenant']} | {row['site']} | {row['wd']} "
            f"| {site_zone.get('status') or site_zone.get('error', '')} | {site_zone.get('total', '-')} "
            f"| {jobs_zone.get('status') or jobs_zone.get('error', '')} | {jobs_zone.get('total', '-')} |"
        )
    with open(args.table, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print("\nsummary")
    print(f"  site 域 200:            {site_ok}/{len(rows)}")
    print(f"  jobs 域 200 / 429:      {jobs_ok} / {jobs_throttled}")
    print(f"  total 逐家一致:         {parity}/{comparable}（两家都 200 的可比样本）")
    print(f"  wdN 不在已知 pod:       {not_shared}")
    print(f"  解析失败:               {unresolved}")
    print(f"  JSON:  {args.json}")
    print(f"  table: {args.table}")
    if site_ok != len(rows):
        print("\nsite 域没有全绿：先看是 429（出口/窗口）还是 DNS（该 wdN 没这个 pod），别直接切。")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())