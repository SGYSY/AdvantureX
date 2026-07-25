from dataclasses import dataclass
from typing import Any, Protocol
from uuid import uuid4


class Planner(Protocol):
    async def plan(self, user_text: str): ...


class RobotTools(Protocol):
    async def call(self, name: str, arguments: dict[str, Any] | None = None) -> str: ...


@dataclass(frozen=True)
class AgentTurnResult:
    message: str
    tool_name: str | None
    arguments: dict[str, Any] | None
    requires_confirmation: bool
    executed: bool
    tool_result: str | None = None
    action_id: str | None = None


class WingmanAgentService:
    """Plan with StepFun, then enforce a confirmation boundary before DimOS."""

    def __init__(self, planner: Planner, go2: RobotTools):
        self.planner = planner
        self.go2 = go2
        self._pending: dict[str, tuple[str, dict[str, Any], str]] = {}
        self._latest_action_id: str | None = None

    async def turn(self, user_text: str) -> AgentTurnResult:
        decision = await self.planner.plan(user_text)
        if decision.tool_name is None:
            return AgentTurnResult(
                message=decision.message,
                tool_name=None,
                arguments=None,
                requires_confirmation=False,
                executed=False,
            )

        emergency = decision.tool_name == "snake1_emergency_stop"
        if not emergency:
            action_id = uuid4().hex
            self._pending.clear()
            self._pending[action_id] = (
                decision.tool_name,
                decision.arguments or {},
                decision.message,
            )
            self._latest_action_id = action_id
            return AgentTurnResult(
                message=decision.message,
                tool_name=decision.tool_name,
                arguments=decision.arguments or {},
                requires_confirmation=True,
                executed=False,
                action_id=action_id,
            )

        self._pending.clear()
        self._latest_action_id = None
        tool_result = await self.go2.call(decision.tool_name, decision.arguments or {})
        return AgentTurnResult(
            message=decision.message,
            tool_name=decision.tool_name,
            arguments=decision.arguments or {},
            requires_confirmation=False,
            executed=True,
            tool_result=tool_result,
        )

    async def confirm(self, action_id: str) -> AgentTurnResult:
        pending = self._pending.pop(action_id, None)
        if pending is None:
            raise ValueError("Action not found or already used")
        if self._latest_action_id == action_id:
            self._latest_action_id = None
        tool_name, arguments, message = pending
        tool_result = await self.go2.call(tool_name, arguments)
        return AgentTurnResult(
            message=message,
            tool_name=tool_name,
            arguments=arguments,
            requires_confirmation=False,
            executed=True,
            tool_result=tool_result,
            action_id=action_id,
        )

    async def confirm_latest(self) -> AgentTurnResult:
        if self._latest_action_id is None:
            raise ValueError("Pending action not found")
        return await self.confirm(self._latest_action_id)

    def cancel_latest(self) -> bool:
        if self._latest_action_id is None:
            return False
        self._pending.pop(self._latest_action_id, None)
        self._latest_action_id = None
        return True
