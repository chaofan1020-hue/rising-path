"""front_door_shim 离线断言：不联网，全部用假的 HTTP 层验证改写与回落。"""
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests  # noqa: E402

import front_door_shim as shim  # noqa: E402

PASS = 0
FAIL = []


def check(name, condition, detail=""):
    global PASS
    if condition:
        PASS += 1
    else:
        FAIL.append(f"{name} :: {detail}")


class FakeResponse:
    def __init__(self, status_code, payload=b"{}"):
        self.status_code = status_code
        self.content = payload
        self.headers = {}
        self.closed = False

    def close(self):
        self.closed = True


class FakeLayer:
    """记录每次调用，按 url 前缀决定返回码。"""

    def __init__(self, default=200, overrides=None):
        self.calls = []
        self.default = default
        self.overrides = overrides or {}

    def __call__(self, session, method, url, *args, **kwargs):
        self.calls.append({"method": method, "url": url, "headers": kwargs.get("headers")})
        for fragment, status in self.overrides.items():
            if fragment in url:
                return FakeResponse(status)
        return FakeResponse(self.default)


# ---------------------------------------------------------------------------- #
# 纯函数
# ---------------------------------------------------------------------------- #
check("site_prefix:zoom", shim.site_prefix_for("zoom.wd5.myworkdayjobs.com") == "https://wd5.myworkdaysite.com",
      shim.site_prefix_for("zoom.wd5.myworkdayjobs.com"))
check("site_prefix:非 workday", shim.site_prefix_for("jobs.example.com") is None)
check("site_prefix:不在已知 pod", shim.site_prefix_for("x.wd99.myworkdayjobs.com") is None)

LIST = "https://zoom.wd5.myworkdayjobs.com/wday/cxs/zoom/Zoom/jobs"
check("rewrite:列表", shim.rewrite_url(LIST) == "https://wd5.myworkdaysite.com/wday/cxs/zoom/Zoom/jobs",
      shim.rewrite_url(LIST))
DETAIL = "https://zoom.wd5.myworkdayjobs.com/wday/cxs/zoom/Zoom/job/San_Jose/Engineer_R1"
check("rewrite:详情", shim.rewrite_url(DETAIL) == "https://wd5.myworkdaysite.com/wday/cxs/zoom/Zoom/job/San_Jose/Engineer_R1",
      shim.rewrite_url(DETAIL))
HTML = "https://zoom.wd5.myworkdayjobs.com/Zoom/job/San_Jose/Engineer_R1"
check("rewrite:官网页面不动", shim.rewrite_url(HTML) == HTML, shim.rewrite_url(HTML))
check("rewrite:非 workday 不动", shim.rewrite_url("https://api.example.com/wday/cxs/a/b/jobs") == "https://api.example.com/wday/cxs/a/b/jobs")
check("rewrite:未知 pod 不动", shim.rewrite_url("https://x.wd99.myworkdayjobs.com/wday/cxs/x/y/jobs") == "https://x.wd99.myworkdayjobs.com/wday/cxs/x/y/jobs")
check("rewrite:查询串保留",
      shim.rewrite_url(LIST + "?a=1") == "https://wd5.myworkdaysite.com/wday/cxs/zoom/Zoom/jobs?a=1",
      shim.rewrite_url(LIST + "?a=1"))

