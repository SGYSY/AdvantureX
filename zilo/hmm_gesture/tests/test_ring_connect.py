import asyncio
import unittest

from ring_connect import retry_async, select_ring
from ring_sdk.ring_sound import NusClient


class Advertisement:
    def __init__(self, name, service_uuids, rssi):
        self.local_name = name
        self.service_uuids = service_uuids
        self.rssi = rssi


class Device:
    def __init__(self, name, address):
        self.name = name
        self.address = address


class RingSelectionTests(unittest.TestCase):
    def test_selects_strongest_named_ring_with_nus_service(self):
        nus = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
        candidates = [
            (Device(None, "weak"), Advertisement("ring", [nus], -80)),
            (Device(None, "other"), Advertisement("speaker", [nus], -30)),
            (Device(None, "wrong-service"), Advertisement("ring", ["1234"], -20)),
            (Device(None, "strong"), Advertisement("RING", [nus.upper()], -55)),
        ]

        device, advertisement = select_ring(candidates)

        self.assertEqual(device.address, "strong")
        self.assertEqual(advertisement.rssi, -55)

    def test_nus_client_accepts_scanned_device_without_rescanning(self):
        device = Device("ring", "cached-uuid")

        transport = NusClient(device=device)

        self.assertIs(transport.device, device)
        self.assertEqual(transport.address, "cached-uuid")

    def test_accepts_unnamed_device_when_it_advertises_nus(self):
        nus = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
        candidate = (Device(None, "unnamed-ring"), Advertisement(None, [nus], -60))

        device, _ = select_ring([candidate])

        self.assertEqual(device.address, "unnamed-ring")


class RetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_with_exponential_backoff(self):
        attempts = 0
        delays = []

        async def operation():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise RuntimeError("not ready")
            return "connected"

        async def record_sleep(delay):
            delays.append(delay)

        result = await retry_async(
            operation,
            attempts=3,
            initial_delay=1.0,
            sleep=record_sleep,
        )

        self.assertEqual(result, "connected")
        self.assertEqual(attempts, 3)
        self.assertEqual(delays, [1.0, 2.0])


if __name__ == "__main__":
    unittest.main()
