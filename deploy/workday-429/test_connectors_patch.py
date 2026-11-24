#!/usr/bin/env python3
"""connectors_patch 离线自测：用假 transport 走完前门切换，不发外网请求。"""
from __future__ import annotations

import json
import sys
import unittest

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding='utf-8')
    except Exception:  # noqa: BLE001
        pass

from connectors_patch import WorkdayFrontDoorClient
from workday_front_door import WorkdayDoorRouter

HOST = 'zoom.wd5.myworkdayjobs.com'
TENANT, SITE = 'zoom', 'Zoom'
LIST = {'total': 2, 'jobPostings': [{'externalPath': '/job/A/X_R1'}, {'externalPath': '/job/B/Y_R2'}]}
DETAIL = {'jobPostingInfo': {'title': 'Engineer', 'jobDescription': '<p>hi</p>'}}
CHALLENGE = b'<html>cf-mitigated challenge</html>'


class FakeTransport:
    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.calls = []

    def __call__(self, url, method, body, headers, timeout):
        host = url.split('/')[2]
        self.calls.append((method, host, url))
        status, hdrs, payload = self.behaviour(host, url, body)
        if isinstance(payload, bytes):
            return status, hdrs, payload
        return status, hdrs, json.dumps(payload).encode()

    def hosts(self):
        return [c[1] for c in self.calls]


class ClientTest(unittest.TestCase):
    def test_list_fails_over_immediately(self):
        """第一次 429 就该换门，不该在同一条死门上重试三次。"""

        def behaviour(host, url, body):
            if host == 'wd5.myworkdaysite.com':
                return 429, {'cf-mitigated': 'challenge'}, CHALLENGE
            return 200, {}, LIST

        fake = FakeTransport(behaviour)
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        payload, door = client.list_page(tenant=TENANT, site=SITE, host=HOST)
        self.assertEqual(door, 'zoom.wd5.myworkdayjobs.com')
        self.assertEqual(payload['total'], 2)
        self.assertEqual(fake.hosts(), ['wd5.myworkdaysite.com', 'zoom.wd5.myworkdayjobs.com'])
        self.assertEqual(client.stats['failover'], 1)

    def test_primary_wins_when_healthy(self):
        def behaviour(host, url, body):
            return 200, {}, LIST

        fake = FakeTransport(behaviour)
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        _payload, door = client.list_page(tenant=TENANT, site=SITE, host=HOST)
        self.assertEqual(door, 'wd5.myworkdaysite.com')
        self.assertEqual(len(fake.calls), 1)

    def test_detail_uses_get_and_front_door(self):
        def behaviour(host, url, body):
            return 200, {}, DETAIL

        fake = FakeTransport(behaviour)
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        payload, _door = client.detail(tenant=TENANT, site=SITE, host=HOST, external_path='/job/A/X_R1')
        self.assertEqual(payload['jobPostingInfo']['title'], 'Engineer')
        method, host, url = fake.calls[-1]
        self.assertEqual(method, 'GET')
        self.assertEqual(host, 'wd5.myworkdaysite.com')
        self.assertTrue(url.endswith('/wday/cxs/zoom/Zoom/job/A/X_R1'))

    def test_blocked_is_not_washed_into_a_fake_200(self):
        fake = FakeTransport(lambda host, url, body: (403, {}, b'{"errorCode":"S22"}'))
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        payload, _door = client.list_page(tenant=TENANT, site=SITE, host=HOST)
        self.assertIsNone(payload)
        self.assertEqual(len(fake.calls), 1)

    def test_all_doors_throttled_raises_instead_of_returning_empty(self):
        fake = FakeTransport(lambda host, url, body: (429, {'cf-mitigated': 'challenge'}, CHALLENGE))
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        with self.assertRaises(RuntimeError):
            client.crawl_all(tenant=TENANT, site=SITE, host=HOST)
        # 三条前门各试一次就收手，不无限撞
        self.assertEqual(len(fake.calls), 3)

    def test_crawl_all_paginates(self):
        offsets = []

        def behaviour(host, url, body):
            offset = json.loads(body)['offset']
            offsets.append(offset)
            rows = [{'externalPath': f'/job/A/R{offset + i}'} for i in range(2)]
            return 200, {}, {'total': 5, 'jobPostings': rows}

        fake = FakeTransport(behaviour)
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        jobs, total = client.crawl_all(tenant=TENANT, site=SITE, host=HOST, page_size=2)
        self.assertEqual(total, 5)
        self.assertEqual(offsets, [0, 2, 4])
        self.assertEqual(len(jobs), 6)

    def test_crawl_all_survives_zero_total_on_later_pages(self):
        """实测坑：offset>0 时 total 报 0。不能因此把 69 条截成 40 条。"""
        sizes = {0: 20, 20: 20, 40: 20, 60: 9}
        offsets = []

        def behaviour(host, url, body):
            offset = json.loads(body)['offset']
            offsets.append(offset)
            count = sizes.get(offset, 0)
            rows = [{'externalPath': f'/job/A/R{offset + i}'} for i in range(count)]
            total = 69 if offset == 0 else 0
            return 200, {}, {'total': total, 'jobPostings': rows}

        fake = FakeTransport(behaviour)
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        jobs, total = client.crawl_all(tenant=TENANT, site=SITE, host=HOST, page_size=20)
        self.assertEqual(total, 69)
        self.assertEqual(offsets, [0, 20, 40, 60])
        self.assertEqual(len(jobs), 69)

    def test_crawl_all_drops_recycled_page(self):
        """越界时 Workday 复读首页，重复页必须丢掉，不能重复计数。"""

        def behaviour(host, url, body):
            offset = json.loads(body)['offset']
            rows = [{'externalPath': f'/job/A/R{i}'} for i in range(2)]
            return 200, {}, {'total': 10, 'jobPostings': rows}

        fake = FakeTransport(behaviour)
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        jobs, total = client.crawl_all(tenant=TENANT, site=SITE, host=HOST, page_size=2)
        self.assertEqual(total, 10)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(len(fake.calls), 2)

    def test_front_door_health_survives_between_requests(self):
        """跨请求的累计健康度：连续三轮单次失败后，第一条前门被永久降级。"""
        state = {'hit': 0}

        def behaviour(host, url, body):
            if host == 'wd5.myworkdaysite.com':
                return 429, {}, CHALLENGE
            return 200, {}, LIST

        fake = FakeTransport(behaviour)
        client = WorkdayFrontDoorClient(fake, router=WorkdayDoorRouter())
        for _ in range(3):
            state['hit'] += 1
            payload, _door = client.list_page(tenant=TENANT, site=SITE, host=HOST)
            self.assertIsNotNone(payload)
        # 第 4 轮起直接从第二道门开始，不再先撞一次死门
        _payload, door = client.list_page(tenant=TENANT, site=SITE, host=HOST)
        self.assertEqual(door, 'zoom.wd5.myworkdayjobs.com')
        self.assertEqual(fake.hosts()[-1], 'zoom.wd5.myworkdayjobs.com')


if __name__ == '__main__':
    unittest.main(verbosity=2)