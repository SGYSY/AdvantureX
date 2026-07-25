#!/usr/bin/env python3
"""Web control panel backend for the DimOS Go2.

Serves a Chinese control panel (static/index.html) and bridges browser input to
the running DimOS instance:

- Movement: publishes ``geometry_msgs/Twist`` to ``/cmd_vel`` using the active
  transport (Zenoh on macOS, LCM elsewhere) via DimOS' ``make_transport``.
- Actions: sends ``sport_command(api_id)`` over RPC to the running
  ``GO2Connection`` (same mechanism as scripts/trigger_dance.py).

A background publisher pushes the latest teleop twist at a fixed rate with a
deadman watchdog: if no update arrives within ``DEADMAN_TIMEOUT`` seconds the
robot is commanded to stop. This keeps the dog from running away if the browser
tab is closed or the network hiccups.

Run (with the DimOS venv active, DimOS already running for real control):
    python scripts/go2_web/server.py --host 0.0.0.0 --port 811
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

# Make the sibling scripts/ package importable (go2_actions lives one level up).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn  # noqa: E402
from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from go2_actions import action_catalog, resolve_action  # noqa: E402

STATIC_DIR = Path(__file__).resolve().parent / "static"

PUBLISH_RATE_HZ = 30.0
DEADMAN_TIMEOUT = 0.4  # seconds without an update before commanding stop
# Bounded timeout for action RPCs so a missing/unreachable DimOS fails fast with
# a clear message instead of hanging the request (and the browser) forever.
ACTION_RPC_TIMEOUT = 6.0
# Clamp incoming teleop values to sane bounds (m/s, rad/s).
MAX_LINEAR = 1.2
MAX_ANGULAR = 2.5


def _clamp(v: float, limit: float) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(-limit, min(limit, v))


class RobotBridge:
    """Owns the cmd_vel publisher thread and the RPC action client."""

    def __init__(self) -> None:
        self._twist_vals = (0.0, 0.0, 0.0)  # (vx, vy, wz)
        self._last_update = 0.0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

        self._transport: Any = None
        self._Twist: Any = None
        self._Vector3: Any = None

        self._rpc_client: Any = None
        self._rpc_lock = threading.Lock()

    # -- lifecycle -----------------------------------------------------------
    def start(self) -> None:
        from dimos.core.transport_factory import make_transport
        from dimos.msgs.geometry_msgs.Twist import Twist
        from dimos.msgs.geometry_msgs.Vector3 import Vector3

        self._Twist = Twist
        self._Vector3 = Vector3
        self._transport = make_transport("/cmd_vel", Twist)
        self._transport.start()

        self._thread = threading.Thread(target=self._publish_loop, name="cmd_vel-pub", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)
        # Best-effort: park the robot before tearing down.
        if self._transport is not None:
            try:
                for _ in range(5):
                    self._transport.broadcast(None, self._Twist.zero())
                    time.sleep(0.01)
                self._transport.stop()
            except Exception:
                pass
        if self._rpc_client is not None:
            try:
                self._rpc_client.stop_rpc_client()
            except Exception:
                pass

    # -- teleop --------------------------------------------------------------
    def set_twist(self, vx: float, vy: float, wz: float) -> tuple[float, float, float]:
        vals = (_clamp(vx, MAX_LINEAR), _clamp(vy, MAX_LINEAR), _clamp(wz, MAX_ANGULAR))
        with self._lock:
            self._twist_vals = vals
            self._last_update = time.monotonic()
        return vals

    def halt(self) -> None:
        with self._lock:
            self._twist_vals = (0.0, 0.0, 0.0)
            self._last_update = time.monotonic()

    def _current_or_zero(self) -> tuple[float, float, float]:
        with self._lock:
            if time.monotonic() - self._last_update > DEADMAN_TIMEOUT:
                return (0.0, 0.0, 0.0)
            return self._twist_vals

    def _publish_loop(self) -> None:
        period = 1.0 / PUBLISH_RATE_HZ
        while not self._stop.is_set():
            vx, vy, wz = self._current_or_zero()
            try:
                twist = self._Twist(self._Vector3(vx, vy, 0.0), self._Vector3(0.0, 0.0, wz))
                self._transport.broadcast(None, twist)
            except Exception:
                # Keep the loop alive; transport hiccups shouldn't kill teleop.
                pass
            time.sleep(period)

    # -- actions -------------------------------------------------------------
    def _get_rpc(self) -> Any:
        # Lazy: only build the RPC client on first action so the server can
        # start even before DimOS is up.
        if self._rpc_client is None:
            with self._rpc_lock:
                if self._rpc_client is None:
                    from dimos.core.rpc_client import RPCClient
                    from dimos.robot.unitree.go2.connection import GO2Connection

                    self._rpc_client = RPCClient.remote(GO2Connection)
        return self._rpc_client

    def send_action(self, name: str, api_id: int) -> dict[str, object]:
        # Call the RPC layer directly with an explicit timeout. The high-level
        # RpcCall proxy uses the (long) default timeout and would block the
        # request thread indefinitely when no DimOS is listening.
        try:
            client = self._get_rpc()
            topic = f"{client.remote_name}/sport_command"
            with self._rpc_lock:
                result, unsub = client.rpc.call_sync(
                    topic, ((api_id,), {}), rpc_timeout=ACTION_RPC_TIMEOUT
                )
            try:
                unsub()
            except Exception:
                pass
            return {"ok": True, "name": name, "id": api_id, "result": str(result)}
        except TimeoutError:
            return {
                "ok": False,
                "name": name,
                "id": api_id,
                "error": "RPC 超时：本机没有运行 DimOS（需 dimos run unitree-go2-basic）",
            }
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "name": name, "id": api_id, "error": str(e)}

    def enable_locomotion(self) -> dict[str, object]:
        """Enable the firmware joystick listener used by cmd_vel teleop."""
        try:
            client = self._get_rpc()
            topic = f"{client.remote_name}/switch_joystick"
            with self._rpc_lock:
                result, unsub = client.rpc.call_sync(
                    topic, ((True,), {}), rpc_timeout=ACTION_RPC_TIMEOUT
                )
            try:
                unsub()
            except Exception:
                pass
            return {"ok": True, "enabled": True, "result": str(result)}
        except TimeoutError:
            return {
                "ok": False,
                "enabled": False,
                "error": "RPC 超时：无法启用 Go2 行走控制",
            }
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "enabled": False, "error": str(e)}


bridge = RobotBridge()


@asynccontextmanager
async def lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
    bridge.start()
    try:
        yield
    finally:
        bridge.stop()


app = FastAPI(title="Go2 控制台", lifespan=lifespan)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/actions")
def actions() -> JSONResponse:
    return JSONResponse(action_catalog())


@app.post("/api/action/{token}")
def do_action(token: str) -> JSONResponse:
    resolved = resolve_action(token)
    if resolved is None:
        return JSONResponse({"ok": False, "error": f"未知动作 {token!r}"}, status_code=400)
    name, api_id = resolved
    return JSONResponse(bridge.send_action(name, api_id))


@app.post("/api/stop")
def stop_move() -> JSONResponse:
    bridge.halt()
    return JSONResponse({"ok": True})


@app.post("/api/locomotion/enable")
def enable_locomotion() -> JSONResponse:
    return JSONResponse(bridge.enable_locomotion())


@app.websocket("/ws/teleop")
async def teleop(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            vx, vy, wz = bridge.set_twist(
                data.get("vx", 0.0), data.get("vy", 0.0), data.get("wz", 0.0)
            )
            await ws.send_json({"vx": vx, "vy": vy, "wz": wz})
    except WebSocketDisconnect:
        bridge.halt()
    except Exception:
        bridge.halt()


def main() -> int:
    parser = argparse.ArgumentParser(description="Go2 中文 Web 控制台")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0，方便局域网访问）")
    parser.add_argument("--port", type=int, default=8011, help="端口（默认 8011）")
    args = parser.parse_args()

    if not (STATIC_DIR / "index.html").exists():
        print(f"错误：找不到 {STATIC_DIR / 'index.html'}", file=sys.stderr)
        return 1

    # Serve any additional static assets (none required today, but future-proof).
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    print(f"Go2 控制台启动： http://{args.host}:{args.port}  (Ctrl-C 退出)")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
