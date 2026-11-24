#!/usr/bin/env python3
"""在前端采集容器里跑这一段，验证「这个容器的出口 IP」走前门是否成立。

为什么必须在容器里跑：Cloudflare 判的是发起请求的 IP。开发机上 54/54 通过
（2026-11-19 实测）不代表机房 IP 也通过；这一步是切换生产前唯一的硬门。

数据来源（按优先级自动选）：
  1. --from-api     读采集器自己的只读接口 `/companies`，`connector_config.api_url`
                    里已经有 tenant 和 site，不用改库、不用猜字段。
  2. --from-db      读数据库；列名在容器里可能有版本差异，这里会先探测再查。
  3. --host/--site  手动指定单家。
  4. 都没有          用 6 家已知 tenant 兜底。

用法：
  python3 verify_front_door.py                                    # 自动选来源
  python3 verify_front_door.py --from-api http://127.0.0.1:8000 --api-key $KEY
  python3 verify_front_door.py --from-db --sample 5
  python3 verify_front_door.py --host zoom.wd5.myworkdayjobs.com --site Zoom

判读：
  0  site 域全绿                        -> 可以切前门
  2  site 域也 429                      -> 前门不够，要换出口（IPv6 / 代理）后重测
  3  site 域出现 403                    -> 该 tenant 的访问控制，不是限流；保持原样
  1  结果不明确（含 DNS 失败、超时）     -> 把 JSON 报告贴回来
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from workday_front_door import (  # noqa: E402
    build_detail_url,
    build_list_url,
    classify,
    door_candidates,
    split_workday_host,
)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
LIST_BODY = {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""}

DEFAULT = [
    ("zoom.wd5.myworkdayjobs.com", "zoom", "Zoom"),
    ("broadcom.wd1.myworkdayjobs.com", "broadcom", "External_Career"),
    ("salesforce.wd12.myworkdayjobs.com", "salesforce", "External_Career_Site"),
    ("workday.wd5.myworkdayjobs.com", "workday", "Workday"),
    ("ghr.wd1.myworkdayjobs.com", "ghr", "lateral-us"),
    ("vanguard.wd5.myworkdayjobs.com", "vanguard", "vanguard_external"),
]


def request(url: str, body: dict | None = None, timeout: float = 20.0):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, r.headers.get("cf-mitigated"), raw, time.time() - t0
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        return e.code, e.headers.get("cf-mitigated") if e.headers else None, raw, time.time() - t0
    except Exception as e:  # noqa: BLE001
        return 0, None, f"{type(e).__name__}: {e}", time.time() - t0


# --------------------------------------------------------------------------- #
# 取数：三条路都归一到 (company, host, tenant, site)
# --------------------------------------------------------------------------- #
def parse_api_url(api: str):
    """https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"""
    if not api or "/wday/cxs/" not in api:
        return None
    try:
        head, tail = api.split("/wday/cxs/", 1)
        host = head.split("//", 1)[-1].split("/")[0].lower()
        seg = tail.split("/")
        tenant, site = seg[0], seg[1]
    except Exception:  # noqa: BLE001
        return None
    if not split_workday_host(host) or not tenant or not site:
        return None
    return host, tenant, site


def rows_from_api(base: str, key: str) -> list[dict]:
    base = base.rstrip("/")
    req = urllib.request.Request(f"{base}/companies", headers={"Accept": "application/json", "X-Integration-Key": key})
    with urllib.request.urlopen(req, timeout=30) as resp:
        companies = json.load(resp)
    rows = []
    for company in companies:
        if str(company.get("connector_type") or "").lower() != "workday":
            continue
        api = (company.get("connector_config") or {}).get("api_url") or ""
        parsed = parse_api_url(api)
        if not parsed:
            continue
        host, tenant, site = parsed
        rows.append({"company": company.get("name"), "host": host, "tenant": tenant, "site": site, "api_url": api})
    return rows


def rows_from_db() -> list[dict]:
    """列名先探测：容器版本可能只有 connector_config，没有 api_url。"""
    dsn = os.environ.get("COLLECTOR_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("未找到 COLLECTOR_DATABASE_URL / DATABASE_URL；改用 --from-api 或 --host。")
    try:
        import psycopg  # type: ignore
    except ImportError:
        import psycopg2 as psycopg  # type: ignore

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """select column_name from information_schema.columns
               where table_name = 'job_company_sources'"""
        )
        columns = {row[0] for row in cur.fetchall()}
        if not columns:
            sys.exit("数据库里没有 job_company_sources 表；改用 --from-api 或 --host。")

        candidates = []
        if "api_url" in columns:
            candidates.append("api_url")
        if "connector_config" in columns:
            candidates.append("connector_config->>'api_url'")
        if "source_url" in columns:
            candidates.append("source_url")
        if "job_board_url" in columns:
            candidates.append("job_board_url")
        if not candidates:
            sys.exit(f"这些列都找不到 api_url 入口: {sorted(columns)}")

        where = "is_active" if "is_active" in columns else "true"
        type_filter = "lower(coalesce(source_type,'')) = 'workday'" if "source_type" in columns else "true"
        name_col = "company_name" if "company_name" in columns else "'?'"
        select_list = ", ".join([name_col] + candidates)
        cur.execute(f"select {select_list} from job_company_sources where {where} and {type_filter}")

        rows, skipped = [], 0
        for record in cur.fetchall():
            name, values = record[0], record[1:]
            parsed = None
            for value in values:
                parsed = parse_api_url(value if isinstance(value, str) else "")
                if parsed:
                    break
            if not parsed:
                skipped += 1
                continue
            host, tenant, site = parsed
            rows.append({"company": name, "host": host, "tenant": tenant, "site": site, "api_url": values[-1]})
        if skipped:
            print(f"[warn] {skipped} 家 workday 行里没有可解析的 api_url，已跳过")
    return rows


# --------------------------------------------------------------------------- #
# 探测
# --------------------------------------------------------------------------- #
def probe_row(row: dict, detail_sample: int, index: int, total: int) -> dict:
    host, tenant, site = row["host"], row["tenant"], row["site"]
    doors = door_candidates(host)
    result = dict(row)
    result["doors"] = [{"id": i, "host": h} for i, h in doors]
    result["zones"] = {}

    for door_id, door_host in doors:
        url = build_list_url(door_host, tenant, site)
        status, mitigated, raw, secs = request(url, LIST_BODY)
        outcome = classify(status, mitigated=mitigated)
        total_jobs = None
        sample_path = None
        try:
            payload = json.loads(raw)
            total_jobs = payload.get("total")
            posts = payload.get("jobPostings") or []
            if posts:
                sample_path = posts[0].get("externalPath")
        except Exception:  # noqa: BLE001
            pass
        result["zones"][door_id] = {
            "url": url, "status": status, "outcome": outcome,
            "cf_mitigated": mitigated, "total": total_jobs, "seconds": round(secs, 2),
            "sample_path": sample_path,
            "error": None if status else raw[:200],
        }
        print(f"[{index:2d}/{total}] {row.get('company','?'):<26} {door_id:22} "
              f"{status or 'ERR':>3} {outcome:9} total={total_jobs} "
              f"cf-mitigated={mitigated or '-'} {secs:.1f}s")
        time.sleep(0.35)

    if detail_sample > 0:
        site_host = next((h for i, h in doors if i == "myworkdaysite-shared"), None)
        primary = result["zones"].get("myworkdaysite-shared")
        if site_host and primary and primary["status"] == 200 and primary.get("sample_path"):
            slug = str(primary["sample_path"]).replace("/job/", "", 1)
            url = build_detail_url(site_host, tenant, site, slug)
            status, mitigated, raw, secs = request(url)
            title = None
            try:
                title = json.loads(raw).get("jobPostingInfo", {}).get("title")
            except Exception:  # noqa: BLE001
                pass
            result["detail"] = {
                "url": url, "status": status, "outcome": classify(status, mitigated=mitigated),
                "title": title, "seconds": round(secs, 2),
            }
            print(f"[{index:2d}/{total}] {'':<26} detail-via-site          "
                  f"{status or 'ERR':>3} {classify(status, mitigated=mitigated):9} title={title}")
            time.sleep(0.35)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-api", dest="from_api", help="采集器地址，例如 http://127.0.0.1:8000")
    ap.add_argument("--api-key", dest="api_key", help="X-Integration-Key；也可用 JOBS_FEED_API_KEY")
    ap.add_argument("--from-db", action="store_true")
    ap.add_argument("--host")
    ap.add_argument("--site")
    ap.add_argument("--tenant")
    ap.add_argument("--sample", type=int, default=0, help="只测前 N 家")
    ap.add_argument("--detail-sample", type=int, default=1, help="对前 N 家打一次详情 GET，0 关闭")
    ap.add_argument("--json", default="/tmp/workday_front_door_report.json")
    ap.add_argument("--sleep", type=float, default=0.35)
    args = ap.parse_args()

    if args.host:
        parsed = split_workday_host(args.host)
        if not parsed:
            sys.exit(f"{args.host} 不是 Workday 官方 host")
        if not args.site:
            sys.exit("需要 --site")
        rows = [{"company": "manual", "host": args.host, "tenant": args.tenant or parsed[0],
                 "site": args.site, "api_url": ""}]
        source = "manual"
    elif args.from_db:
        rows, source = rows_from_db(), "db"
    else:
        base = args.from_api or os.environ.get("COLLECTOR_API_URL")
        key = args.api_key or os.environ.get("JOBS_FEED_API_KEY") or os.environ.get("INTEGRATION_API_KEY")
        if base and key:
            try:
                rows, source = rows_from_api(base, key), "api"
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] /companies 取数失败（{type(exc).__name__}: {exc}），改用已知 tenant 兜底")
                rows, source = [dict(zip(("host", "tenant", "site"), r), company=r[0]) for r in DEFAULT], "default"
        else:
            rows = [dict(zip(("host", "tenant", "site"), r), company=r[0]) for r in DEFAULT]
            source = "default"

    if args.sample:
        rows = rows[: args.sample]
    if not rows:
        sys.exit("没有可测的 Workday 行。")

    print(f"来源={source} 共 {len(rows)} 家；开始前门预检\n")
    results = []
    for index, row in enumerate(rows, start=1):
        try:
            results.append(probe_row(row, args.detail_sample if index <= args.detail_sample else 0, index, len(rows)))
        except KeyboardInterrupt:
            print("\n中断，写入已测部分。")
            break

    tally: dict[str, dict[str, int]] = {}
    for item in results:
        for door_id, zone in item["zones"].items():
            tally.setdefault(door_id, {}).setdefault(zone["outcome"], 0)
            tally[door_id][zone["outcome"]] += 1

    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source": source,
        "hostname": os.uname().nodename if hasattr(os, "uname") else os.environ.get("HOSTNAME"),
        "tally": tally,
        "rows": results,
    }
    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    print("\n---- 汇总 ----")
    for door_id, outcomes in tally.items():
        print(f"{door_id:22} {outcomes}")
    print(f"报告: {args.json}")

    primary = tally.get("myworkdaysite-shared", {})
    jobs_zone = tally.get("myworkdayjobs", {})
    if primary.get("blocked"):
        print("\n结论：myworkdaysite 出现 403 -> 租户访问控制，不是限流；这些公司保持原样，不要关岗。")
        return 3
    if primary.get("throttled"):
        print("\n结论：这个容器的出口 IP 连 myworkdaysite 也被 429 -> 前门不够，需要换出口（IPv6 / 代理）后重测。")
        return 2
    if primary.get("ok") and primary.get("ok") == len(results):
        print(f"\n结论：site 域 {primary['ok']}/{len(results)} 全绿"
              f"（同刻 jobs 域 {jobs_zone}）-> 可以切前门。")
        return 0
    print("\n结论：结果不明确，把上面的逐行输出或 JSON 报告贴回来。")
    return 1


if __name__ == "__main__":
    sys.exit(main())