# ---------------------------------------------------------------------------- #
# requests 接线
# ---------------------------------------------------------------------------- #
original_request = requests.sessions.Session.request
try:
    layer = FakeLayer(default=200)
    requests.sessions.Session.request = layer
    report = shim.install(fallback_on_throttle=True, patch_httpx=False)
    check("install:requests 已接线", report["requests"] is True, str(report))
    check("install:httpx 缺失不报错", report["httpx"] is False, str(report))

    shim.reset_stats()
    session = requests.Session()
    response = session.request("POST", LIST, data=b"{}")
    check("requests:改写后只发一次", len(layer.calls) == 1, str(layer.calls))
    check("requests:发到 site 域", layer.calls[0]["url"] == "https://wd5.myworkdaysite.com/wday/cxs/zoom/Zoom/jobs", layer.calls[0]["url"])
    check("requests:方法保留", layer.calls[0]["method"] == "POST", layer.calls[0]["method"])
    sent = layer.calls[0]["headers"] or {}
    check("requests:补浏览器 UA", str(sent.get("User-Agent", "")).startswith("Mozilla/5.0"), str(sent))
    check("requests:Origin 对齐新门", sent.get("Origin") == "https://wd5.myworkdaysite.com", str(sent))
    check("requests:Referer 对齐新门", sent.get("Referer") == "https://wd5.myworkdaysite.com/", str(sent))
    check("requests:带 Client Hints", sent.get("sec-fetch-site") == "same-origin" and "sec-ch-ua" in sent, str(sent))
    check("requests:返回原对象", response.status_code == 200)
    check("requests:统计 rewritten", shim.stats()["rewritten"] == 1, str(shim.stats()))

    # 调用方自带旧域 Origin/UA 时，必须被新门的值覆盖掉
    layer_old = FakeLayer(default=200)
    requests.sessions.Session.request = layer_old
    shim.install(patch_httpx=False)
    requests.Session().request("POST", LIST, data=b"{}", headers={
        "User-Agent": "GlobalJobsPlatform/1.0",
        "Origin": "https://zoom.wd5.myworkdayjobs.com",
        "Referer": "https://zoom.wd5.myworkdayjobs.com/Zoom",
        "X-Keep-Me": "1",
    })
    replaced = layer_old.calls[0]["headers"] or {}
    check("headers:旧 UA 被覆盖", str(replaced.get("User-Agent", "")).startswith("Mozilla/5.0"), str(replaced))
    check("headers:旧 Origin 被覆盖", replaced.get("Origin") == "https://wd5.myworkdaysite.com", str(replaced))
    check("headers:旧 Referer 被覆盖", replaced.get("Referer") == "https://wd5.myworkdaysite.com/", str(replaced))
    check("headers:业务自定义头保留", replaced.get("X-Keep-Me") == "1", str(replaced))

    requests.sessions.Session.request = layer
    shim.install(patch_httpx=False)
    layer.calls.clear()
    session.request("GET", HTML)
    check("requests:非 CXS 透传", len(layer.calls) == 1 and layer.calls[0]["url"] == HTML, str(layer.calls))

    # 429 -> 回落原 host
    layer2 = FakeLayer(default=200, overrides={"myworkdaysite.com": 429})
    requests.sessions.Session.request = layer2
    shim.install(fallback_on_throttle=True, patch_httpx=False)
    shim.reset_stats()
    result = requests.Session().request("POST", LIST, data=b"{}")
    check("fallback:429 触发回落", len(layer2.calls) == 2, str(layer2.calls))
    check("fallback:先 site 后原 host",
          layer2.calls[0]["url"].startswith("https://wd5.myworkdaysite.com")
          and layer2.calls[1]["url"] == LIST, str(layer2.calls))
    check("fallback:回落不带伪装头", layer2.calls[1]["headers"] is None, str(layer2.calls[1]["headers"]))
    check("fallback:返回原 host 的结果", result.status_code == 200, str(result.status_code))
    check("fallback:统计 fallback", shim.stats()["fallback"] == 1, str(shim.stats()))

    # 404 不回落（下架是事实）
    layer3 = FakeLayer(default=200, overrides={"/wday/cxs/": 404})
    requests.sessions.Session.request = layer3
    shim.install(fallback_on_throttle=True, patch_httpx=False)
    shim.reset_stats()
    missing = requests.Session().request("GET", DETAIL)
    check("fallback:404 不回落", len(layer3.calls) == 1 and missing.status_code == 404, str(layer3.calls))
    check("fallback:404 不加 fallback 计数", shim.stats()["fallback"] == 0, str(shim.stats()))

    # 关闭回落时 429 直接返回
    layer4 = FakeLayer(default=200, overrides={"/wday/cxs/": 429})
    requests.sessions.Session.request = layer4
    shim.install(fallback_on_throttle=False, patch_httpx=False)
    shim.reset_stats()
    throttled = requests.Session().request("POST", LIST, data=b"{}")
    check("fallback:关闭时只发一次", len(layer4.calls) == 1, str(layer4.calls))
    check("fallback:关闭时把 429 交回上层", throttled.status_code == 429)

    # 幂等
    before = requests.sessions.Session.request
    shim.install(patch_httpx=False)
    check("install:可重复调用", requests.sessions.Session.request is before)

    # 自定义 prefix_map（用于本地联调）
    shim.install(prefix_map={"https://zoom.wd5.myworkdayjobs.com": "http://127.0.0.1:9000"}, patch_httpx=False)
    check("prefix_map:覆盖前缀",
          shim.rewrite_url(LIST) == "http://127.0.0.1:9000/wday/cxs/zoom/Zoom/jobs",
          shim.rewrite_url(LIST))
    shim.install(patch_httpx=False)
    check("prefix_map:清空后恢复", shim.rewrite_url(LIST).startswith("https://wd5.myworkdaysite.com"))

    # 卸载
    layer5 = FakeLayer(default=200)
    requests.sessions.Session.request = layer5
    shim.install(patch_httpx=False)
    shim.uninstall()
    layer5.calls.clear()
    # 卸载后类属性就是假层本身（不是函数，不会被绑定），显式传 session 调用。
    requests.sessions.Session.request(requests.Session(), "POST", LIST, data=b"{}")
    check("uninstall:恢复直连", layer5.calls[0]["url"] == LIST, str(layer5.calls))
finally:
    shim.uninstall()
    requests.sessions.Session.request = original_request

print(f"{PASS} checks passed")
if FAIL:
    print("FAILED:")
    for item in FAIL:
        print("  -", item)
    sys.exit(1)