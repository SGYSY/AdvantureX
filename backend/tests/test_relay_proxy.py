import unittest

from app import main


class FakeRequest:
    method = "POST"
    headers = {
        "authorization": "Bearer local-token",
        "content-type": "application/json",
    }

    async def body(self):
        return b'{"ok":true}'


class FakeRelayResponse:
    status_code = 200
    content = b'{"ok":true,"id":"session-1"}'
    headers = {"content-type": "application/json; charset=utf-8"}


class FakeClient:
    def __init__(self):
        self.calls = []

    async def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return FakeRelayResponse()


class RelayProxyTest(unittest.IsolatedAsyncioTestCase):
    async def test_loopback_client_ignores_system_proxy_settings(self):
        client = main.create_local_relay_client()
        try:
            self.assertFalse(client._trust_env)
        finally:
            await client.aclose()

    async def test_forwards_authorized_requests_to_the_loopback_relay(self):
        client = FakeClient()

        response = await main.proxy_to_local_relay(
            "social/session/start",
            FakeRequest(),
            client,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.body, b'{"ok":true,"id":"session-1"}')
        self.assertEqual(client.calls, [(
            "POST",
            "http://127.0.0.1:8788/social/session/start",
            {
                "content": b'{"ok":true}',
                "headers": {
                    "authorization": "Bearer local-token",
                    "content-type": "application/json",
                },
            },
        )])
        self.assertEqual(response.headers["access-control-allow-origin"], "*")
