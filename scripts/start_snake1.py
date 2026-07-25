#!/usr/bin/env python3
"""Start the local SNAKE1 control plane without touching existing web code."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import resource
import shutil
import signal
import socket
import subprocess
import sys
import time


GO2_IP = "192.168.12.1"


def go2_route_is_safe(
    mac_wifi_ip: str,
    interface: str,
    multicast_interface: str,
    ping_ok: bool,
) -> bool:
    return (
        mac_wifi_ip.startswith("192.168.12.")
        and interface == "en0"
        and multicast_interface == "en0"
        and ping_ok
    )


def _run_text(command: list[str]) -> tuple[int, str]:
    result = subprocess.run(command, capture_output=True, text=True, timeout=5)
    return result.returncode, (result.stdout + result.stderr).strip()


def _route_interface(target: str) -> str:
    _, output = _run_text(["/sbin/route", "-n", "get", target])
    for line in output.splitlines():
        if line.strip().startswith("interface:"):
            return line.split(":", 1)[1].strip()
    return ""


def inspect_go2_network() -> tuple[bool, dict[str, str]]:
    _, wifi_name = _run_text(["/usr/sbin/networksetup", "-getairportnetwork", "en0"])
    _, wifi_ip = _run_text(["/usr/sbin/ipconfig", "getifaddr", "en0"])
    interface = _route_interface(GO2_IP)
    multicast_interface = _route_interface("224.0.0.1")
    ping_code, _ = _run_text(["/sbin/ping", "-c", "1", "-W", "1000", GO2_IP])
    details = {
        "wifi": wifi_name,
        "wifi_ip": wifi_ip,
        "go2_route": interface,
        "multicast_route": multicast_interface,
        "go2_ping": "ok" if ping_code == 0 else "failed",
    }
    return go2_route_is_safe(
        wifi_ip,
        interface,
        multicast_interface,
        ping_code == 0,
    ), details


def find_adx_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / ".venv" / "bin" / "python").is_file() and (
            candidate / "dimos" / "dimos"
        ).is_dir():
            return candidate
    raise RuntimeError("Could not find the adx26 root containing even/ and dimos/")


def find_even_relay_root(adx_root: Path) -> Path:
    override = os.environ.get("SNAKE1_EVEN_ROOT")
    candidates = [
        Path(override).expanduser() if override else None,
        adx_root / ".worktrees" / "snake1-realtime-copilot" / "even",
        adx_root / "even",
    ]
    for candidate in candidates:
        if candidate and (candidate / "tools" / "relay-server.mjs").is_file():
            return candidate
    raise RuntimeError(
        "Could not find the active Even relay. Set SNAKE1_EVEN_ROOT explicitly."
    )


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def raise_file_limit() -> int:
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    target = min(65536, hard)
    if soft < target:
        resource.setrlimit(resource.RLIMIT_NOFILE, (target, hard))
    return resource.getrlimit(resource.RLIMIT_NOFILE)[0]


def preflight(
    wingman_root: Path,
    adx_root: Path,
    even_root: Path,
    with_go2: bool,
    with_tunnel: bool = True,
) -> list[str]:
    errors: list[str] = []
    env = {**read_env(wingman_root / ".env"), **os.environ}
    even_env = read_env(even_root / ".env")
    if not env.get("STEPFUN_API_KEY"):
        errors.append("STEPFUN_API_KEY is missing from wingman/.env")
    binaries = ["npm"] + (["cloudflared"] if with_tunnel else [])
    for binary in binaries:
        if not shutil.which(binary):
            errors.append(f"Required binary not found: {binary}")
    if not even_env.get("RELAY_ACCESS_TOKEN"):
        errors.append("RELAY_ACCESS_TOKEN is missing from the active Even .env")
    if not even_env.get("STEPFUN_API_KEY"):
        errors.append("STEPFUN_API_KEY is missing from the active Even .env")
    if not even_env.get("WINGMAN_SHARED_SECRET"):
        errors.append("WINGMAN_SHARED_SECRET is missing from the active Even .env")
    if env.get("WINGMAN_SHARED_SECRET") != even_env.get("WINGMAN_SHARED_SECRET"):
        errors.append("Wingman and Even WINGMAN_SHARED_SECRET values do not match")
    if even_env.get("FORWARD_URL") != "http://127.0.0.1:8000/api/v1/hardware/even":
        errors.append("Active Even FORWARD_URL must target the local Wingman hardware endpoint")
    if with_go2:
        if env.get("ROBOT_IP", GO2_IP) != GO2_IP:
            errors.append(f"ROBOT_IP must be {GO2_IP} in AP mode")
        if not env.get("UNITREE_AES_128_KEY"):
            errors.append("UNITREE_AES_128_KEY is missing from wingman/.env")
        safe, details = inspect_go2_network()
        print(
            "Go2 network:"
            f" Wi-Fi={details['wifi']!r}, IP={details['wifi_ip'] or '-'},"
            f" route={details['go2_route'] or '-'}, ping={details['go2_ping']}"
            f", multicast={details['multicast_route'] or '-'}"
        )
        if not safe:
            errors.append(
                "Go2 AP safety check failed: en0 must have 192.168.12.x, "
                "routes for 192.168.12.1 and multicast must use en0, "
                "and ping must succeed"
            )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Start SNAKE1 Wingman locally")
    parser.add_argument("--check", action="store_true", help="Run checks only")
    parser.add_argument(
        "--with-go2",
        action="store_true",
        help="Also start the stationary DimOS Go2 MCP blueprint",
    )
    parser.add_argument("--no-tunnel", action="store_true", help="Do not start Cloudflare")
    args = parser.parse_args()

    wingman_root = Path(__file__).resolve().parents[1]
    adx_root = find_adx_root(wingman_root)
    even_root = find_even_relay_root(adx_root)
    python = adx_root / ".venv" / "bin" / "python"
    if not python.is_file():
        print(f"ERROR: Python environment not found: {python}", file=sys.stderr)
        return 2

    errors = preflight(
        wingman_root,
        adx_root,
        even_root,
        args.with_go2,
        not args.no_tunnel,
    )
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 2
    print("Preflight OK (credentials detected but never printed).")
    if args.check:
        return 0

    required_ports = [8000, 8788] + ([9990] if args.with_go2 else [])
    busy = [str(port) for port in required_ports if not port_is_free(port)]
    if busy:
        print(
            f"ERROR: required local port(s) already in use: {', '.join(busy)}",
            file=sys.stderr,
        )
        return 2

    nofile = raise_file_limit()
    print(f"File descriptor soft limit: {nofile}")
    child_env = {**read_env(wingman_root / ".env"), **os.environ}
    even_child_env = {**os.environ, **read_env(even_root / ".env")}
    children: list[subprocess.Popen] = []
    stop_requested = False
    children_stopped = False

    commands: list[tuple[str, list[str], Path, dict[str, str]]] = [
        (
            "Wingman",
            [
                str(python),
                "-m",
                "uvicorn",
                "app.main:app",
                "--app-dir",
                "backend",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            wingman_root,
            child_env,
        ),
        (
            "Even realtime relay",
            ["npm", "run", "relay"],
            even_root,
            even_child_env,
        ),
    ]
    if args.with_go2:
        commands.append(
            (
                "DimOS stationary Go2",
                [str(python), str(wingman_root / "hardware/go2/snake1_go2_tools.py")],
                wingman_root,
                child_env,
            )
        )
    if not args.no_tunnel:
        commands.append(
            (
                "Cloudflare quick tunnel",
                ["cloudflared", "tunnel", "--url", "http://127.0.0.1:8788"],
                wingman_root,
                child_env,
            )
        )

    def stop_children():
        nonlocal children_stopped
        if children_stopped:
            return
        children_stopped = True
        print("\nStopping SNAKE1 child processes...")
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 5
        for child in children:
            remaining = max(0, deadline - time.monotonic())
            try:
                child.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                child.kill()

    def request_stop(*_args):
        nonlocal stop_requested
        stop_requested = True
        stop_children()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    for name, command, cwd, env in commands:
        print(f"Starting {name}...")
        children.append(
            subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
        )

    print("Wingman: http://127.0.0.1:8000")
    print(f"Even realtime relay: {even_root}")
    print("Even local ingress: http://127.0.0.1:8788/even")
    if not args.no_tunnel:
        print("Append /even to the trycloudflare hostname and use the existing relay access token.")
    if not args.with_go2:
        print("Go2 was NOT started. Re-run with --with-go2 after the AP check passes.")

    try:
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
    finally:
        stop_children()
    if stop_requested:
        return 0
    failed = [(name, child.returncode) for (name, *_), child in zip(commands, children) if child.returncode]
    if failed:
        print(f"One or more processes exited: {failed}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
