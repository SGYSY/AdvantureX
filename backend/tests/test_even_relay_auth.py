import secrets
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.requests import Request

from app import main
from app.models import EvenRelayPayload


def request_from(host: str) -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/v1/hardware/even",
        "headers": [],
        "client": (host, 12345),
    })


def payload() -> EvenRelayPayload:
    return EvenRelayPayload(
        schema="even-r1-relay/v1",
        event={"gesture": "ring.click", "source": {"kind": "ring"}},
        action=None,
    )


class EvenRelayAuthTest(unittest.IsolatedAsyncioTestCase):
    async def test_missing_server_secret_fails_closed(self):
        with patch.object(main.settings, "wingman_shared_secret", ""):
            with self.assertRaises(HTTPException) as raised:
                await main.even_ring_relay(payload(), request_from("127.0.0.1"), None)
        self.assertEqual(raised.exception.status_code, 503)

    async def test_wrong_shared_secret_is_forbidden(self):
        with patch.object(main.settings, "wingman_shared_secret", "server-secret"):
            with self.assertRaises(HTTPException) as raised:
                await main.even_ring_relay(payload(), request_from("127.0.0.1"), "wrong")
        self.assertEqual(raised.exception.status_code, 403)

    async def test_correct_secret_from_loopback_is_processed(self):
        with (
            patch.object(main.settings, "wingman_shared_secret", "server-secret"),
            patch.object(
                main.orchestrator,
                "even_ring_event",
                AsyncMock(return_value={"accepted": False}),
            ) as handler,
        ):
            result = await main.even_ring_relay(
                payload(),
                request_from("127.0.0.1"),
                "server-secret",
            )
        self.assertEqual(result, {"accepted": False})
        handler.assert_awaited_once()

    async def test_correct_secret_from_non_loopback_is_forbidden(self):
        with patch.object(main.settings, "wingman_shared_secret", "server-secret"):
            with self.assertRaises(HTTPException) as raised:
                await main.even_ring_relay(
                    payload(),
                    request_from("192.0.2.10"),
                    "server-secret",
                )
        self.assertEqual(raised.exception.status_code, 403)

    def test_secret_comparison_uses_constant_time_primitive(self):
        self.assertIs(main.compare_secret, secrets.compare_digest)
