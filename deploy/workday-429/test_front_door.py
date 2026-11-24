#!/usr/bin/env python3
"""workday_front_door 逻辑自测：不发任何外网请求。"""
from __future__ import annotations

import sys
import unittest

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding='utf-8')
    except Exception:  # noqa: BLE001
        pass

from workday_front_door import (
    BLOCKED,
    COOLDOWN_BASE,
    GONE,
    OK,
    THROTTLED,
    WorkdayDoorRouter,
    build_detail_url,
    build_list_url,
    canonical_job_url,
    classify,
    door_candidates,
    ordered_hosts_by_tenant,
    should_fetch_next_page,
    split_workday_host,
)


class Clock:
    def __init__(self, t: float = 0.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


class SplitTest(unittest.TestCase):
    def test_split(self):
        self.assertEqual(split_workday_host('zoom.wd5.myworkdayjobs.com'), ('zoom', 'wd5'))
        self.assertEqual(split_workday_host('accenture.wd103.myworkdayjobs.com'), ('accenture', 'wd103'))
        self.assertEqual(split_workday_host('ghr.wd1.myworkdayjobs.com'), ('ghr', 'wd1'))

    def test_non_workday(self):
        for host in ('wd5.myworkdaysite.com', 'example.com', '', 'zoom.wd5.myworkdaysite.com'):
            self.assertIsNone(split_workday_host(host), host)


class CandidateTest(unittest.TestCase):
    def test_shared_pod_first(self):
        doors = door_candidates('zoom.wd5.myworkdayjobs.com')
        self.assertEqual([d[1] for d in doors], [
            'wd5.myworkdaysite.com',
            'zoom.wd5.myworkdayjobs.com',
            'zoom.wd5.myworkdaysite.com',
        ])
        self.assertEqual(doors[0][0], 'myworkdaysite-shared')

    def test_unknown_pod_skips_shared(self):
        # wd99 不在实测存在的 pod 列表里，不能瞎拼一个 DNS 打不通的域名上去
        doors = door_candidates('acme.wd99.myworkdayjobs.com')
        self.assertEqual([d[1] for d in doors], ['acme.wd99.myworkdayjobs.com', 'acme.wd99.myworkdaysite.com'])

    def test_non_workday_passthrough(self):
        self.assertEqual(door_candidates('example.com'), [('as-given', 'example.com')])

    def test_build_urls(self):
        self.assertEqual(
            build_list_url('wd5.myworkdaysite.com', 'zoom', 'Zoom'),
            'https://wd5.myworkdaysite.com/wday/cxs/zoom/Zoom/jobs',
        )
        # externalPath 带不带 /job 前缀都要能拼对
        for path in ('/job/Hyderabad/X_R1', '/Hyderabad/X_R1', 'Hyderabad/X_R1'):
            self.assertEqual(
                build_detail_url('wd5.myworkdaysite.com', 'zoom', 'Zoom', path),
                'https://wd5.myworkdaysite.com/wday/cxs/zoom/Zoom/job/Hyderabad/X_R1',
                path,
            )

    def test_canonical_url_never_uses_front_door(self):
        # 对外/入库链接必须留在官方 jobs 域，前门只用于取数
        self.assertEqual(
            canonical_job_url('zoom.wd5.myworkdayjobs.com', 'Zoom', '/job/Hyderabad/X_R1'),
            'https://zoom.wd5.myworkdayjobs.com/Zoom/job/Hyderabad/X_R1',
        )
        self.assertNotIn('myworkdaysite', canonical_job_url('zoom.wd5.myworkdayjobs.com', 'Zoom', '/job/x/y'))

    def test_ordered_hosts_by_tenant(self):
        out = ordered_hosts_by_tenant(['zoom.wd5.myworkdayjobs.com', 'ghr.wd1.myworkdayjobs.com', 'example.com'])
        self.assertIn(('zoom', 'wd5'), out)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[('ghr', 'wd1')][0], 'wd1.myworkdaysite.com')


