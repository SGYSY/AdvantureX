# SNAKE1 stationary Go2 integration

This blueprint connects Wingman to a real Go2 through DimOS MCP without adding
another LLM inside DimOS. StepFun remains the only Agent brain.

The MCP surface is intentionally limited to:

- `snake1_stationary_greeting`: `Hello` or `Sit`, plus a short local opener
- `snake1_neutral_pose`: stop, then balanced standing
- `snake1_emergency_stop`: stop base movement immediately

There is no navigation, raw velocity, following, jumping, flipping, or dancing
tool in this blueprint. Non-emergency physical actions require a one-time
Wingman `action_id` confirmation.

The current Even gesture protocol already provides confirmation without a
glasses-code change: `ring_confirm_up` confirms the latest proposal and
`ring_confirm_down` cancels it. Ring double-click remains reserved for P0 rescue.

## Start safely

Connect Mac Wi-Fi to the Go2 AP first. Keep iPhone USB connected for StepFun
internet access. Put the local AES key in `wingman/.env`, then run:

```bash
python scripts/start_snake1.py --check --with-go2
python scripts/start_snake1.py --with-go2
```

The launcher refuses to start Go2 unless:

- `en0` has a `192.168.12.x` address
- the route to `192.168.12.1` uses `en0`
- `192.168.12.1` responds to ping
- the AES key is present

It also raises the child-process file descriptor limit. If DimOS reports a
missing LCM multicast route, add the route for `224.0.0.0/4` on `en0` before
the demo; this system-level change is deliberately not made automatically.
