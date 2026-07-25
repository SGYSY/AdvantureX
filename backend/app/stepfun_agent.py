from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import json
from typing import Any

import httpx


Completion = Callable[[list[dict[str, Any]], list[dict[str, Any]]], Awaitable[dict[str, Any]]]

SAFE_GESTURES = {"Hello", "Sit"}
SAFE_TOOLS = {
    "snake1_stationary_greeting",
    "snake1_neutral_pose",
    "snake1_emergency_stop",
}

STATIONARY_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "snake1_stationary_greeting",
            "description": (
                "Perform a user-confirmed greeting while the Go2 remains inside its "
                "stationary safety area. Never use for navigation or locomotion."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "gesture": {
                        "type": "string",
                        "enum": sorted(SAFE_GESTURES),
                        "description": "A low-displacement greeting posture.",
                    },
                    "opener": {
                        "type": "string",
                        "maxLength": 80,
                        "description": "Short, friendly sentence for the local speaker.",
                    },
                },
                "required": ["gesture", "opener"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "snake1_neutral_pose",
            "description": "Stop motion and return the Go2 to a neutral balanced posture.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "snake1_emergency_stop",
            "description": "Immediately stop Go2 movement. Use on cancellation or uncertainty.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


@dataclass(frozen=True)
class AgentDecision:
    message: str
    tool_name: str | None = None
    arguments: dict[str, Any] | None = None


class StepFunApi:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://api.stepfun.com/step_plan/v1",
        model: str = "step-3.5-flash",
        http: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.http = http

    async def __call__(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("STEPFUN_API_KEY is not configured")
        owns_http = self.http is None
        http = self.http or httpx.AsyncClient(timeout=30)
        try:
            response = await http.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "messages": messages, "tools": tools},
            )
            response.raise_for_status()
            return response.json()
        finally:
            if owns_http:
                await http.aclose()


class StepFunAgent:
    SYSTEM_PROMPT = (
        "You are SNAKE1 Wingman. Choose only the supplied stationary Go2 tools. "
        "The robot must remain within a half-meter demo area. Never request raw "
        "velocity, navigation, following, jumps, flips, dances, or unconfirmed "
        "physical actions. Keep spoken openers friendly and under 80 characters."
    )

    def __init__(self, completion: Completion):
        self.completion = completion

    async def plan(self, user_text: str) -> AgentDecision:
        payload = await self.completion(
            [
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": user_text},
            ],
            STATIONARY_TOOLS,
        )
        message = payload["choices"][0]["message"]
        calls = message.get("tool_calls") or []
        if not calls:
            return AgentDecision(message=message.get("content") or "")

        function = calls[0].get("function") or {}
        name = function.get("name") or ""
        if name not in SAFE_TOOLS:
            raise ValueError(f"Tool '{name}' is not allowed")
        arguments = json.loads(function.get("arguments") or "{}")
        self._validate(name, arguments)
        return AgentDecision(
            message=message.get("content") or "",
            tool_name=name,
            arguments=arguments,
        )

    @staticmethod
    def _validate(name: str, arguments: dict[str, Any]) -> None:
        if name != "snake1_stationary_greeting":
            if arguments:
                raise ValueError(f"Tool '{name}' does not accept arguments")
            return
        if arguments.get("gesture") not in SAFE_GESTURES:
            raise ValueError("Unsafe stationary gesture")
        opener = arguments.get("opener")
        if not isinstance(opener, str) or not opener.strip() or len(opener) > 80:
            raise ValueError("Opener must contain 1-80 characters")
