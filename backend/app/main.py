from contextlib import asynccontextmanager
from pathlib import Path
import secrets
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from .agent_service import WingmanAgentService
from .config import Settings, get_settings
from .go2_mcp import Go2McpClient
from .models import AgentConfirmRequest, AgentTurnRequest, AgentTurnResponse, AppState, DemoCallState, DemoCallTrigger, EvenRelayPayload, InboundMessage, Rescue, RescueCreate, VoiceReply, VoiceTurn, ZiloEvent, ZiloRingEvent
from .orchestrator import Orchestrator
from .stepfun_agent import StepFunAgent, StepFunApi
from .store import Store


settings = get_settings()
compare_secret = secrets.compare_digest
store = Store(settings.database_path)
orchestrator = Orchestrator(store, settings)
agent_service = WingmanAgentService(
    StepFunAgent(
        StepFunApi(
            settings.stepfun_api_key,
            base_url=settings.stepfun_base_url,
            model=settings.stepfun_agent_model,
        )
    ),
    Go2McpClient(settings.dimos_mcp_url),
)


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
    return {
        "ok": True,
        "photon_mode": "live" if orchestrator.photon.live else "demo",
        "calling_enabled": orchestrator.phone.enabled,
        "stepfun_configured": bool(settings.stepfun_api_key),
        "stepfun_model": settings.stepfun_agent_model,
        "dimos_mcp_url": settings.dimos_mcp_url,
    }


async def proxy_to_local_relay(path: str, request: Request, client) -> Response:
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in {"authorization", "content-type"}
    }
    upstream = await client.request(
        request.method,
        f"http://127.0.0.1:8788/{path}",
        content=await request.body(),
        headers=headers,
    )
    response_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
    }
    content_type = upstream.headers.get("content-type")
    if content_type:
        response_headers["Content-Type"] = content_type
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
    )


def create_local_relay_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=70, trust_env=False)


@app.api_route("/relay/{path:path}", methods=["POST", "OPTIONS"])
async def relay_proxy(path: str, request: Request):
    if request.method == "OPTIONS":
        return Response(
            status_code=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
            },
        )
    async with create_local_relay_client() as client:
        return await proxy_to_local_relay(path, request, client)


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
    # The phone WebView posts to the local relay; only that loopback relay may
    # reach this endpoint without the private dashboard API key.
    if request.client is None or request.client.host not in {"127.0.0.1", "::1"}:
        raise HTTPException(403, "The Even relay must run locally on this Mac.")

    source = payload.event.get("source")
    source_kind = source.get("kind") if isinstance(source, dict) else None
    action_name = payload.action.get("name") if payload.action else None
    if source_kind == "ring" and action_name == "ring_confirm_up":
        try:
            result = await agent_service.confirm_latest()
            return {"ok": True, "accepted": True, "agent_action": result}
        except ValueError as exc:
            return {"ok": False, "accepted": False, "reason": str(exc)}
        except httpx.HTTPError as exc:
            raise HTTPException(503, f"DimOS MCP is unavailable: {exc}") from exc
    if source_kind == "ring" and action_name == "ring_confirm_down":
        cancelled = agent_service.cancel_latest()
        return {
            "ok": cancelled,
            "accepted": cancelled,
            "reason": "Pending Go2 action cancelled." if cancelled else "Pending action not found.",
        }
    try:
        return await orchestrator.even_ring_event(payload)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/v1/hardware/zilo")
async def zilo_ring_relay(payload: ZiloRingEvent, request: Request):
    # Gesture recognition runs on this Mac next to the BLE ring. Keeping this
    # endpoint loopback-only prevents public callers from sending owner messages.
    if request.client is None or request.client.host not in {"127.0.0.1", "::1"}:
        raise HTTPException(403, "The Zilo ring recognizer must run locally on this Mac.")
    try:
        return await orchestrator.zilo_ring_gesture(payload)
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


@app.post("/api/v1/agent/turn", response_model=AgentTurnResponse, dependencies=[Depends(auth)])
async def agent_turn(turn: AgentTurnRequest):
    try:
        return await agent_service.turn(turn.text)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(502, f"Agent planning failed: {exc}") from exc


@app.post("/api/v1/agent/confirm", response_model=AgentTurnResponse, dependencies=[Depends(auth)])
async def agent_confirm(request: AgentConfirmRequest):
    try:
        return await agent_service.confirm(request.action_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(503, f"DimOS MCP is unavailable: {exc}") from exc


@app.post("/api/v1/photon/inbound", dependencies=[Depends(auth)])
async def photon_inbound(message: InboundMessage):
    return {"reply": await orchestrator.inbound(message.sender, message.text)}


@app.post("/api/v1/call", dependencies=[Depends(auth)])
async def call():
    try:
        return {"call_sid": await orchestrator.call_user("dashboard")}
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
