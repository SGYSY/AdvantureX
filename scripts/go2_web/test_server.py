from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from scripts.go2_web.server import RobotBridge


class RobotBridgeLocomotionTest(unittest.TestCase):
    def test_enable_locomotion_uses_switch_joystick_rpc(self) -> None:
        bridge = RobotBridge()
        client = MagicMock()
        client.remote_name = "GO2Connection"
        client.rpc.call_sync.return_value = (True, lambda: None)
        bridge._rpc_client = client

        result = bridge.enable_locomotion()

        client.rpc.call_sync.assert_called_once_with(
            "GO2Connection/switch_joystick",
            ((True,), {}),
            rpc_timeout=6.0,
        )
        self.assertEqual(
            result,
            {"ok": True, "enabled": True, "result": "True"},
        )


if __name__ == "__main__":
    unittest.main()
