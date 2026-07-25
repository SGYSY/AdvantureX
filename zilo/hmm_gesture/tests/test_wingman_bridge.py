import unittest

from recognize import parse_trigger_gestures


class WingmanBridgeTests(unittest.TestCase):
    def test_parses_trigger_model_allowlist(self):
        self.assertEqual(
            parse_trigger_gestures("打响指-hmm, 甩-hmm,"),
            {"打响指-hmm", "甩-hmm"},
        )

    def test_all_is_available_for_demo_mode(self):
        self.assertIn("all", parse_trigger_gestures("all"))


if __name__ == "__main__":
    unittest.main()
