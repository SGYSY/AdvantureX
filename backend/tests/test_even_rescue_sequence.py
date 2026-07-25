import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from app.config import Settings
from app.models import DemoCallState, EvenRelayPayload
from app.orchestrator import Orchestrator
from app.store import Store


def payload(gesture: str, action: str | None) -> EvenRelayPayload:
    return EvenRelayPayload(
        schema="even-r1-relay/v1",
        event={"gesture": gesture, "source": {"kind": "ring"}},
        action={"name": action} if action else None,
    )


class EvenRescueSequenceTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = str(Path(self.temp.name) / "test.db")
        self.orchestrator = Orchestrator(Store(path), Settings(user_phone_number="demo-owner"))
        self.orchestrator.trigger_fixed_demo = AsyncMock(
            return_value=DemoCallState(id="call-1")
        )

    async def asyncTearDown(self):
        self.temp.cleanup()

    async def test_raw_double_click_does_not_trigger_rescue(self):
        result = await self.orchestrator.even_ring_event(
            payload("ring.double_click", None)
        )
        self.assertFalse(result["accepted"])
        self.orchestrator.trigger_fixed_demo.assert_not_awaited()

    async def test_raw_click_does_not_trigger_rescue(self):
        result = await self.orchestrator.even_ring_event(payload("ring.click", None))
        self.assertFalse(result["accepted"])
        self.orchestrator.trigger_fixed_demo.assert_not_awaited()

    async def test_semantic_rescue_action_triggers_once(self):
        result = await self.orchestrator.even_ring_event(
            payload("ring.click", "snake1_rescue")
        )
        self.assertTrue(result["accepted"])
        self.orchestrator.trigger_fixed_demo.assert_awaited_once()
