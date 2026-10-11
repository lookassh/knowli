import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from unittest.mock import AsyncMock

import httpx

from umiem_mcp.client import AdapterError, OverviewClient
from umiem_mcp.config import load_config
from umiem_mcp.validation import ContractError, validate_overview, verify_contract_bundle


ROOT = Path(__file__).parent


class ConfigTests(unittest.TestCase):
    def test_requires_https_absolute_private_token_file_and_rejects_url_credentials_query(self):
        with tempfile.TemporaryDirectory() as temp:
            token_path = Path(temp) / "token"
            token_path.write_text("synthetic-token", encoding="utf-8")
            if os.name != "nt":
                token_path.chmod(0o600)
            config = load_config({"UMIEM_BASE_URL": "https://umiem.example", "UMIEM_READ_TOKEN_FILE": str(token_path)})
            self.assertEqual(config.base_url, "https://umiem.example")
            self.assertEqual(config.read_token(), "synthetic-token")
            if os.name != "nt":
                token_path.chmod(0o644)
                with self.assertRaises(ValueError):
                    config.read_token()
            for url in ("http://umiem.example", "https://u:p@umiem.example", "https://umiem.example/?x=1", "https://umiem.example/#f"):
                with self.subTest(url=url), self.assertRaises(ValueError):
                    load_config({"UMIEM_BASE_URL": url, "UMIEM_READ_TOKEN_FILE": str(token_path)})

    def test_loopback_http_is_allowed_only_for_explicit_tests(self):
        with tempfile.TemporaryDirectory() as temp:
            env = {"UMIEM_BASE_URL": "http://127.0.0.1:8123", "UMIEM_READ_TOKEN_FILE": str(Path(temp) / "token")}
            with self.assertRaises(ValueError):
                load_config(env)
            self.assertEqual(load_config(env, test_mode=True).base_url, env["UMIEM_BASE_URL"])


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / "fixtures/learning-overview.example.json").read_text(encoding="utf-8"))

    def test_accepts_versioned_fixture_and_preserves_estimated_seconds(self):
        result = validate_overview(self.payload)
        self.assertEqual(result["children"][0]["learningTime"], {"seconds": 1980, "estimated": True})
        self.assertEqual(result["children"][0]["dailyActivity"][2]["learningTime"]["seconds"], 1380)

    def test_mock_test_skips_and_unassessed_are_subsets_of_not_tested(self):
        candidate = json.loads(json.dumps(self.payload))
        candidate["children"][0]["dailyActivity"][0]["mockTests"].append({
            "sessionId": "55555555-5555-4555-8555-555555555555",
            "deckId": "22222222-2222-4222-8222-222222222222",
            "deckVersionId": "33333333-3333-4333-8333-333333333333",
            "deckTitle": "Dni tygodnia", "deckVersionNumber": 2,
            "endedAt": "2026-10-09T17:00:00.000Z", "complete": True, "taskBudget": 4,
            "skills": [{"skill": "recall", "totalItems": 7, "independentCorrect": 2,
                        "practiceNeeded": 1, "correctNotIndependent": 0, "notTested": 4,
                        "skipped": 1, "unassessed": 1}],
        })
        skill = candidate["children"][0]["dailyActivity"][0]["mockTests"][0]["skills"][0]
        skill.update(totalItems=7, independentCorrect=2, practiceNeeded=1,
                     correctNotIndependent=0, notTested=4, skipped=1, unassessed=1)
        self.assertEqual(validate_overview(candidate), candidate)
        skill["skipped"] = 3
        skill["unassessed"] = 2
        with self.assertRaises(ContractError):
            validate_overview(candidate)

    def test_rejects_incompatible_or_semantically_inconsistent_data(self):
        mutations = []
        version = json.loads(json.dumps(self.payload)); version["schemaVersion"] = 2; mutations.append(version)
        missing_day = json.loads(json.dumps(self.payload)); missing_day["children"][0]["dailyActivity"].pop(1); mutations.append(missing_day)
        total = json.loads(json.dumps(self.payload)); total["children"][0]["learningTime"]["seconds"] = 1381; mutations.append(total)
        null_total = json.loads(json.dumps(self.payload)); null_total["children"][0]["dailyActivity"][1]["learningTime"]["seconds"] = None; mutations.append(null_total)
        duplicate = json.loads(json.dumps(self.payload)); duplicate["children"].append(duplicate["children"][0]); mutations.append(duplicate)
        fractional = json.loads(json.dumps(self.payload)); fractional["children"][0]["learningTime"]["seconds"] = 1.5; mutations.append(fractional)
        denominator = json.loads(json.dumps(self.payload)); denominator["children"][0]["currentProgress"][0]["skills"][2]["practicing"] = 3; mutations.append(denominator)
        days_until = json.loads(json.dumps(self.payload)); days_until["children"][0]["plannedTests"][0]["daysUntil"] = 5; mutations.append(days_until)
        mock_test = json.loads(json.dumps(self.payload))
        mock_test["children"][0]["dailyActivity"][0]["mockTests"].append({
            "sessionId": "55555555-5555-4555-8555-555555555555", "deckId": "22222222-2222-4222-8222-222222222222",
            "deckVersionId": "33333333-3333-4333-8333-333333333333", "deckTitle": "Dni tygodnia", "deckVersionNumber": 2,
            "endedAt": "2026-10-09T17:00:00.000Z", "complete": True, "taskBudget": 4,
            "skills": [{"skill": "recall", "totalItems": 7, "independentCorrect": 2, "practiceNeeded": 1,
                        "correctNotIndependent": 0, "notTested": 4, "skipped": 0, "unassessed": 0}],
        })
        mock_test["children"][0]["dailyActivity"][0]["mockTests"][0]["skills"][0]["notTested"] = 3
        mutations.append(mock_test)
        for candidate in mutations:
            with self.subTest(candidate=candidate), self.assertRaises(ContractError):
                validate_overview(candidate)

    def test_rejects_oversized_response(self):
        with self.assertRaises(ContractError) as caught:
            validate_overview(self.payload, raw_size=2 * 1024 * 1024 + 1)
        self.assertEqual(caught.exception.code, "learning_summary_too_large")

    def test_refuses_a_missing_or_changed_contract_artifact(self):
        self.assertTrue(verify_contract_bundle(ROOT.parent))
        api_schema = ROOT.parents[2] / "docs/integrations/learning-overview.schema.json"
        if api_schema.is_file():
            self.assertEqual((ROOT.parent / "src/umiem_mcp/learning-overview.schema.json").read_bytes(), api_schema.read_bytes())
        with tempfile.TemporaryDirectory() as temp:
            copied = Path(temp)
            (copied / "src/umiem_mcp").mkdir(parents=True)
            (copied / "skills/umiem-learning").mkdir(parents=True)
            for rel in ("src/umiem_mcp/learning-overview.schema.json", "src/umiem_mcp/contract-manifest.json", "skills/umiem-learning/SKILL.md"):
                source = ROOT.parent / rel
                if source.exists():
                    (copied / rel).write_bytes(source.read_bytes())
            (copied / "src/umiem_mcp/learning-overview.schema.json").write_text("{}", encoding="utf-8")
            self.assertFalse(verify_contract_bundle(copied))


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_sends_fixed_endpoint_and_bearer_and_retries_only_transient_error_once(self):
        calls = []
        payload = json.loads((ROOT / "fixtures/learning-overview.example.json").read_text(encoding="utf-8"))
        async def handler(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(503, text="private body")
            return httpx.Response(200, json=payload)
        sleeps = []
        client = OverviewClient(
            base_url="https://umiem.example", token_reader=lambda: "synthetic-secret",
            transport=httpx.MockTransport(handler), sleep=lambda delay: sleeps.append(delay) or asyncio.sleep(0),
        )
        result = await client.get_overview()
        self.assertEqual(result, payload)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0].url.path, "/api/v1/integrations/learning-overview")
        self.assertEqual(dict(calls[0].url.params), {"days": "7", "upcomingTestDays": "14"})
        self.assertEqual(calls[0].headers["authorization"], "Bearer synthetic-secret")
        self.assertNotIn("synthetic-secret", repr(result))

    async def test_does_not_follow_redirects_or_retry_auth_errors_and_bounds_rate_limit_wait(self):
        calls = []
        async def handler(request):
            calls.append(request)
            return httpx.Response(302, headers={"location": "https://attacker.example/"})
        client = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "secret", transport=httpx.MockTransport(handler))
        with self.assertRaises(Exception) as caught:
            await client.get_overview()
        self.assertEqual(len(calls), 1)
        self.assertNotIn("secret", str(caught.exception))

        delays = []
        async def throttle(_request):
            return httpx.Response(429, headers={"retry-after": "40"}, json={"code": "rate_limited"})
        rate_limited = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "secret", transport=httpx.MockTransport(throttle), sleep=lambda d: delays.append(d) or asyncio.sleep(0))
        with self.assertRaises(Exception):
            await rate_limited.get_overview()
        self.assertLessEqual(sum(delays), 25)

    async def test_rejects_boolean_and_malformed_child_id_without_http(self):
        calls = []
        async def handler(request):
            calls.append(request)
            return httpx.Response(500)
        client = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "secret", transport=httpx.MockTransport(handler))
        for kwargs in ({"days": True}, {"days": None}, {"child_id": "not-a-uuid"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(Exception):
                await client.get_overview(**kwargs)
        self.assertEqual(calls, [])

    async def test_stops_after_two_attempts_and_rejects_an_oversized_stream(self):
        failures = []
        async def unavailable(_request):
            failures.append(1)
            return httpx.Response(503)
        client = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "secret", transport=httpx.MockTransport(unavailable), sleep=lambda _delay: asyncio.sleep(0))
        with self.assertRaises(Exception):
            await client.get_overview(days=3)
        self.assertEqual(len(failures), 2)

        async def too_large(_request):
            return httpx.Response(200, content=b" " * (2 * 1024 * 1024 + 1))
        limited = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "secret", transport=httpx.MockTransport(too_large))
        with self.assertRaises(Exception) as caught:
            await limited.get_overview(days=3)
        self.assertEqual(caught.exception.code, "learning_summary_too_large")

    async def test_attempt_deadline_stops_a_slow_drip_before_total_deadline(self):
        payload = json.dumps(json.loads((ROOT / "fixtures/learning-overview.example.json").read_text(encoding="utf-8"))).encode()
        calls = []

        class SlowDrip(httpx.AsyncByteStream):
            async def __aiter__(self):
                for offset in range(0, len(payload), 32):
                    await asyncio.sleep(0.01)
                    yield payload[offset:offset + 32]

            async def aclose(self):
                return None

        async def handler(_request):
            calls.append(1)
            return httpx.Response(200, stream=SlowDrip())

        client = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "secret",
                                 transport=httpx.MockTransport(handler), total_timeout=0.5, attempt_timeout=0.04)
        started = asyncio.get_running_loop().time()
        with self.assertRaises(AdapterError) as caught:
            await client.get_overview()
        elapsed = asyncio.get_running_loop().time() - started
        self.assertEqual(caught.exception.code, "learning_summary_unavailable")
        self.assertEqual(len(calls), 2)
        self.assertLess(elapsed, 0.2)

    async def test_retries_short_retry_after_and_http_date_inside_total_budget(self):
        payload = json.loads((ROOT / "fixtures/learning-overview.example.json").read_text(encoding="utf-8"))
        for retry_value in ("1", format_datetime(datetime.now(timezone.utc) + timedelta(seconds=1), usegmt=True)):
            calls = []
            delays = []
            async def handler(_request):
                calls.append(1)
                if len(calls) == 1:
                    return httpx.Response(429, headers={"retry-after": retry_value})
                return httpx.Response(200, json=payload)
            client = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "token", transport=httpx.MockTransport(handler), sleep=lambda delay: delays.append(delay) or asyncio.sleep(0))
            result = await client.get_overview(days=3)
            self.assertEqual(result["schemaVersion"], 1)
            self.assertEqual(len(calls), 2)
            self.assertEqual(len(delays), 1)

    async def test_retries_a_transport_timeout_only_once(self):
        calls = []
        payload = json.loads((ROOT / "fixtures/learning-overview.example.json").read_text(encoding="utf-8"))
        async def handler(_request):
            calls.append(1)
            if len(calls) == 1:
                raise httpx.ReadTimeout("secret transport text")
            return httpx.Response(200, json=payload)
        client = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "token", transport=httpx.MockTransport(handler))
        self.assertEqual((await client.get_overview(days=3))["schemaVersion"], 1)
        self.assertEqual(len(calls), 2)

    async def test_auth_not_found_and_bad_request_errors_are_never_retried(self):
        for status in (400, 401, 403, 404):
            calls = []
            async def handler(_request):
                calls.append(1)
                return httpx.Response(status, json={"message": "secret body"})
            client = OverviewClient(base_url="https://umiem.example", token_reader=lambda: "secret-token", transport=httpx.MockTransport(handler))
            with self.subTest(status=status), self.assertRaises(Exception) as caught:
                await client.get_overview(days=3)
            self.assertEqual(len(calls), 1)
            self.assertNotIn("secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
