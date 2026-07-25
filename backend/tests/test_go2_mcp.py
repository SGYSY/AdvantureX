import json
import unittest

import httpx

from app.go2_mcp import Go2McpClient


class Go2McpClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_calls_only_allowlisted_stationary_skills(self):
        requests = []

        async def handler(request: httpx.Request):
            payload = json.loads(request.content)
            requests.append(payload)
            return httpx.Response(200, json={
                "jsonrpc": "2.0",
                "id": payload["id"],
                "result": {"content": [{"type": "text", "text": "Greeting completed"}]},
            })

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = Go2McpClient("http://127.0.0.1:9990/mcp", http=http)
            result = await client.call(
                "snake1_stationary_greeting",
                {"gesture": "Hello", "opener": "你好"},
            )

        self.assertEqual(result, "Greeting completed")
        self.assertEqual(requests[0]["method"], "tools/call")

    async def test_rejects_raw_movement_tools_before_network(self):
        async def handler(_request: httpx.Request):
            self.fail("unsafe call must not reach MCP")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = Go2McpClient("http://127.0.0.1:9990/mcp", http=http)
            with self.assertRaisesRegex(ValueError, "not allowed"):
                await client.call("relative_move", {"forward": 1})


if __name__ == "__main__":
    unittest.main()
