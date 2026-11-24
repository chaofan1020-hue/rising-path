"""Workday 前门开关（最小侵入版）：把 CXS 请求的 host 从 myworkdayjobs 换到 myworkdaysite。

为什么不是改连接器：
  采集器里 54 家 Workday 公司的 `connector_config.api_url` 全部形如
  `https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`
  （2026-11-19 从 /companies 实测）。tenant 和 site 都已持久化，不用回填、
  不用改库、不用逐家改配置。真正需要改的只有一件事：请求往哪个域名发。

所以本模块在 HTTP 出口处做一次 host 改写，采集器只需要两行：

    import front_door_shim
    front_door_shim.install()

约束（与 workday_front_door 一致）：
  * 只改写路径里带 `/wday/cxs/` 的请求。官网岗位页 HTML（`/…/job/…`）不动。
  * 只改写 `{tenant}.{wdN}.myworkdayjobs.com`。别的域名一律透传。
  * canonical URL、入库链接、job_url 全部不变：改写只发生在出站请求上。
  * site 域若回 429/403/503，可回落到原 host（保持今天的行为），绝不把
    403 洗成 200，也不碰 404/410。

回滚：`front_door_shim.uninstall()`，或删掉 connectors.py 里那两行。
"""
from __future__ import annotations

import re
import threading
from urllib.parse import urlsplit, urlunsplit

WORKDAY_HOST_RE = re.compile(r"^(?P<tenant>[a-z0-9-]+)\.(?P<wd>wd\d+)\.myworkdayjobs\.com$", re.I)
CXS_MARKER = "/wday/cxs/"

# 与 workday_front_door.SHARED_SITE_PODS 保持一致（同一天 DNS 实测）。
SHARED_SITE_PODS = frozenset({
    "wd1", "wd3", "wd5", "wd10", "wd12", "wd103",
    "wd105", "wd108", "wd115", "wd120",
    "wd501", "wd502", "wd503", "wd504",
})

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
# 伪装成浏览器的同源 XHR。生产实测（2026-11-20）：只换域名不改这些头的话，新门
# 在晚上 16:30 / 19:00 前后仍会被 Cloudflare 挑战一阵 —— 脚本 UA 和指向旧域的
# Origin/Referer 都在自报"我是机器人"。
BROWSER_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
}
BROWSER_HEADER_KEYS = frozenset(key.lower() for key in BROWSER_HEADERS) | {"origin", "referer"}
FALLBACK_CODES = frozenset({429, 403, 503})

_lock = threading.Lock()
_installed: dict[str, object] = {}
_stats = {"rewritten": 0, "fallback": 0, "left_as_is": 0}
_prefix_map: dict[str, str] = {}
_fallback_on_throttle = True
_force_browser_ua = True


def site_prefix_for(host: str) -> str | None:
    """`zoom.wd5.myworkdayjobs.com` -> `https://wd5.myworkdaysite.com`；不可改写返回 None。"""
    match = WORKDAY_HOST_RE.match((host or "").strip())
    if not match:
        return None
    wd = match.group("wd").lower()
    if wd not in SHARED_SITE_PODS:
        return None
    return f"https://{wd}.myworkdaysite.com"


def rewrite_url(url: str) -> str:
    """纯函数：只读这一个入口做改写判定，测试和线上走同一份逻辑。"""
    if not isinstance(url, str) or CXS_MARKER not in url:
        return url
    parts = urlsplit(url)
    if not parts.hostname:
        return url
    prefix = f"{parts.scheme}://{parts.netloc}"
    replacement = _prefix_map.get(prefix) or site_prefix_for(parts.hostname)
    if not replacement or replacement == prefix:
        return url
    new_parts = urlsplit(replacement)
    return urlunsplit((
        new_parts.scheme or parts.scheme,
        new_parts.netloc,
        parts.path,
        parts.query,
        parts.fragment,
    ))


