#!/usr/bin/env python3
"""切前门之前的 dry-run 对账：Feed 已入库的岗位 ↔ 前门实时列表，逐条比。

它替代"人肉抽 20 条 title 对比"：external_job_id 就是 Workday 的
`externalPath`，前门列表里也有同一个字段，所以两边能逐条精确对上，不靠手抽。

两种模式：
  --company Zoom     单家对账（默认挑岗位最少的一家，切前先看它）
  --canonical-all    全量校验 canonical URL 仍然留在 myworkdayjobs 域

用法：
  python3 dryrun_parity.py --company Zoom --api https://hfscareer.com/collector-api --key $KEY
  python3 dryrun_parity.py --canonical-all --api https://hfscareer.com/collector-api --key $KEY

退出码：0 通过；1 不一致（打印差异样本）；2 取数失败。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from workday_front_door import (  # noqa: E402
    build_detail_url,
    build_list_url,
    door_candidates,
    should_fetch_next_page,
    split_workday_host,
)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
WORKDAY_JOB_HOST_SUFFIX = ".myworkdayjobs.com"


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


def resolve_source(args) -> tuple[str, str, str]:
    """返回 (/companies base, key, jobs feed url)。"""
    base = args.api or os.environ.get("COLLECTOR_API_URL")
    key = args.key or os.environ.get("JOBS_FEED_API_KEY") or os.environ.get("INTEGRATION_API_KEY")
    feed_url = os.environ.get("JOBS_FEED_URL")
    if not (base and key and feed_url):
        env = read_env_file(os.path.join(HERE, "..", "..", ".env.local"))
        base = base or (env.get("JOBS_FEED_URL", "").replace("/integrations/v1/jobs", "") or None)
        key = key or env.get("JOBS_FEED_API_KEY")
        feed_url = feed_url or env.get("JOBS_FEED_URL")
    if not (base and key and feed_url):
        sys.exit("需要 /companies 地址、key 与 jobs feed url：--api / --key / JOBS_FEED_URL，或 .env.local")
    return base.rstrip("/"), key, feed_url


def get_json(url: str, key: str, timeout: float = 30.0):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "X-Integration-Key": key})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def fetch_workday_companies(base: str, key: str) -> list[dict]:
    rows = []
    for company in get_json(f"{base}/companies", key):
        if str(company.get("connector_type") or "").lower() != "workday":
            continue
        api_url = (company.get("connector_config") or {}).get("api_url") or ""
        if "/wday/cxs/" not in api_url:
            continue
        head, tail = api_url.split("/wday/cxs/", 1)
        host = head.split("//", 1)[-1].split("/")[0].lower()
        seg = tail.split("/")
        if not split_workday_host(host) or len(seg) < 2:
            continue
        rows.append({"name": company.get("name"), "id": company.get("id"), "api_url": api_url,
                     "host": host, "tenant": seg[0], "site": seg[1]})
    rows.sort(key=lambda r: r["name"])
    return rows


def feed_jobs(company_id: str, feed_url: str, key: str, limit: int = 500) -> list[dict]:
    """把一家公司已入库的岗位全部拉出来。"""
    out: list[dict] = []
    cursor = None
    while True:
        params = f"?company_id={company_id}&include_closed=false&limit={limit}"
        if cursor:
            params += f"&cursor={cursor}"
        page = get_json(feed_url + params, key, timeout=60)
        out.extend(page.get("items") or [])
        if page.get("has_more") is not True or not page.get("next_cursor"):
            break
        cursor = page["next_cursor"]
    return out


def post_list(url: str, offset: int, limit: int, timeout: float = 25.0):
    body = json.dumps({"appliedFacets": {}, "limit": limit, "offset": offset, "searchText": ""}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def front_door_list(company: dict, page_size: int = 20, max_pages: int = 2000, attempts: int = 3):
    """用第一道可用前门把整家列表拉完，返回 (jobs, total, door_host)。

    单页失败先在同一道门上重试（门本身是好的，别为了偶发超时换门再从头拉一遍），
    连续 attempts 次都失败才换下一道门，并把每道门的失败原因都记下来。
    """
    doors = door_candidates(company["host"])
    errors: list[str] = []
    for door_id, door_host in doors:
        url = build_list_url(door_host, company["tenant"], company["site"])
        jobs: list[dict] = []
        seen: set[str] = set()
        try:
            offset = 0
            total = None
            for _page in range(max_pages):
                payload = None
                last_exc: Exception | None = None
                for attempt in range(attempts):
                    try:
                        payload = post_list(url, offset, page_size)
                        break
                    except Exception as exc:  # noqa: BLE001
                        last_exc = exc
                        time.sleep(1.0 + attempt)
                if payload is None:
                    raise RuntimeError(f"offset={offset} 连续 {attempts} 次失败: "
                                       f"{type(last_exc).__name__}: {last_exc}")
                if total is None:
                    value = payload.get("total")
                    if isinstance(value, int) and value > 0:
                        total = value
                rows = payload.get("jobPostings") or []
                page_paths = [(row.get("externalPath") or "") for row in rows]
                if offset > 0 and any(path and path in seen for path in page_paths):
                    break            # 越界复读页，丢弃
                jobs.extend(rows)
                offset += page_size
                if not should_fetch_next_page(total=total, page_paths=page_paths,
                                              page_size=page_size, offset=offset, seen_paths=seen):
                    break
                seen.update(path for path in page_paths if path)
                time.sleep(0.25)
            return jobs, total, f"{door_id}:{door_host}"
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{door_id}:{door_host} -> {type(exc).__name__}: {exc}")
    raise RuntimeError("所有前门都取数失败:\n  " + "\n  ".join(errors))


def norm_path(value: str) -> str:
    path = (value or "").strip()
    if path.startswith("/job/"):
        path = path[5:]
    return path.lstrip("/").strip().lower()


def norm_title(value: str) -> str:
    return " ".join((value or "").split()).strip().lower()


def classify_detail(status: int, mitigated: str | None) -> str:
    if status == 200:
        return "still_live"          # 列表里没有但详情还在 -> 分页漏了，属于真缺口
    if status in (404, 410):
        return "confirmed_gone"      # 官网明确撤下
    if status == 403:
        # 实测（2026-11-19，zoom）：对已下架的 posting，Workday 回
        # `S22 permission denied` 而不是 404。所以 403 不能当"还在"的证据，
        # 也不能单独当"下架"的证据 —— 这里只用来解释它为什么不在列表里。
        return "not_accessible"
    if status in (429, 503) or (mitigated or "").lower() == "challenge":
        return "throttled"
    return f"status_{status}"


def verify_missing(company: dict, items: list[tuple[str, str]], door_host: str, limit: int = 40) -> dict[str, str]:
    """对"仅在 Feed"的岗位逐个打详情 GET（保留原始大小写，lowercase 会 404）。"""
    out: dict[str, str] = {}
    for norm_key, exact_path in items[:limit]:
        url = build_detail_url(door_host, company["tenant"], company["site"], exact_path)
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                out[norm_key] = classify_detail(resp.status, resp.headers.get("cf-mitigated"))
        except urllib.error.HTTPError as exc:
            out[norm_key] = classify_detail(exc.code, exc.headers.get("cf-mitigated") if exc.headers else None)
        except Exception as exc:  # noqa: BLE001
            out[norm_key] = f"error:{type(exc).__name__}"
        time.sleep(0.2)
    return out


def run_company(name: str, base: str, key: str, feed_url: str, sample: int) -> int:
    companies = fetch_workday_companies(base, key)
    target = next((c for c in companies if c["name"].lower() == name.lower()), None)
    if target is None:
        matches = [c for c in companies if name.lower() in c["name"].lower()]
        if len(matches) != 1:
            sys.exit(f"找不到唯一公司 {name}；候选={[m['name'] for m in matches]}")
        target = matches[0]

    print(f"公司={target['name']} tenant={target['tenant']} site={target['site']} host={target['host']}")
    stored = feed_jobs(target["id"], feed_url, key)
    print(f"Feed 已入库: {len(stored)} 条")

    live, total, door = front_door_list(target, page_size=20)
    print(f"前门列表: {len(live)} 条，字段 total={total}，前门={door}")

    stored_map = {}
    for item in stored:
        key_path = norm_path(item.get("external_job_id") or "")
        if not key_path:
            continue
        stored_map.setdefault(key_path, item)
    live_map = {}
    for item in live:
        key_path = norm_path(item.get("externalPath") or "")
        if key_path:
            live_map.setdefault(key_path, item)

    only_feed = sorted(set(stored_map) - set(live_map))
    only_live = sorted(set(live_map) - set(stored_map))
    both = sorted(set(stored_map) & set(live_map))
    title_mismatch = [
        (path, stored_map[path].get("title"), live_map[path].get("title"))
        for path in both
        if norm_title(stored_map[path].get("title")) != norm_title(live_map[path].get("title"))
    ]

    print(f"\n两边都有: {len(both)}")
    print(f"仅在 Feed（可能已下架/尚未同步）: {len(only_feed)}")
    print(f"仅在前门（新发布，尚未入库）: {len(only_live)}")
    print(f"标题不一致: {len(title_mismatch)}")

    if sample and both:
        print(f"\n逐条抽样（前 {min(sample, len(both))} 条，字段证据）：")
        for path in both[:sample]:
            row_live = live_map[path]
            row_stored = stored_map[path]
            print(f"  {path[:70]:<70} title=ok loc={row_live.get('locationsText')!r} "
                  f"stored_loc={row_stored.get('location')!r} posted={row_live.get('postedOn')!r}")

    if title_mismatch:
        print("\n标题不一致样本（最多 5 条）：")
        for path, left, right in title_mismatch[:5]:
            print(f"  {path[:60]:<60} feed={left!r} front_door={right!r}")
    if only_feed:
        print(f"\n仅在 Feed（{len(only_feed)} 条）：逐条查详情，确认它不在列表是真的")
        door_host = door.split(":", 1)[1] if ":" in door else door
        pairs = [(path, stored_map[path].get("external_job_id") or path) for path in only_feed]
        verdicts = verify_missing(target, pairs, door_host)
        for path in only_feed:
            print(f"  {path[:70]:<70} -> {verdicts.get(path, 'not_checked')}")
        counts = Counter(verdicts.values())
        print(f"  详情判定分布: {dict(counts)}（404/410 或 S22 = 确实不在；200 = 分页漏了）")
    else:
        verdicts = {}
        door_host = door.split(":", 1)[1] if ":" in door else door

    # 灵敏度自检：拿一条"两边都有"的岗位打详情，必须 200。
    # 否则"不在列表所以不在官网"的判定是空的（所有详情都 403 也能过），这个自检不能省。
    detail_sanity = None
    if both:
        sanity_path = stored_map[both[0]].get("external_job_id") or both[0]
        sanity = verify_missing(target, [(both[0], sanity_path)], door_host, limit=1)
        detail_sanity = sanity.get(both[0])
        print(f"\n详情灵敏度自检（在列表中、必须 200）: {both[0][:60]} -> {detail_sanity}")
    if only_live:
        print("\n仅前门样本（最多 5 条，新发布）：")
        for path in only_live[:5]:
            print(f"  {path[:80]}  title={live_map[path].get('title')!r}")

    still_live = [p for p, v in verdicts.items() if v == "still_live"]
    unknown = [p for p, v in verdicts.items() if v not in ("still_live", "confirmed_gone", "not_accessible")]

    both_ratio = len(both) / len(stored_map) if stored_map else 0.0
    coverage = len(both) / len(live_map) if live_map else 0.0
    print(f"\n覆盖率: Feed 侧 {both_ratio:.1%}（{len(both)}/{len(stored_map)}），"
          f"前门侧 {coverage:.1%}（{len(both)}/{len(live_map)}）")

    ok = not title_mismatch and not still_live and coverage >= 0.95
    print("结论：" + ("通过。前门列表与 Feed 逐条对得上，'仅在 Feed' 的都已确认不在官网，可以切。" if ok
                     else "不通过。看标题不一致 / still_live / 覆盖率三项，别切。"))
    if unknown:
        print(f"注意：{len(unknown)} 条详情判定未知（{dict(Counter(verdicts[p] for p in unknown))}），重跑或人工看一眼。")
    if both and detail_sanity != "still_live":
        ok = False
        print(f"注意：详情灵敏度自检没拿到 200（{detail_sanity}），上面 not_accessible 的判定不可信；"
              "先确认详情接口本身能不能通，再谈对账。")
    return 0 if ok else 1


def run_canonical_all(base: str, key: str, feed_url: str) -> int:
    companies = fetch_workday_companies(base, key)
    print(f"校验 {len(companies)} 家 Workday 公司的 canonical URL host")
    bad: list[tuple[str, str, str]] = []
    totals = Counter()
    for index, company in enumerate(companies, start=1):
        try:
            rows = feed_jobs(company["id"], feed_url, key)
        except Exception as exc:  # noqa: BLE001
            print(f"[{index:2d}/{len(companies)}] {company['name']:<26} 取数失败 {type(exc).__name__}: {exc}")
            totals["fetch_error"] += 1
            continue
        expected = company["host"]
        for row in rows:
            url = (row.get("source_url") or "").strip()
            host = url.split("//", 1)[-1].split("/")[0].lower() if "//" in url else ""
            totals["checked"] += 1
            if not host.endswith(WORKDAY_JOB_HOST_SUFFIX):
                bad.append((company["name"], url, "非 myworkdayjobs 域"))
            elif host != expected:
                bad.append((company["name"], url, f"host 不是配置里的 {expected}"))
        print(f"[{index:2d}/{len(companies)}] {company['name']:<26} {len(rows):5d} 条")
        time.sleep(0.15)
    print(f"\n检查 {totals['checked']} 条 source_url；异常 {len(bad)} 条；取数失败 {totals['fetch_error']} 家")
    for name, url, reason in bad[:10]:
        print(f"  !! {name}: {reason} :: {url}")
    print("结论：" + ("通过。canonical URL 全部仍在 myworkdayjobs 域。" if not bad else "不通过：上面这些 URL 被前门污染了。"))
    return 0 if not bad else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", help="公司名（模糊匹配唯一）")
    ap.add_argument("--canonical-all", action="store_true", help="校验全部 Workday 公司的 canonical URL")
    ap.add_argument("--api")
    ap.add_argument("--key")
    ap.add_argument("--sample", type=int, default=20)
    args = ap.parse_args()
    base, key, feed_url = resolve_source(args)
    if args.canonical_all:
        return run_canonical_all(base, key, feed_url)
    if not args.company:
        sys.exit("要么 --company <名字>，要么 --canonical-all")
    return run_company(args.company, base, key, feed_url, args.sample)


if __name__ == "__main__":
    sys.exit(main())