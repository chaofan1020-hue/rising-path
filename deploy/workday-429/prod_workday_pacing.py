import asyncio
import math
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit, urlunsplit

import httpx
from redis import Redis
from redis.asyncio import Redis as AsyncRedis

from app.config import get_settings

COOLDOWN_KEY = 'global_jobs:workday:cooldown'
REQUEST_SLOT_KEY = 'global_jobs:workday:request-slot'
DEFAULT_COOLDOWN_SECONDS = 3600
REQUEST_INTERVAL_MS = 1000

# --- Workday 前门（2026-11-19）------------------------------------------------
# *.myworkdayjobs.com 的 CXS 端点被 Cloudflare 以 `cf-mitigated: challenge` 回 429，
# 这不是速率上限；同一 tenant/site 的同一份 CXS 契约在 {wdN}.myworkdaysite.com
# （另一个 CF zone）上是 200。这里只改「请求往哪个域发」，canonical URL、
# 入库链接、connector_config、connector 逻辑一律不动。
FRONT_DOOR_PODS = frozenset({
    'wd1', 'wd3', 'wd5', 'wd10', 'wd12', 'wd103',
    'wd105', 'wd108', 'wd115', 'wd120',
    'wd501', 'wd502', 'wd503', 'wd504',
})
FRONT_DOOR_HOST_RE = re.compile(r'^[a-z0-9-]+\.(?P<wd>wd\d+)\.myworkdayjobs\.com$', re.I)
FRONT_DOOR_CXS = '/wday/cxs/'
# 前门回这些码就退回原 host，行为与今天一致；404/410 是官网撤下，不回落。
FRONT_DOOR_FALLBACK_CODES = frozenset({403, 429, 503})


def front_door_url(url: str) -> str | None:
    """`{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/...` -> `{wdN}.myworkdaysite.com/...`。"""
    parts = urlsplit(url)
    if FRONT_DOOR_CXS not in parts.path:
        return None
    match = FRONT_DOOR_HOST_RE.match(parts.hostname or '')
    if not match:
        return None
    wd = match.group('wd').lower()
    if wd not in FRONT_DOOR_PODS:
        return None
    return urlunsplit((parts.scheme, f'{wd}.myworkdaysite.com', parts.path, parts.query, parts.fragment))

# 伪装成浏览器的同源 XHR。生产实测：不改这些头时，新门在每天晚上 16:30 / 19:00
# 前后仍会被 Cloudflare 挑战一阵（UA 是 GlobalJobsPlatform/1.0，Origin/Referer
# 还指着旧域名，两个信号都在自报"我是脚本"）。
FRONT_DOOR_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
)
FRONT_DOOR_BROWSER_HEADERS = {
    'User-Agent': FRONT_DOOR_UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
}
BROWSER_HEADER_KEYS = frozenset(key.lower() for key in FRONT_DOOR_BROWSER_HEADERS) | {
    'origin', 'referer',
}


def front_door_headers(target_url: str, base: dict | None = None) -> dict:
    """把请求头对齐到新门：浏览器 UA + Client Hints，Origin/Referer 用新门自己的。"""
    parts = urlsplit(target_url)
    origin = f'{parts.scheme}://{parts.netloc}'
    headers = {k: v for k, v in (base or {}).items() if k.lower() not in BROWSER_HEADER_KEYS}
    headers.update(FRONT_DOOR_BROWSER_HEADERS)
    headers['Origin'] = origin
    headers['Referer'] = origin + '/'
    return headers


# 换 TLS 指纹这一手：httpx 的 JA3 和 HTTP/1.1 都是明显的非浏览器信号（实测
# ja3=06873b56…、HTTP/1.1、无 HTTP/2 akamai 指纹），只改 UA 补不上。curl_cffi
# 复刻 Chrome 的握手（实测 ja3=1412e77b…、h2 有 akamai 指纹）。只在 httpx 被
# 挑战时启用，正常路径一点没变；库装不上就自动跳过。
FRONT_DOOR_IMPERSONATE = 'chrome'