class ClassifyTest(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(classify(200), OK)
        self.assertEqual(classify(429, mitigated='challenge'), THROTTLED)
        self.assertEqual(classify(503), THROTTLED)
        self.assertEqual(classify(403, 'errorCode S22'), BLOCKED)
        self.assertEqual(classify(500), 'error')
        self.assertEqual(classify(0), 'error')

    def test_gone_only_for_pulling(self):
        self.assertEqual(classify(404), GONE)
        self.assertEqual(classify(410), GONE)
        # 429 不能被当成撤下：事故里最怕的就是限流把岗位误关
        self.assertNotEqual(classify(429), GONE)

    def test_challenge_header_on_200_is_still_ok(self):
        # 200 带 body 就是数据，别因为残留 header 把它当限流重试
        self.assertEqual(classify(200, mitigated='challenge'), OK)


class RouterTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock(1000.0)
        self.router = WorkdayDoorRouter(rate_per_door=4.0, burst=8.0, clock=self.clock)
        self.host = 'zoom.wd5.myworkdayjobs.com'

    def test_primary_door_first(self):
        self.assertEqual(self.router.acquire(self.host), 'wd5.myworkdaysite.com')

    def test_three_strikes_demote(self):
        for _ in range(3):
            self.router.note('wd5.myworkdaysite.com', 429, mitigated='challenge')
        self.assertEqual(self.router.acquire(self.host), 'zoom.wd5.myworkdayjobs.com')

    def test_success_resets_strikes(self):
        self.router.note('wd5.myworkdaysite.com', 429)
        self.router.note('wd5.myworkdaysite.com', 429)
        self.router.note('wd5.myworkdaysite.com', 200)
        self.router.note('wd5.myworkdaysite.com', 429)
        self.router.note('wd5.myworkdaysite.com', 429)
        # 中间成功过一次，连挂清零，只有 2 次连挂，不该降级
        self.assertEqual(self.router.acquire(self.host), 'wd5.myworkdaysite.com')

    def test_token_bucket_drains_then_waits(self):
        seen = [self.router.acquire(self.host) for _ in range(8)]
        self.assertTrue(all(h == 'wd5.myworkdaysite.com' for h in seen))
        # 额度耗尽：非阻塞拿不到，且不往次先前门乱挤
        self.assertIsNone(self.router.acquire(self.host, blocking=False))
        self.clock.advance(0.25)
        self.assertEqual(self.router.acquire(self.host, blocking=False), 'wd5.myworkdaysite.com')

    def test_all_doors_cooling_returns_none(self):
        for door_id, door_host in door_candidates(self.host):
            for _ in range(3):
                self.router.note(door_host, 429)
        self.assertIsNone(self.router.acquire(self.host))

    def test_cooldown_expires(self):
        for _ in range(3):
            self.router.note('wd5.myworkdaysite.com', 429)
        self.clock.advance(COOLDOWN_BASE + 1)
        self.assertEqual(self.router.acquire(self.host), 'wd5.myworkdaysite.com')

    def test_snapshot_reports_cooldown(self):
        self.router.acquire(self.host)
        for _ in range(3):
            self.router.note('wd5.myworkdaysite.com', 429)
        snap = {row['host']: row for row in self.router.snapshot()}
        self.assertGreater(snap['wd5.myworkdaysite.com']['cooling_for'], 0)
        self.assertEqual(snap['zoom.wd5.myworkdayjobs.com']['cooling_for'], 0)


class PaginationTest(unittest.TestCase):
    """offset>0 时 Workday 会把 total 报成 0；终止判定不能信它。"""

    def test_full_page_with_unknown_total_continues(self):
        self.assertTrue(should_fetch_next_page(
            total=None, page_paths=['a', 'b'], page_size=2, offset=2, seen_paths=set()))

    def test_zero_total_on_later_page_does_not_stop(self):
        # 实测：第 2 页 total=0。若拿它当终止条件，69 条会被截成 40 条。
        self.assertTrue(should_fetch_next_page(
            total=69, page_paths=['c', 'd'], page_size=2, offset=4, seen_paths={'a', 'b'}))

    def test_short_page_stops(self):
        self.assertFalse(should_fetch_next_page(
            total=69, page_paths=['y', 'z'], page_size=5, offset=70, seen_paths={'a'}))

    def test_empty_page_stops(self):
        self.assertFalse(should_fetch_next_page(
            total=69, page_paths=[], page_size=20, offset=80, seen_paths=set()))

    def test_recycled_page_stops(self):
        # 越界时 Workday 把首页再吐一遍：出现重复路径就必须停，不能重复计数。
        self.assertFalse(should_fetch_next_page(
            total=69, page_paths=['a', 'b'], page_size=2, offset=70, seen_paths={'a', 'b'}))

    def test_total_reached_stops(self):
        self.assertFalse(should_fetch_next_page(
            total=4, page_paths=['c', 'd'], page_size=2, offset=4, seen_paths={'a', 'b'}))


if __name__ == '__main__':
    unittest.main(verbosity=2)