#!/usr/bin/env python3
"""Interactively create the ignored Wingman .env without shell-history leaks."""

from __future__ import annotations

from getpass import getpass
import os
from pathlib import Path

try:
    from .start_snake1 import find_adx_root, find_even_relay_root, read_env
except ImportError:
    from start_snake1 import find_adx_root, find_even_relay_root, read_env


def update_env_text(text: str, updates: dict[str, str]) -> str:
    remaining = dict(updates)
    output: list[str] = []
    for line in text.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in remaining:
                output.append(f"{key}={remaining.pop(key)}")
                continue
        output.append(line)
    if remaining and output and output[-1]:
        output.append("")
    output.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(output) + "\n"


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    adx_root = find_adx_root(root)
    even_root = find_even_relay_root(adx_root)
    even_values = read_env(even_root / ".env")
    env_path = root / ".env"
    template_path = root / ".env.example"
    current = (
        env_path.read_text()
        if env_path.is_file()
        else template_path.read_text()
    )
    current_values = {
        line.split("=", 1)[0].strip(): line.split("=", 1)[1].strip()
        for line in current.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }

    print("Paste credentials at the hidden prompts; they are not echoed.")
    stepfun_key = getpass("New StepFun API key (blank keeps current): ").strip()
    aes_key = getpass("Go2 AES key (blank keeps current): ").strip()
    updates = {
        "ROBOT_IP": "192.168.12.1",
        "STEPFUN_API_KEY": stepfun_key or current_values.get("STEPFUN_API_KEY", ""),
        "UNITREE_AES_128_KEY": aes_key
        or current_values.get("UNITREE_AES_128_KEY", ""),
        "WINGMAN_SHARED_SECRET": even_values.get("WINGMAN_SHARED_SECRET", ""),
    }
    if not updates["STEPFUN_API_KEY"]:
        print("No StepFun key saved; run this configurator again with a rotated key.")
        return 2
    if not updates["WINGMAN_SHARED_SECRET"]:
        print("Active Even .env has no WINGMAN_SHARED_SECRET; configure it first.")
        return 2

    env_path.write_text(update_env_text(current, updates))
    os.chmod(env_path, 0o600)
    print(f"Saved private configuration to {env_path} (mode 600).")
    print("Next: python scripts/start_snake1.py --check")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
