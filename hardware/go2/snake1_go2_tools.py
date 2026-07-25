#!/usr/bin/env python3
from typing import Protocol

from dimos.agents.annotation import skill
from dimos.agents.mcp import mcp_server
from dimos.agents.mcp.mcp_server import McpServer
from dimos.core.core import rpc
from dimos.core.coordination.blueprints import autoconnect
from dimos.core.module import Module
from dimos.core.rpc_client import RPCClient
from dimos.robot.unitree.go2.connection import GO2Connection
from dimos.spec.utils import Spec

from stationary_policy import require_safe_gesture, require_safe_opener


class StationaryGo2Spec(Spec, Protocol):
    def sport_command(self, api_id: int) -> bool: ...
    def stop_movement(self) -> None: ...
    def balance_stand(self) -> bool: ...


class Snake1StationarySkills(Module):
    _connection: StationaryGo2Spec

    @skill
    def snake1_stationary_greeting(self, gesture: str, opener: str) -> str:
        """Perform a low-displacement greeting inside the SNAKE1 demo area.

        Call only after explicit user confirmation. This skill never accepts
        navigation, translation, velocity, jumps, flips, or dance commands.

        Args:
            gesture: Safe greeting posture. Currently Hello or Sit.
            opener: A friendly sentence of at most 80 characters.
        """
        api_id = require_safe_gesture(gesture)
        text = require_safe_opener(opener)
        self._connection.stop_movement()
        if not self._connection.sport_command(api_id):
            return f"Failed to perform stationary gesture {gesture}."
        return f"Performed stationary gesture {gesture}. Speak locally: {text}"

    @skill
    def snake1_neutral_pose(self) -> str:
        """Stop movement and return to a neutral balanced posture."""
        self._connection.stop_movement()
        ok = self._connection.balance_stand()
        return "Go2 returned to neutral pose." if ok else "Failed to enter neutral pose."

    @skill
    def snake1_emergency_stop(self) -> str:
        """Immediately stop all Go2 base movement."""
        self._connection.stop_movement()
        return "Go2 movement stopped."


class StationaryMcpServer(McpServer):
    """Expose only the three reviewed SNAKE1 skills, even on localhost."""

    @rpc
    def on_system_modules(self, modules: list[RPCClient]) -> None:
        super().on_system_modules(modules)
        allowed = {
            "snake1_stationary_greeting",
            "snake1_neutral_pose",
            "snake1_emergency_stop",
        }
        mcp_server.app.state.skills = [
            info for info in mcp_server.app.state.skills if info.func_name in allowed
        ]
        mcp_server.app.state.skills_by_name = {
            name: info
            for name, info in mcp_server.app.state.skills_by_name.items()
            if name in allowed
        }
        mcp_server.app.state.rpc_calls = {
            name: call
            for name, call in mcp_server.app.state.rpc_calls.items()
            if name in allowed
        }


snake1_go2_tools = autoconnect(
    GO2Connection.blueprint(),
    StationaryMcpServer.blueprint(),
    Snake1StationarySkills.blueprint(),
).global_config(n_workers=3, robot_model="unitree_go2")


if __name__ == "__main__":
    snake1_go2_tools.build().loop()
