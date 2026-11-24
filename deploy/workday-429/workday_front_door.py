"""Workday 429 前门分流（collector 侧纯逻辑，无 HTTP 依赖）。

背景（2026-11-19 实测，见 docs/workday-429-front-door-solution.md）：
  `*.myworkdayjobs.com` 的 CXS 端点被 Cloudflare 以 `cf-mitigated: challenge`
  形式回 429，连续请求 60/60 全 429；同一 tenant/site 的同一 CXS 契约在
  `wdN.myworkdaysite.com` 上是 60/60 200。这是两个独立 CF zone，不是速率问题。

本模块只做四件事：
  1. 把 `tenant.wdN.myworkdayjobs.com` 拆成 (tenant, wdN)，给出有序前门列表。
  2. 每个前门独立健康度：连续 3 次 429/challenge 自动降级，指数冷却，成功即恢复。
  3. 每个前门独立令牌桶，互不牵连（一个前门被限不影响另一个）。
  4. 事故口径不变：403 仍是租户访问控制，404/410 仍是官网撤下，不因前门切换改语义。

不做的事：不改 canonical 岗位 URL。对外 URL 永远留在 `*.myworkdayjobs.com`。
"""
from __future__ import annotations

import re
import threading
import time
from typing import Callable, Iterable

WORKDAY_HOST_RE = re.compile(r"^(?P<tenant>[a-z0-9-]+)\.(?P<wd>wd\d+)\.myworkdayjobs\.com$", re.I)
# 实测存在的 myworkdaysite pod（DNS 直查，2026-11-19）：wd1 wd3 wd5 wd10 wd12 wd103 wd105 wd108 wd115 wd120 wd501-504
SHARED_SITE_PODS = frozenset({
    "wd1", "wd3", "wd5", "wd10", "wd12", "wd103",
    "wd105", "wd108", "wd115", "wd120",
    "wd501", "wd502", "wd503", "wd504",
})

OK, THROTTLED, BLOCKED, GONE, ERROR = "ok", "throttled", "blocked", "gone", "error"
_THROTTLE_CODES = {429, 503}
HEALTH_WINDOW = 3               # 连续 N 次被限即降级
COOLDOWN_BASE = 60.0            # 秒
COOLDOWN_MAX = 900.0


def split_workday_host(host: str) -> tuple[str, str] | None:
    """tenant.wd5.myworkdayjobs.com -> ('tenant', 'wd5')；非该域返回 None。"""
    m = WORKDAY_HOST_RE.match((host or "").strip().lower())
    return (m.group("tenant"), m.group("wd").lower()) if m else None


def door_candidates(host: str) -> list[tuple[str, str]]:
    """有序前门：[(door_id, host), ...]。第一项才是主路。"""
    parsed = split_workday_host(host)
    if not parsed:
        return [("as-given", host)]
    tenant, wd = parsed
    doors: list[tuple[str, str]] = []
    if wd in SHARED_SITE_PODS:
        doors.append(("myworkdaysite-shared", f"{wd}.myworkdaysite.com"))
    doors.append(("myworkdayjobs", f"{tenant}.{wd}.myworkdayjobs.com"))
    # 租户级 myworkdaysite 主机只有少数大租户存在（实测 salesforce 有，其余 NXDOMAIN），
    # 放最后：只在需要第三个独立桶时才用，别让它挡在正常路径上。
    doors.append(("myworkdaysite-tenant", f"{tenant}.{wd}.myworkdaysite.com"))
    return doors


def build_list_url(door_host: str, tenant: str, site: str) -> str:
    return f"https://{door_host}/wday/cxs/{tenant}/{site}/jobs"


def build_detail_url(door_host: str, tenant: str, site: str, external_path: str) -> str:
    """external_path 既可以是 `/job/Loc/Slug_R1`，也可以是 `/Loc/Slug_R1`。"""
    tail = (external_path or "").strip().lstrip("/")
    if tail[:4].lower() == "job/":
        tail = tail[4:]
    return f"https://{door_host}/wday/cxs/{tenant}/{site}/job/{tail}"


def canonical_job_url(job_host: str, site: str, external_path: str) -> str:
    """对外展示/入库的官方链接。永远用 myworkdayjobs 原 host，不用前门。"""
    path = external_path if external_path.startswith("/") else "/" + external_path
    return f"https://{job_host}/{site}{path}"


def classify(status: int, body_head: str = "", mitigated: str | None = None) -> str:
    if status == 200:
        return OK
    if status in _THROTTLE_CODES or (mitigated or "").lower() == "challenge":
        return THROTTLED
    if status in (401, 403):
        return BLOCKED      # 租户访问控制，例如 Accenture S22；不是限流
    if status in (404, 410):
        return GONE         # 官网明确撤下
    return ERROR


_SHARED_SITE_RE = re.compile(r"^wd\d+\.myworkdaysite\.com$", re.I)
_TENANT_SITE_RE = re.compile(r"^[a-z0-9-]+\.wd\d+\.myworkdaysite\.com$", re.I)