async def fetch_with_browser_tls(method: str, url: str, **kwargs) -> httpx.Response | None:
    """用 curl_cffi 复刻 Chrome 指纹重发一次，返回与 httpx.Response 同形的对象。"""
    try:
        from curl_cffi import requests as curl_requests  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return None

    payload = kwargs.get('json')
    headers = dict(kwargs.get('headers') or {})

    def _run():
        with curl_requests.Session(impersonate=FRONT_DOOR_IMPERSONATE) as session:
            return session.request(method, url, json=payload, headers=headers, timeout=30)

    try:
        raw = await asyncio.to_thread(_run)
    except Exception:  # noqa: BLE001
        return None
    try:
        # curl_cffi 已经把 gzip 解掉了，如果再把 Content-Encoding/Content-Length
        # 一并塞给 httpx.Response，它会在 content= 上二次解压然后炸 DecodingError。
        dropped = {'content-encoding', 'content-length', 'transfer-encoding'}
        headers = {k: v for k, v in dict(raw.headers).items() if k.lower() not in dropped}
        return httpx.Response(
            status_code=raw.status_code,
            headers=headers,
            content=raw.content,
            request=httpx.Request(method, url),
        )
    except Exception:  # noqa: BLE001
        return None


ACQUIRE_SLOT = '''
if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
if redis.call('SET', KEYS[2], '1', 'NX', 'PX', ARGV[1]) then return 1 end
return 0
'''

EXTEND_COOLDOWN = '''
if redis.call('TTL', KEYS[1]) < tonumber(ARGV[1]) then
    redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
end
'''


class WorkdayCooldown(RuntimeError):
    pass


def workday_is_paused() -> bool:
    with Redis.from_url(get_settings().redis_url, socket_timeout=2) as redis:
        return bool(redis.exists(COOLDOWN_KEY))


def cooldown_seconds(retry_after: str | None) -> int:
    if not retry_after:
        return DEFAULT_COOLDOWN_SECONDS
    try:
        seconds = int(retry_after)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(retry_after)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            seconds = math.ceil((retry_at - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return DEFAULT_COOLDOWN_SECONDS
    return max(DEFAULT_COOLDOWN_SECONDS, seconds)


async def paced_workday_request(
    client: httpx.AsyncClient, method: str, url: str, **kwargs,
) -> httpx.Response:
    async with AsyncRedis.from_url(get_settings().redis_url, socket_timeout=2) as redis:
        while True:
            slot = await redis.eval(ACQUIRE_SLOT, 2, COOLDOWN_KEY, REQUEST_SLOT_KEY, REQUEST_INTERVAL_MS)
            if slot == -1:
                raise WorkdayCooldown('Workday request deferred during rate-limit cooldown')
            if slot == 1:
                break
            await asyncio.sleep(0.25)
        primary = front_door_url(url)
        caller_headers = kwargs.get('headers')
        if primary:
            kwargs = {**kwargs, 'headers': front_door_headers(primary, caller_headers)}
        response = await client.request(method, primary or url, **kwargs)
        if primary and response.status_code in FRONT_DOOR_FALLBACK_CODES:
            # 第二手：同一道门，换 TLS/HTTP2 指纹重发一次（httpx 的指纹不是浏览器）
            retry = await fetch_with_browser_tls(method, primary, **kwargs)
            if retry is not None and retry.status_code == 200:
                response = retry
        if primary and response.status_code in FRONT_DOOR_FALLBACK_CODES:
            # 前门不可用时退回原 host：伪装的请求头一并撤掉，403 不会被洗成 200，
            # 429 的冷却语义也不变。
            fallback_kwargs = {k: v for k, v in kwargs.items() if k != 'headers'}
            if caller_headers is not None:
                fallback_kwargs['headers'] = caller_headers
            response = await client.request(method, url, **fallback_kwargs)
        if response.status_code == 429:
            duration = cooldown_seconds(response.headers.get('Retry-After'))
            await redis.eval(EXTEND_COOLDOWN, 1, COOLDOWN_KEY, duration)
            raise WorkdayCooldown(f'Workday returned HTTP 429 Too Many Requests. Cooldown {duration}s.')
        return response
