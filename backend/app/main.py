from contextlib import asynccontextmanager
from pathlib import Path
import secrets
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .config import Settings, get_settings
from .models import AppState, DemoCallState, DemoCallTrigger, EvenRelayPayload, InboundMessage, Rescue, RescueCreate, VoiceReply, VoiceTurn, ZiloEvent
from .orchestrator import Orchestrator
from .store import Store


settings = get_settings()
compare_secret = secrets.compare_digest
store = Store(settings.database_path)
orchestrator = Orchestrator(store, settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await orchestrator.recover()
    yield


app = FastAPI(title="Wingman", version="1.0.0", lifespan=lifespan)
cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Wingman-Key", "X-Wingman-Secret"],
    )
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


def auth(x_wingman_key: str | None = Header(default=None)):
    if settings.api_key and x_wingman_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid X-Wingman-Key")


@app.get("/", include_in_schema=False)
async def dashboard():
    return FileResponse(static_dir / "index.html")


@app.get("/mobile", include_in_schema=False)
async def mobile_call_screen():
    return FileResponse(static_dir / "mobile.html")


@app.get("/health")
async def health():
    return {"ok": True, "photon_mode": "live" if orchestrator.photon.live else "demo", "calling_enabled": orchestrator.phone.enabled}


@app.get("/api/v1/state", response_model=AppState, dependencies=[Depends(auth)])
async def state():
    return AppState(rescues=store.list_rescues(), events=store.list_events(), photon_mode="live" if orchestrator.photon.live else "demo", calling_enabled=orchestrator.phone.enabled)


@app.post("/api/v1/rescues", response_model=Rescue, dependencies=[Depends(auth)])
async def rescue(request: RescueCreate):
    try:
        return await orchestrator.create_rescue(request)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/v1/rescues/{rescue_id}/cancel", response_model=Rescue, dependencies=[Depends(auth)])
async def cancel(rescue_id: str):
    result = await orchestrator.cancel(rescue_id)
    if not result:
        raise HTTPException(404, "Rescue not found")
    return result


@app.post("/api/v1/events/zilo", dependencies=[Depends(auth)])
async def zilo(event: ZiloEvent):
    return {"feedback": await orchestrator.zilo_event(event.kind, event.transcript)}


@app.post("/api/v1/demo/trigger", response_model=DemoCallState, dependencies=[Depends(auth)])
async def trigger_demo_call(request: DemoCallTrigger):
    try:
        return await orchestrator.trigger_demo_call(request)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/v1/demo/fixed", response_model=DemoCallState)
async def trigger_fixed_demo():
    try:
        return await orchestrator.trigger_fixed_demo()
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(429, str(exc)) from exc


@app.post("/api/v1/hardware/even")
async def even_ring_relay(
    payload: EvenRelayPayload,
    request: Request,
    x_wingman_secret: str | None = Header(default=None),
):
    configured_secret = settings.wingman_shared_secret.strip()
    if not configured_secret:
        raise HTTPException(503, "WINGMAN_SHARED_SECRET is not configured.")
    provided_secret = x_wingman_secret or ""
    if not compare_secret(
        provided_secret.encode("utf-8"),
        configured_secret.encode("utf-8"),
    ):
        raise HTTPException(403, "Invalid X-Wingman-Secret.")
    if request.client is None or request.client.host not in {"127.0.0.1", "::1"}:
        raise HTTPException(403, "The Even relay must run locally on this Mac.")
    try:
        return await orchestrator.even_ring_event(payload)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/v1/demo/call", response_model=DemoCallState)
async def demo_call_state():
    return orchestrator.get_demo_call()


@app.post("/api/v1/demo/call/accept", response_model=DemoCallState)
async def accept_demo_call():
    return orchestrator.accept_demo_call()


@app.post("/api/v1/demo/call/decline", response_model=DemoCallState)
async def decline_demo_call():
    return orchestrator.decline_demo_call()


@app.post("/api/v1/demo/call/end", response_model=DemoCallState)
async def end_demo_call():
    return orchestrator.end_demo_call()


@app.post("/api/v1/voice/turn", response_model=VoiceReply, dependencies=[Depends(auth)])
async def voice(turn: VoiceTurn):
    return await orchestrator.voice_turn(turn.transcript, turn.conversation_id)


@app.post("/api/v1/photon/inbound", dependencies=[Depends(auth)])
async def photon_inbound(message: InboundMessage):
    return {"reply": await orchestrator.inbound(message.sender, message.text)}


@app.post("/api/v1/call", dependencies=[Depends(auth)])
async def call():
    try:
        return {"call_sid": await orchestrator.call_user("dashboard")}
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
