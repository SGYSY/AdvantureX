import unittest

from app.agent_service import WingmanAgentService
from app.stepfun_agent import AgentDecision


class FakePlanner:
    def __init__(self, decision):
        self.decision = decision

    async def plan(self, _text):
        return self.decision


class FakeGo2:
    def __init__(self):
        self.calls = []

    async def call(self, name, arguments):
        self.calls.append((name, arguments))
        return "done"


class WingmanAgentServiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_unconfirmed_physical_action_is_only_proposed(self):
        go2 = FakeGo2()
        service = WingmanAgentService(
            FakePlanner(
                AgentDecision(
                    message="我可以让狗挥手。",
                    tool_name="snake1_stationary_greeting",
                    arguments={"gesture": "Hello", "opener": "你好"},
                )
            ),
            go2,
        )

        result = await service.turn("帮我打招呼")

        self.assertTrue(result.requires_confirmation)
        self.assertFalse(result.executed)
        self.assertIsNotNone(result.action_id)
        self.assertEqual(go2.calls, [])

    async def test_confirmation_executes_the_exact_proposed_action_once(self):
        go2 = FakeGo2()
        service = WingmanAgentService(
            FakePlanner(
                AgentDecision(
                    message="正在执行。",
                    tool_name="snake1_stationary_greeting",
                    arguments={"gesture": "Hello", "opener": "你好"},
                )
            ),
            go2,
        )

        proposal = await service.turn("帮我打招呼")
        result = await service.confirm(proposal.action_id)

        self.assertTrue(result.executed)
        self.assertFalse(result.requires_confirmation)
        self.assertEqual(
            go2.calls,
            [
                (
                    "snake1_stationary_greeting",
                    {"gesture": "Hello", "opener": "你好"},
                )
            ],
        )
        self.assertEqual(result.tool_result, "done")
        with self.assertRaisesRegex(ValueError, "not found or already used"):
            await service.confirm(proposal.action_id)

    async def test_emergency_stop_does_not_wait_for_confirmation(self):
        go2 = FakeGo2()
        service = WingmanAgentService(
            FakePlanner(
                AgentDecision(
                    message="立即停止。",
                    tool_name="snake1_emergency_stop",
                    arguments={},
                )
            ),
            go2,
        )

        result = await service.turn("停下")

        self.assertTrue(result.executed)
        self.assertEqual(go2.calls, [("snake1_emergency_stop", {})])

    async def test_ring_can_confirm_or_cancel_only_the_latest_proposal(self):
        go2 = FakeGo2()
        service = WingmanAgentService(
            FakePlanner(
                AgentDecision(
                    message="请确认。",
                    tool_name="snake1_neutral_pose",
                    arguments={},
                )
            ),
            go2,
        )
        first = await service.turn("回到中立姿势")
        self.assertTrue(service.cancel_latest())
        with self.assertRaisesRegex(ValueError, "not found"):
            await service.confirm(first.action_id)

        second = await service.turn("回到中立姿势")
        result = await service.confirm_latest()
        self.assertEqual(result.action_id, second.action_id)
        self.assertEqual(go2.calls, [("snake1_neutral_pose", {})])

    async def test_emergency_stop_invalidates_a_stale_proposal(self):
        go2 = FakeGo2()
        planner = FakePlanner(
            AgentDecision(
                message="请确认。",
                tool_name="snake1_stationary_greeting",
                arguments={"gesture": "Hello", "opener": "你好"},
            )
        )
        service = WingmanAgentService(planner, go2)
        await service.turn("打招呼")
        planner.decision = AgentDecision(
            message="立即停止。",
            tool_name="snake1_emergency_stop",
            arguments={},
        )

        await service.turn("停下")

        with self.assertRaisesRegex(ValueError, "not found"):
            await service.confirm_latest()
        self.assertEqual(go2.calls, [("snake1_emergency_stop", {})])


if __name__ == "__main__":
    unittest.main()
