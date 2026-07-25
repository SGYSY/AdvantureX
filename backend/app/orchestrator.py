import asyncio
import re
import uuid
from datetime import timedelta
from .adapters import PhoneAdapter, PhotonAdapter
from .config import Settings
from .models import DemoCallState, DemoCallStatus, DemoCallTrigger, EvenRelayPayload, Rescue, RescueCreate, Status, VoiceReply
from .store import Store, now

DEFAULT_MESSAGE = "Wingman reminder: you requested a private check-in. Reply 取消 to stop, 延后 30 秒 to delay, or 电话 to request a call."
FIXED_DEMO_MESSAGE = "有一群母猪排队掉进水里"


class Orchestrator:
    def __init__(self, store: Store, settings: Settings):
        self.store, self.settings = store, settings
        self.photon, self.phone = PhotonAdapter(settings), PhoneAdapter(settings)
        self.jobs: dict[str, asyncio.Task] = {}
        self.demo_call = DemoCallState()
        self.demo_call_job: asyncio.Task | None = None
        self.last_fixed_demo_at = None

    async def recover(self) -> None:
        for rescue in self.store.list_pending():
            self._schedule(rescue)

    async def create_rescue(self, request: RescueCreate) -> Rescue:
        # A blank local setup stays demonstrable without pretending that a message
        # was delivered to a real person. Live Photon delivery always requires a recipient.
        recipient = request.recipient or self.settings.user_phone_number or ("demo-owner" if not self.photon.live else "")
        if not recipient:
            raise ValueError("A recipient is required. Add USER_PHONE_NUMBER or enter a recipient.")
        rescue = Rescue(
            id=str(uuid.uuid4()), recipient=recipient, delay_seconds=request.delay_seconds,
            message=request.message or DEFAULT_MESSAGE, source=request.source, status=Status.scheduled,
            created_at=now(), execute_at=now() + timedelta(seconds=request.delay_seconds),
        )
        self.store.add_rescue(rescue)
        self.store.log("rescue.scheduled", f"Scheduled delivery in {rescue.delay_seconds}s via Photon", rescue.id)
        self._schedule(rescue)
        return rescue

    def _schedule(self, rescue: Rescue) -> None:
        old = self.jobs.pop(rescue.id, None)
        if old:
            old.cancel()
        self.jobs[rescue.id] = asyncio.create_task(self._deliver_when_due(rescue.id), name=f"rescue:{rescue.id}")

    async def _deliver_when_due(self, rescue_id: str) -> None:
        rescue = self.store.get_rescue(rescue_id)
        if not rescue or rescue.status != Status.scheduled:
            return
        seconds = max(0, (rescue.execute_at - now()).total_seconds())
        try:
            await asyncio.sleep(seconds)
            rescue = self.store.get_rescue(rescue_id)
            if not rescue or rescue.status != Status.scheduled:
                return
            self.store.update_status(rescue_id, Status.executing)
            self.store.log("photon.sending", "Sending rescue reminder through Photon", rescue_id)
            result = await self.photon.send(rescue.recipient, rescue.message)
            self.store.update_status(rescue_id, Status.completed)
            self.store.log("photon.sent", f"Delivered ({result.get('mode', 'live')})", rescue_id)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            self.store.update_status(rescue_id, Status.failed, str(exc))
            self.store.log("photon.failed", str(exc), rescue_id)
        finally:
            self.jobs.pop(rescue_id, None)

    async def cancel(self, rescue_id: str) -> Rescue | None:
        rescue = self.store.get_rescue(rescue_id)
        if not rescue or rescue.status != Status.scheduled:
            return rescue
        job = self.jobs.pop(rescue_id, None)
        if job:
            job.cancel()
        updated = self.store.update_status(rescue_id, Status.cancelled)
        self.store.log("rescue.cancelled", "Cancelled by user", rescue_id)
        return updated

    async def delay(self, rescue_id: str, seconds: int) -> Rescue | None:
        updated = self.store.reschedule(rescue_id, seconds)
        if updated and updated.status == Status.scheduled:
            self._schedule(updated)
            self.store.log("rescue.rescheduled", f"Delayed by command; now {seconds}s from now", rescue_id)
        return updated

    async def call_user(self, source: str) -> str:
        sid = await self.phone.call_user()
        self.store.log("phone.call_requested", f"Call placed from {source}: {sid}")
        return sid

    async def trigger_demo_call(self, request: DemoCallTrigger) -> DemoCallState:
        """Use one semantic double-tap path for hardware and the web demo.

        The browser renders the incoming call. It deliberately does not pretend to
        place a PSTN call; the real Twilio call endpoint remains separate.
        """
        rescue = await self.create_rescue(RescueCreate(
            recipient=request.recipient,
            delay_seconds=request.message_delay_seconds,
            message=request.message,
            source=request.source,
        ))
        if self.demo_call_job:
            self.demo_call_job.cancel()
        created_at = now()
        self.demo_call = DemoCallState(
            id=str(uuid.uuid4()), status=DemoCallStatus.scheduled,
            created_at=created_at,
            ring_at=created_at + timedelta(seconds=request.message_delay_seconds + request.call_delay_seconds),
            rescue_id=rescue.id, message=rescue.message,
        )
        self.store.log("demo.call_scheduled", f"Incoming-call screen will ring in {request.message_delay_seconds + request.call_delay_seconds}s", rescue.id)
        self.demo_call_job = asyncio.create_task(self._ring_demo_call(self.demo_call.id), name=f"demo-call:{self.demo_call.id}")
        return self.demo_call

    async def trigger_fixed_demo(self, *, call_delay_seconds: int = 5, source: str = "public.fixed_demo") -> DemoCallState:
        """Public-demo entrypoint: target and text are server-controlled only."""
        if not self.settings.user_phone_number:
            raise ValueError("The demo recipient is not configured on the server.")
        current_time = now()
        if self.last_fixed_demo_at and (current_time - self.last_fixed_demo_at).total_seconds() < 30:
            raise RuntimeError("Please wait 30 seconds before starting the next demo.")
        self.last_fixed_demo_at = current_time
        return await self.trigger_demo_call(DemoCallTrigger(
            message=FIXED_DEMO_MESSAGE,
            message_delay_seconds=0,
            call_delay_seconds=call_delay_seconds,
            source=source,
        ))

    async def even_ring_event(self, payload: EvenRelayPayload) -> dict[str, object]:
        """Map an authorized semantic Even R1 rescue action to the fixed demo."""
        event = payload.event
        source = event.get("source") if isinstance(event.get("source"), dict) else {}
        source_kind = str(source.get("kind", "unknown"))
        gesture = str(event.get("gesture", "unknown"))
        action_name = str(payload.action.get("name", "")) if payload.action else ""
        self.store.log("ring.event", f"{source_kind} {gesture} action={action_name or 'none'}")

        is_trigger = source_kind == "ring" and action_name == "snake1_rescue"
        if not is_trigger:
            return {
                "ok": True,
                "accepted": False,
                "reason": "Deliberate SNAKE1 rescue sequence required.",
            }

        try:
            call = await self.trigger_fixed_demo(
                call_delay_seconds=10,
                source="ring.snake1_rescue",
            )
        except RuntimeError as exc:
            return {"ok": False, "accepted": False, "reason": str(exc)}
        return {"ok": True, "accepted": True, "call_id": call.id, "ring_at": call.ring_at}

    async def _ring_demo_call(self, call_id: str | None) -> None:
        try:
            if not self.demo_call.ring_at:
                return
            await asyncio.sleep(max(0, (self.demo_call.ring_at - now()).total_seconds()))
            if self.demo_call.id != call_id or self.demo_call.status != DemoCallStatus.scheduled:
                return
            self.demo_call.status = DemoCallStatus.ringing
            self.store.log("demo.call_ringing", "Wingman incoming-call screen is ringing", self.demo_call.rescue_id)
        except asyncio.CancelledError:
            return

    def get_demo_call(self) -> DemoCallState:
        return self.demo_call

    def accept_demo_call(self) -> DemoCallState:
        if self.demo_call.status == DemoCallStatus.ringing:
            self.demo_call.status = DemoCallStatus.accepted
            self.demo_call.accepted_at = now()
            self.store.log("demo.call_accepted", "User accepted the web call", self.demo_call.rescue_id)
        return self.demo_call

    def decline_demo_call(self) -> DemoCallState:
        if self.demo_call_job and not self.demo_call_job.done():
            self.demo_call_job.cancel()
        if self.demo_call.status in (DemoCallStatus.scheduled, DemoCallStatus.ringing):
            self.demo_call.status = DemoCallStatus.declined
            self.store.log("demo.call_declined", "User declined the web call", self.demo_call.rescue_id)
        return self.demo_call

    def end_demo_call(self) -> DemoCallState:
        if self.demo_call.status == DemoCallStatus.accepted:
            self.demo_call.status = DemoCallStatus.ended
            self.store.log("demo.call_ended", "Web call ended", self.demo_call.rescue_id)
        return self.demo_call

    async def zilo_event(self, kind: str, transcript: str | None = None) -> str:
        self.store.log("zilo.event", f"{kind}{': ' + transcript if transcript else ''}")
        if kind == "double_tap":
            call = await self.trigger_demo_call(DemoCallTrigger(
                message_delay_seconds=self.settings.default_delay_seconds,
                call_delay_seconds=5,
                source="zilo.double_tap",
            ))
            return f"救场已启动，提醒发送后将显示 Wingman 来电（预计 {(call.ring_at - now()).seconds} 秒）。"
        if kind == "long_press":
            return "实体僚机功能尚未启用。你可以说：救我，或下一句聊什么？"
        return (await self.voice_turn(transcript or "", None)).text

    async def voice_turn(self, transcript: str, conversation_id: str | None) -> VoiceReply:
        text = transcript.strip()
        lowered = text.lower().replace(" ", "")
        cid = conversation_id or str(uuid.uuid4())
        if any(word in lowered for word in ("救我", "救场", "帮我离开")):
            return VoiceReply(conversation_id=cid, text="消息救场，还是电话提醒？", action="choose_rescue")
        if "消息" in lowered:
            rescue = await self.create_rescue(RescueCreate(delay_seconds=self.settings.default_delay_seconds, source="viaim.voice"))
            return VoiceReply(conversation_id=cid, text=f"好的，{rescue.delay_seconds} 秒后提醒。说停可取消。", action=f"rescue:{rescue.id}")
        if "电话" in lowered:
            if not self.phone.enabled:
                return VoiceReply(conversation_id=cid, text="电话尚未配置。先给你发消息提醒。")
            await self.call_user("viaim.voice")
            return VoiceReply(conversation_id=cid, text="正在呼叫你的预设号码。", action="call")
        if lowered in ("停", "取消", "算了"):
            pending = next((r for r in self.store.list_rescues() if r.status == Status.scheduled), None)
            if pending:
                await self.cancel(pending.id)
                return VoiceReply(conversation_id=cid, text="已取消当前提醒。", action=f"cancel:{pending.id}")
            return VoiceReply(conversation_id=cid, text="当前没有待执行的提醒。")
        if any(word in lowered for word in ("下一句", "聊什么", "自然一点")):
            advice = "可以问：你们最开始怎么想到这个方向的？"
            return VoiceReply(conversation_id=cid, text=advice, action="coach")
        return VoiceReply(conversation_id=cid, text="你可以说：救我，或下一句聊什么？")

    async def inbound(self, sender: str, text: str) -> str:
        normalized = text.strip().lower().replace(" ", "")
        self.store.log("photon.inbound", f"From {sender}: {text}")
        if self.settings.user_phone_number and sender != self.settings.user_phone_number:
            return "This Wingman thread accepts commands only from its configured owner."
        pending = next((r for r in self.store.list_rescues() if r.status == Status.scheduled), None)
        if "取消" in normalized or normalized == "停":
            if pending:
                await self.cancel(pending.id)
                return "已取消待执行的提醒。"
            return "没有待执行的提醒。"
        match = re.search(r"(?:延后|改成|再等)(?:\D*)(\d{1,3})\s*(?:秒|s)?", normalized)
        if match and pending:
            seconds = min(int(match.group(1)), 3600)
            await self.delay(pending.id, seconds)
            return f"已调整为 {seconds} 秒后发送。"
        if "电话" in normalized:
            if not self.phone.enabled:
                return "电话功能尚未配置；我可以继续用 iMessage 提醒。"
            await self.call_user("photon.inbound")
            return "正在呼叫你的预设号码。"
        if "机器狗" in normalized or "实体" in normalized:
            return "实体僚机功能目前未启用。"
        if "状态" in normalized:
            return "当前" + (f"有一条提醒将在 {(pending.execute_at - now()).seconds} 秒后发送。" if pending else "没有待执行的提醒。")
        return "可回复：取消、延后 30 秒、电话，或状态。"