def browser_headers(target_url: str, original=None) -> dict:
    """把请求头对齐到新门：浏览器 UA + Client Hints，Origin/Referer 用新门自己的。"""
    parts = urlsplit(target_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    headers = {
        key: value for key, value in dict(original or {}).items()
        if str(key).lower() not in BROWSER_HEADER_KEYS
    }
    if _force_browser_ua:
        headers.update(BROWSER_HEADERS)
    headers["Origin"] = origin
    headers["Referer"] = origin + "/"
    return headers


def stats() -> dict:
    with _lock:
        return dict(_stats)


def reset_stats() -> None:
    with _lock:
        for key in _stats:
            _stats[key] = 0


# --------------------------------------------------------------------------- #
# requests
# --------------------------------------------------------------------------- #
def _install_requests() -> bool:
    try:
        import requests  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return False
    if getattr(requests.sessions.Session.request, "_front_door_shim", False):
        return True

    original = requests.sessions.Session.request

    def request(self, method, url, *args, **kwargs):
        target = rewrite_url(url)
        if target == url:
            with _lock:
                _stats["left_as_is"] += 1
            return original(self, method, url, *args, **kwargs)

        caller_headers = kwargs.get("headers")
        kwargs["headers"] = browser_headers(target, caller_headers)
        response = original(self, method, target, *args, **kwargs)
        with _lock:
            _stats["rewritten"] += 1

        status = getattr(response, "status_code", 0)
        if _fallback_on_throttle and status in FALLBACK_CODES:
            with _lock:
                _stats["fallback"] += 1
            try:
                response.close()
            except Exception:  # noqa: BLE001
                pass
            # 回落原 host 时把伪装头撤掉，别拿新域的 Origin/UA 去敲旧域
            fallback_kwargs = {k: v for k, v in kwargs.items() if k != "headers"}
            if caller_headers is not None:
                fallback_kwargs["headers"] = caller_headers
            return original(self, method, url, *args, **fallback_kwargs)
        return response

    request._front_door_shim = True  # type: ignore[attr-defined]
    requests.sessions.Session.request = request
    _installed["requests"] = original
    return True


# --------------------------------------------------------------------------- #
# httpx（同步 / 异步）
# --------------------------------------------------------------------------- #
def _install_httpx() -> bool:
    try:
        import httpx  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return False

    client_cls = getattr(httpx, "Client", None)
    if client_cls is not None and not getattr(client_cls.request, "_front_door_shim", False):
        original_sync = client_cls.request

        def request(self, method, url, *args, **kwargs):
            target = rewrite_url(url)
            if target == url:
                with _lock:
                    _stats["left_as_is"] += 1
                return original_sync(self, method, url, *args, **kwargs)
            caller_headers = kwargs.get("headers")
            kwargs["headers"] = browser_headers(target, caller_headers)
            response = original_sync(self, method, target, *args, **kwargs)
            with _lock:
                _stats["rewritten"] += 1
            if _fallback_on_throttle and response.status_code in FALLBACK_CODES:
                with _lock:
                    _stats["fallback"] += 1
                response.close()
                fallback_kwargs = {k: v for k, v in kwargs.items() if k != "headers"}
                if caller_headers is not None:
                    fallback_kwargs["headers"] = caller_headers
                return original_sync(self, method, url, *args, **fallback_kwargs)
            return response

        request._front_door_shim = True  # type: ignore[attr-defined]
        client_cls.request = request
        _installed["httpx"] = original_sync

    async_cls = getattr(httpx, "AsyncClient", None)
    if async_cls is not None and not getattr(async_cls.request, "_front_door_shim", False):
        original_async = async_cls.request

        async def arequest(self, method, url, *args, **kwargs):
            target = rewrite_url(url)
            if target == url:
                with _lock:
                    _stats["left_as_is"] += 1
                return await original_async(self, method, url, *args, **kwargs)
            caller_headers = kwargs.get("headers")
            kwargs["headers"] = browser_headers(target, caller_headers)
            response = await original_async(self, method, target, *args, **kwargs)
            with _lock:
                _stats["rewritten"] += 1
            if _fallback_on_throttle and response.status_code in FALLBACK_CODES:
                with _lock:
                    _stats["fallback"] += 1
                await response.aclose()
                fallback_kwargs = {k: v for k, v in kwargs.items() if k != "headers"}
                if caller_headers is not None:
                    fallback_kwargs["headers"] = caller_headers
                return await original_async(self, method, url, *args, **fallback_kwargs)
            return response

        arequest._front_door_shim = True  # type: ignore[attr-defined]
        async_cls.request = arequest
        _installed["httpx_async"] = original_async

    return True


def install(
    *,
    prefix_map: dict[str, str] | None = None,
    fallback_on_throttle: bool = True,
    force_browser_ua: bool = True,
    patch_requests: bool = True,
    patch_httpx: bool = True,
) -> dict:
    """在应用启动早期调用一次。可重复调用；返回各栈的接线结果。"""
    global _fallback_on_throttle, _force_browser_ua
    with _lock:
        _fallback_on_throttle = fallback_on_throttle
        _force_browser_ua = force_browser_ua
        _prefix_map.clear()
        _prefix_map.update(prefix_map or {})
    report = {"requests": False, "httpx": False, "httpx_async": False}
    if patch_requests:
        report["requests"] = _install_requests()
    if patch_httpx:
        report["httpx"] = _install_httpx()
        report["httpx_async"] = "httpx_async" in _installed
    return report


def uninstall() -> None:
    """回滚：把类方法换回原实现。"""
    if "requests" in _installed:
        import requests  # noqa: PLC0415
        requests.sessions.Session.request = _installed.pop("requests")  # type: ignore[assignment]
    if "httpx" in _installed or "httpx_async" in _installed:
        import httpx  # noqa: PLC0415
        if "httpx" in _installed:
            httpx.Client.request = _installed.pop("httpx")  # type: ignore[assignment]
        if "httpx_async" in _installed:
            httpx.AsyncClient.request = _installed.pop("httpx_async")  # type: ignore[assignment]