def door_id_for(host: str) -> str:
    """从 host 反推前门 id，供 note() 在还没 acquire 过时也能正确记账。"""
    host = (host or "").strip().lower()
    if _SHARED_SITE_RE.match(host):
        return "myworkdaysite-shared"
    if _TENANT_SITE_RE.match(host):
        return "myworkdaysite-tenant"
    if WORKDAY_HOST_RE.match(host):
        return "myworkdayjobs"
    return "as-given"


class _Door:
    __slots__ = ("door_id", "host", "strikes", "until", "cooldown", "tokens", "last")

    def __init__(self, door_id: str, host: str, rate: float, burst: float, now: float):
        self.door_id = door_id
        self.host = host
        self.strikes = 0
        self.until = 0.0
        self.cooldown = 0.0
        self.tokens = burst
        self.last = now


class WorkdayDoorRouter:
    """按 host 维护前门健康度与限速；线程安全。clock 可注入，便于测试。"""

    def __init__(self, rate_per_door: float = 4.0, burst: float = 8.0,
                 clock: Callable[[], float] = time.monotonic):
        self._rate = rate_per_door
        self._burst = burst
        self._clock = clock
        self._doors: dict[str, _Door] = {}
        self._lock = threading.Lock()

    def _room(self, door_id: str, host: str) -> _Door:
        door = self._doors.get(host)
        if door is None:
            door = _Door(door_id or door_id_for(host), host, self._rate, self._burst, self._clock())
            self._doors[host] = door
        return door

    def _usable(self, host: str, exclude: set[str] | None = None) -> list[tuple[str, str]]:
        doors = door_candidates(host)
        now = self._clock()
        skip = exclude or set()
        return [(i, h) for i, h in doors if h not in skip and self._room(i, h).until <= now]

    def plan(self, host: str) -> list[str]:
        """当前未冷却的前门，按优先级；全部冷却时返回完整列表供调用方自决。"""
        with self._lock:
            live = self._usable(host)
            return [h for _i, h in (live or door_candidates(host))]

    def acquire(self, host: str, blocking: bool = True,
                exclude: set[str] | None = None) -> str | None:
        """挑第一条未冷却且未被本次请求排除的前门并占一个令牌。

        令牌耗尽时：阻塞模式下等令牌（不降级到次先前门——次先前门的 DNS
        未必存在，硬切只会把限流变成 DNS 错误），非阻塞模式下返回 None。
        """
        while True:
            with self._lock:
                usable = self._usable(host, exclude)
                if not usable:
                    return None            # 全部门都冷却/被排除，调用方按退避处理
                door_id, door_host = usable[0]
                door = self._room(door_id, door_host)
                now = self._clock()
                door.tokens = min(self._burst, door.tokens + (now - door.last) * self._rate)
                door.last = now
                if door.tokens >= 1:
                    door.tokens -= 1
                    return door_host
                wait = (1.0 - door.tokens) / self._rate
            if not blocking:
                return None
            time.sleep(min(wait, 1.0))

    def note(self, door_host: str, status: int, body_head: str = "", mitigated: str | None = None) -> str:
        """把一次响应喂回健康度，返回 classify() 语义。"""
        outcome = classify(status, body_head, mitigated)
        with self._lock:
            door = self._room(door_id_for(door_host), door_host)
            if outcome == THROTTLED:
                door.strikes += 1
                if door.strikes >= HEALTH_WINDOW:
                    door.cooldown = min(COOLDOWN_MAX, door.cooldown * 2 if door.cooldown else COOLDOWN_BASE)
                    door.until = self._clock() + door.cooldown
                    door.strikes = 0
                    door.tokens = 0.0
            elif outcome == OK:
                door.strikes = 0
                door.cooldown = 0.0
                door.until = 0.0
        return outcome

    def snapshot(self) -> list[dict]:
        with self._lock:
            now = self._clock()
            return [
                {"door": d.door_id, "host": d.host,
                 "cooling_for": round(max(0.0, d.until - now), 1), "strikes": d.strikes}
                for d in self._doors.values()
            ]


def ordered_hosts_by_tenant(hosts: Iterable[str]) -> dict[tuple[str, str], list[str]]:
    """批量预热：一次把库里所有 Workday host 展开成前门列表，便于 dry-run 打印。"""
    out: dict[tuple[str, str], list[str]] = {}
    for h in hosts:
        parsed = split_workday_host(h)
        if parsed:
            out[parsed] = [host for _id, host in door_candidates(h)]
    return out


def should_fetch_next_page(*, total: int | None, page_paths: list[str],
                           page_size: int, offset: int, seen_paths: set[str]) -> bool:
    """分页终止判定。返回 True 表示还要再取一页。

    实测怪癖（2026-11-19，site 域 `zoom`）：`offset > 0` 的响应里 `total` 会变成
    0，只有首页（offset=0）和越界页才带真值。所以：

      * `total` 只在首页采信，后续页面返回 0 不能当成"空列表"；
      * 终止靠"本页是否满页"和"是否出现重复路径"（越界时 Workday 会把首页
        再吐一遍），而不是靠 total。

    这个坑会把 69 条的公司截成 40 条，进而被当成大面积下架 —— 必须挡住。
    """
    if not page_paths:
        return False
    if len(page_paths) < page_size:
        return False
    if any(path and path in seen_paths for path in page_paths):
        return False
    if total is not None and total > 0 and offset >= total:
        return False
    return True