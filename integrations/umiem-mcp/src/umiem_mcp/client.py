import asyncio
import email.utils
import json
import time
from datetime import datetime, timezone
from uuid import UUID
from typing import Awaitable, Callable
from urllib.parse import urljoin

import httpx

from .validation import MAX_RESPONSE_BYTES, ContractError, validate_overview


class AdapterError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            parsed = email.utils.parsedate_to_datetime(value)
            return max(0.0, (parsed - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


class OverviewClient:
    def __init__(
        self,
        *,
        base_url: str,
        token_reader: Callable[[], str],
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        total_timeout: float = 25.0,
        attempt_timeout: float = 10.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.token_reader = token_reader
        self.transport = transport
        self.sleep = sleep
        self.monotonic = monotonic
        self.total_timeout = total_timeout
        self.attempt_timeout = attempt_timeout

    async def get_overview(self, days: int = 7, upcoming_test_days: int = 14, child_id: str | None = None) -> dict:
        if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 31:
            raise AdapterError("invalid_arguments", "days must be an integer from 1 to 31")
        if isinstance(upcoming_test_days, bool) or not isinstance(upcoming_test_days, int) or not 1 <= upcoming_test_days <= 90:
            raise AdapterError("invalid_arguments", "upcomingTestDays must be an integer from 1 to 90")
        if child_id is not None:
            try:
                if not isinstance(child_id, str) or str(UUID(child_id)) != child_id.lower():
                    raise ValueError
            except (ValueError, AttributeError):
                raise AdapterError("invalid_arguments", "childId must be a child UUID") from None

        params = {"days": days, "upcomingTestDays": upcoming_test_days}
        if child_id is not None:
            params["childId"] = child_id
        endpoint = urljoin(self.base_url + "/", "api/v1/integrations/learning-overview")
        started = self.monotonic()
        deadline = started + self.total_timeout
        token = self.token_reader()
        if not token or "\r" in token or "\n" in token:
            raise AdapterError("learning_summary_unavailable", "Learning summary is unavailable", True)

        for attempt in range(2):
            remaining = deadline - self.monotonic()
            if remaining <= 0:
                break
            try:
                attempt_budget = min(self.attempt_timeout, remaining)
                timeout = httpx.Timeout(attempt_budget)
                retry_delay = None
                async with httpx.AsyncClient(transport=self.transport, timeout=timeout, follow_redirects=False) as client:
                    async with asyncio.timeout(attempt_budget):
                        async with client.stream(
                            "GET", endpoint, params=params,
                            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                        ) as response:
                            if response.status_code == 429 and attempt == 0:
                                retry_delay = _retry_after(response.headers.get("retry-after"))
                                if retry_delay is None:
                                    retry_delay = 1.0
                            if response.status_code >= 500 and attempt == 0:
                                retry_delay = 0.5
                            if retry_delay is not None:
                                pass
                            elif response.status_code in (401, 403, 404, 429):
                                code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited"}[response.status_code]
                                raise AdapterError(code, "Learning summary is unavailable", response.status_code == 429)
                            elif response.status_code != 200:
                                raise AdapterError("learning_summary_unavailable", "Learning summary is unavailable", response.status_code >= 500)
                            else:
                                body = bytearray()
                                async for chunk in response.aiter_bytes():
                                    body.extend(chunk)
                                    if len(body) > MAX_RESPONSE_BYTES:
                                        raise AdapterError("learning_summary_too_large", "The learning summary exceeds the response size limit")
                                try:
                                    data = json.loads(body)
                                except (json.JSONDecodeError, UnicodeDecodeError):
                                    raise AdapterError("learning_summary_unavailable", "The learning summary is not valid JSON") from None
                                try:
                                    return validate_overview(data, raw_size=len(body))
                                except ContractError as error:
                                    raise AdapterError(error.code, str(error)) from None
                if retry_delay is not None:
                    remaining = deadline - self.monotonic()
                    if retry_delay >= remaining:
                        raise AdapterError("learning_summary_unavailable", "Learning summary is temporarily unavailable", True)
                    try:
                        async with asyncio.timeout(remaining):
                            await self.sleep(retry_delay)
                    except (TimeoutError, asyncio.TimeoutError):
                        break
                    continue
            except AdapterError:
                raise
            except (httpx.TransportError, TimeoutError, asyncio.TimeoutError):
                if attempt == 0 and self.monotonic() < deadline:
                    continue
                break
        raise AdapterError("learning_summary_unavailable", "Learning summary is temporarily unavailable", True)
