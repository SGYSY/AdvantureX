"""Reliable macOS BLE discovery and connection check for the Zilo ring."""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Awaitable, Callable, Iterable
from typing import Any, TypeVar

from bleak import BleakScanner

from ring_sdk import ring_sound as sdk


NUS_SERVICE_UUID = sdk.NUS_SERVICE_UUID.lower()
T = TypeVar("T")


def select_ring(candidates: Iterable[tuple[Any, Any]]) -> tuple[Any, Any]:
    """Return a NUS ring, preferring an explicit ``ring`` device name."""
    matches = []
    for device, advertisement in candidates:
        name = advertisement.local_name or device.name or ""
        services = {
            service.lower() for service in (advertisement.service_uuids or [])
        }
        if NUS_SERVICE_UUID in services and name.lower() in {"", "ring"}:
            matches.append((device, advertisement))
    if not matches:
        raise RuntimeError("未找到提供 NUS 服务的戒指")
    return max(
        matches,
        key=lambda item: (
            (item[1].local_name or item[0].name or "").lower() == "ring",
            item[1].rssi or -999,
        ),
    )


async def retry_async(
    operation: Callable[[], Awaitable[T]],
    *,
    attempts: int,
    initial_delay: float,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    """Retry an async operation with exponential backoff."""
    if attempts < 1:
        raise ValueError("attempts must be at least 1")
    delay = initial_delay
    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except Exception:
            if attempt == attempts:
                raise
            await sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


async def discover_ring(scan_seconds: float) -> tuple[Any, Any]:
    print(f"扫描戒指（{scan_seconds:g} 秒）...")
    found = await BleakScanner.discover(timeout=scan_seconds, return_adv=True)
    print(f"扫描已停止，共发现 {len(found)} 个 BLE 设备")
    device, advertisement = select_ring(found.values())
    print(
        f"目标: name={advertisement.local_name or device.name!r} "
        f"uuid={device.address} rssi={advertisement.rssi}"
    )
    return device, advertisement


async def read_ring_info(
    device: Any,
    *,
    settle_seconds: float,
    attempts: int,
) -> sdk.SystemInfo:
    attempt_number = 0

    async def connect_once() -> sdk.SystemInfo:
        nonlocal attempt_number
        attempt_number += 1
        transport = sdk.NusClient(device=device)
        ring = sdk.RingSoundClient(transport=transport)
        try:
            print(f"连接尝试 {attempt_number}/{attempts}...")
            await ring.connect()
            print(f"BLE 已连接，等待 {settle_seconds:g} 秒就绪...")
            await asyncio.sleep(settle_seconds)
            info = await sdk.get_system_info(ring)
            print("系统信息读取成功")
            return info
        finally:
            await ring.disconnect()

    return await retry_async(
        connect_once,
        attempts=attempts,
        initial_delay=1.0,
    )


async def async_main(args: argparse.Namespace) -> None:
    device, _ = await discover_ring(args.scan_seconds)
    await asyncio.sleep(args.post_scan_delay)
    info = await read_ring_info(
        device,
        settle_seconds=args.settle_seconds,
        attempts=args.attempts,
    )
    print(f"model: {info.model}")
    print(f"firmware: {info.firmware_version}")
    print(f"battery: {info.battery_percent}%")
    print(f"uuid: {device.address}")


def main() -> None:
    parser = argparse.ArgumentParser(description="可靠扫描并连接 Zilo 戒指")
    parser.add_argument("--scan-seconds", type=float, default=12.0)
    parser.add_argument("--post-scan-delay", type=float, default=2.0)
    parser.add_argument("--settle-seconds", type=float, default=2.0)
    parser.add_argument("--attempts", type=int, default=3)
    args = parser.parse_args()
    asyncio.run(async_main(args))


if __name__ == "__main__":
    main()
