import unittest

from app.stepfun_agent import AgentDecision, StepFunAgent


class StepFunAgentTest(unittest.IsolatedAsyncioTestCase):
    async def test_returns_a_valid_stationary_tool_call(self):
        async def fake_completion(_messages, _tools):
            return {
                "choices": [{
                    "message": {
                        "content": "",
                        "tool_calls": [{
                            "function": {
                                "name": "snake1_stationary_greeting",
                                "arguments": '{"gesture":"Hello","opener":"你好，可以认识一下吗？"}',
                            }
                        }],
                    }
                }]
            }

        agent = StepFunAgent(completion=fake_completion)
        decision = await agent.plan("帮我破冰")

        self.assertEqual(
            decision,
            AgentDecision(
                message="",
                tool_name="snake1_stationary_greeting",
                arguments={"gesture": "Hello", "opener": "你好，可以认识一下吗？"},
            ),
        )

    async def test_rejects_unapproved_robot_tools(self):
        async def fake_completion(_messages, _tools):
            return {
                "choices": [{
                    "message": {
                        "content": "",
                        "tool_calls": [{
                            "function": {
                                "name": "relative_move",
                                "arguments": '{"forward":2}',
                            }
                        }],
                    }
                }]
            }

        agent = StepFunAgent(completion=fake_completion)
        with self.assertRaisesRegex(ValueError, "not allowed"):
            await agent.plan("向前走两米")


if __name__ == "__main__":
    unittest.main()
