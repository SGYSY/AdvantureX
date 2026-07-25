import itertools
from typing import Any

import httpx


ALLOWED_GO2_TOOLS = {
    "snake1_stationary_greeting",
    "snake1_neutral_pose",
    "snake1_emergency_stop",
}


class Go2McpClient:
    def __init__(
        self,
        url: str = "http://127.0.0.1:9990/mcp",
        *,
        http: httpx.AsyncClient | None = None,
    ):
        self.url = url
        self.http = http
        self._ids = itertools.count(1)

    async def call(self, name: str, arguments: dict[str, Any] | None = None) -> str:
        if name not in ALLOWED_GO2_TOOLS:
            raise ValueError(f"Go2 tool '{name}' is not allowed")
        payload = {
            "jsonrpc": "2.0",
            "id": next(self._ids),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        }
        owns_http = self.http is None
        http = self.http or httpx.AsyncClient(timeout=20)
        try:
            response = await http.post(self.url, json=payload)
            response.raise_for_status()
            body = response.json()
            if "error" in body:
                error = body["error"]
                raise RuntimeError(f"DimOS MCP error: {error.get('message', error)}")
            content = body.get("result", {}).get("content", [])
            return "\n".join(
                item.get("text", "")
                for item in content
                if item.get("type") == "text"
            )
        finally:
            if owns_http:
                await http.aclose()
