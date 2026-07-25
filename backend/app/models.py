from datetime import datetime
from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field


class Status(str, Enum):
    scheduled = "scheduled"
    executing = "executing"
    completed = "completed"
    cancelled = "cancelled"
    failed = "failed"


class DemoCallStatus(str, Enum):
    idle = "idle"
    scheduled = "scheduled"
    ringing = "ringing"
    accepted = "accepted"
    declined = "declined"
    ended = "ended"


class RescueCreate(BaseModel):
    recipient: str | None = None
    delay_seconds: int = Field(default=8, ge=0, le=3600)
    message: str | None = Field(default=None, max_length=500)
    source: str = "dashboard"


class DemoCallTrigger(BaseModel):
    """A browser-friendly stand-in for a hardware double-tap and phone call."""

    recipient: str | None = None
    message: str | None = Field(default=None, max_length=500)
    message_delay_seconds: int = Field(default=0, ge=0, le=60)
    call_delay_seconds: int = Field(default=5, ge=1, le=60)
    source: str = "web.double_tap"


class EvenRelayPayload(BaseModel):
    """Minimum safe envelope accepted from the local Even R1 relay."""

    schema: Literal["even-r1-relay/v1"]
    event: dict[str, Any]
    action: dict[str, Any] | None = None


class ZiloEvent(BaseModel):
    kind: Literal["double_tap", "long_press", "voice"]
    transcript: str | None = Field(default=None, max_length=500)
    device_id: str | None = Field(default=None, max_length=120)


class ZiloRingEvent(BaseModel):
    """Gesture recognized locally from the Zilo ring's BLE IMU stream."""

    schema: Literal["zilo-ring/v1"]
    gesture: str = Field(min_length=1, max_length=120)
    confidence: float = Field(ge=0.0, le=1.0)
    device_id: str | None = Field(default=None, max_length=120)


class VoiceTurn(BaseModel):
    transcript: str = Field(min_length=1, max_length=500)
    conversation_id: str | None = None


class InboundMessage(BaseModel):
    sender: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=2000)
    message_id: str | None = None


class Rescue(BaseModel):
    id: str
    recipient: str
    delay_seconds: int
    message: str
    source: str
    status: Status
    created_at: datetime
    execute_at: datetime
    completed_at: datetime | None = None
    error: str | None = None


class EventLog(BaseModel):
    id: int
    rescue_id: str | None = None
    event_type: str
    detail: str
    created_at: datetime


class AppState(BaseModel):
    rescues: list[Rescue]
    events: list[EventLog]
    photon_mode: Literal["live", "demo"]
    calling_enabled: bool


class DemoCallState(BaseModel):
    id: str | None = None
    status: DemoCallStatus = DemoCallStatus.idle
    created_at: datetime | None = None
    ring_at: datetime | None = None
    accepted_at: datetime | None = None
    rescue_id: str | None = None
    message: str | None = None


class VoiceReply(BaseModel):
    conversation_id: str
    text: str
    action: str | None = None
