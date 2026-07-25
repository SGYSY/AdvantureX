import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.start_snake1 import find_even_relay_root, go2_route_is_safe
from scripts.configure_snake1 import update_env_text


class LauncherSafetyTest(unittest.TestCase):
    def test_requires_go2_ap_address_route_and_ping(self):
        self.assertTrue(go2_route_is_safe("192.168.12.42", "en0", "en0", True))
        self.assertFalse(go2_route_is_safe("30.201.216.193", "en0", "en0", True))
        self.assertFalse(go2_route_is_safe("192.168.12.42", "utun6", "en0", True))
        self.assertFalse(go2_route_is_safe("192.168.12.42", "en0", "utun6", True))
        self.assertFalse(go2_route_is_safe("192.168.12.42", "en0", "en0", False))

    def test_prefers_the_active_realtime_copilot_relay(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            active = root / ".worktrees/snake1-realtime-copilot/even"
            fallback = root / "even"
            for candidate in (active, fallback):
                (candidate / "tools").mkdir(parents=True)
                (candidate / "tools/relay-server.mjs").touch()
            self.assertEqual(find_even_relay_root(root), active)

    def test_configurator_updates_secrets_without_dropping_other_settings(self):
        result = update_env_text(
            "API_KEY=local\nSTEPFUN_API_KEY=old\n",
            {
                "STEPFUN_API_KEY": "new",
                "ROBOT_IP": "192.168.12.1",
            },
        )
        self.assertIn("API_KEY=local", result)
        self.assertIn("STEPFUN_API_KEY=new", result)
        self.assertIn("ROBOT_IP=192.168.12.1", result)
        self.assertNotIn("STEPFUN_API_KEY=old", result)


if __name__ == "__main__":
    unittest.main()
