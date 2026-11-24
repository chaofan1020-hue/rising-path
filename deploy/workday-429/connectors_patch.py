"""Workday 前门客户端：可直接贴进 /opt/global-jobs 的 connectors.py。

设计约束：
  * 不换 HTTP 栈。你给一个 transport 可调用对象，本模块只负责前门选择、
    退避与语义判定。
  * 不改 canonical URL。入库/对外链接继续用 `tenant.wdN.myworkdayjobs.com`。
  * tenant 一律来自配置，不从 host 反推——换成 `wd5.myworkdaysite.com`
    之后 host 第一段是 `wd5`，反推会把 tenant 拼错。
  * 详情是 GET 不是 POST；列表才用 POST JSON。
  * 一次请求内碰到 429 立刻换下一道前门；连续 3 次 429 才永久降级该前门。
    这两件事分开做：单次失败不该拖慢整轮，累计失败才该冷却。
"""
from __future__ import annotations

import json
import random
import time
from typing import Callable
from urllib.parse import urlsplit

from workday_front_door import (
    BLOCKED,
    ERROR,
    GONE,
    OK,
    THROTTLED,
    WorkdayDoorRouter,
    build_detail_url,
    build_list_url,
    door_candidates,
    should_fetch_next_page,
)

# transport(url, method, body_bytes, headers, timeout) -> (status:int, headers:dict, body:bytes)
Transport = Callable[[str, str, bytes | None, dict, float], tuple[int, dict, bytes]]

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_BASE_HEADERS = {"User-Agent": BROWSER_UA, "Accept": "application/json"}
_JSON_HEADERS = {**_BASE_HEADERS, "Content-Type": "application/json"}


# --------------------------------------------------------------------------- #
# transport：底下这两种写法直接替换成你们现有实现，别在本模块里再拉栈
# --------------------------------------------------------------------------- #
def requests_transport(url: str, method: str, body: bytes | None, headers: dict, timeout: float):
    import requests  # noqa: PLC0415  —— collector 现有依赖
    r = requests.request(method, url, data=body, headers=headers, timeout=timeout)
    return r.status_code, dict(r.headers), r.content


def httpx_transport(url: str, method: str, body: bytes | None, headers: dict, timeout: float):
    import httpx  # noqa: PLC0415
    with httpx.Client(http2=True, timeout=timeout, follow_redirects=False) as c:
        r = c.request(method, url, content=body, headers=headers)
        return r.status_code, dict(r.headers), r.content


class WorkdayFrontDoorClient:
    def __init__(self, transport: Transport, router: WorkdayDoorRouter | None = None, timeout: float = 20.0):
        self._transport = transport
        self.router = router or WorkdayDoorRouter()
        self.timeout = timeout
        self.stats = {"ok": 0, "throttled": 0, "failover": 0}

    # ---- 内部 ---------------------------------------------------------- #
    def _call(self, url: str, method: str, body: bytes | None, headers: dict):
        status, resp_headers, raw = self._transport(url, method, body, headers, self.timeout)
        mitigated = None
        for k, v in (resp_headers or {}).items():
            if k.lower() == "cf-mitigated":
                mitigated = v
                break
        host = urlsplit(url).hostname or ""
        outcome = self.router.note(host, status, raw[:200].decode("utf-8", "replace"), mitigated)
        return outcome, status, raw

    def _with_failover(self, host: str, build: Callable[[str], str], method: str,
                       body: bytes | None, headers: dict):
        """返回 (outcome, raw, door)。door 为 None 表示这一轮没有前门可用。"""
        tried: set[str] = set()
        last_outcome, last_raw = ERROR, b""
        while True:
            door = self.router.acquire(host, exclude=tried)
            if door is None:
                if tried:
                    # 本轮所有前门都被判限流：等冷却，不换出口、不误关岗
                    time.sleep(3.0 + random.random() * 3.0)
                return (last_outcome if tried else THROTTLED), last_raw, None
            url = build(door)
            outcome, _status, raw = self._call(url, method, body, headers)
            if outcome == OK:
                self.stats["ok"] += 1
                if tried:
                    self.stats["failover"] += 1
                return OK, raw, door
            if outcome in (BLOCKED, GONE):
                # 403/404 是事实，不是限流；换前门只会把事实洗成一个假 200
                return outcome, raw, door
            tried.add(door)
            last_outcome, last_raw = outcome, raw
            if outcome == THROTTLED:
                self.stats["throttled"] += 1
            time.sleep(0.15 + random.random() * 0.25)

    # ---- 对外 ---------------------------------------------------------- #
    def list_page(self, *, tenant: str, site: str, host: str, offset: int = 0, limit: int = 20, search_text: str = ""):
        """返回 (payload|None, door)。payload 为 None 时上层必须先看 door 再决定要不要动岗位状态。"""
        body = json.dumps({"appliedFacets": {}, "limit": limit, "offset": offset, "searchText": search_text}).encode()
        outcome, raw, door = self._with_failover(
            host, lambda d: build_list_url(d, tenant, site), "POST", body, _JSON_HEADERS
        )
        if outcome != OK:
            return None, door
        return json.loads(raw), door

    def detail(self, *, tenant: str, site: str, host: str, external_path: str):
        outcome, raw, door = self._with_failover(
            host, lambda d: build_detail_url(d, tenant, site, external_path), "GET", None, _BASE_HEADERS
        )
        if outcome != OK:
            return None, door
        return json.loads(raw), door

    def crawl_all(self, *, tenant: str, site: str, host: str, page_size: int = 20, max_pages: int = 2000):
        """整家公司的列表。返回 (jobs, total)。

        total 只在首页采信：实测 offset>0 的响应里 total 会变 0，拿它当终止条件
        会把公司截断（69 条变 40 条），然后被当成大面积下架。
        """
        jobs: list[dict] = []
        total: int | None = None
        offset = 0
        seen: set[str] = set()
        for _page in range(max_pages):
            payload, door = self.list_page(tenant=tenant, site=site, host=host, offset=offset, limit=page_size)
            if payload is None:
                raise RuntimeError(f"Workday 列表取数失败: tenant={tenant} site={site} host={host} door={door}")
            if total is None:
                value = payload.get("total")
                if isinstance(value, int) and value > 0:
                    total = value
            rows = payload.get("jobPostings") or []
            page_paths = [(row.get("externalPath") or "") for row in rows]
            # offset 越界时 Workday 会把首页再吐一遍；先把重复页丢掉再计数，
            # 否则列表会被重复条目污染，对账和"新岗位"判定都会失真。
            if offset > 0 and any(path and path in seen for path in page_paths):
                break
            jobs.extend(rows)
            offset += page_size
            if not should_fetch_next_page(total=total, page_paths=page_paths,
                                         page_size=page_size, offset=offset, seen_paths=seen):
                break
            seen.update(path for path in page_paths if path)
        return jobs, total


def door_order(host: str) -> list[str]:
    return [h for _id, h in door_candidates(host)]