import importlib.util
from pathlib import Path
import unittest


POLICY_PATH = Path(__file__).parents[2] / "hardware" / "go2" / "stationary_policy.py"
SPEC = importlib.util.spec_from_file_location("stationary_policy", POLICY_PATH)
stationary_policy = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(stationary_policy)


class StationaryPolicyTest(unittest.TestCase):
    def test_accepts_only_low_displacement_gestures(self):
        self.assertEqual(stationary_policy.require_safe_gesture("Hello"), 1016)
        self.assertEqual(stationary_policy.require_safe_gesture("Sit"), 1009)
        with self.assertRaisesRegex(ValueError, "unsafe"):
            stationary_policy.require_safe_gesture("FrontPounce")
        with self.assertRaisesRegex(ValueError, "unsafe"):
            stationary_policy.require_safe_gesture("Dance1")

    def test_limits_spoken_opener_length(self):
        self.assertEqual(stationary_policy.require_safe_opener("你好"), "你好")
        with self.assertRaisesRegex(ValueError, "80"):
            stationary_policy.require_safe_opener("很" * 81)


if __name__ == "__main__":
    unittest.main()
