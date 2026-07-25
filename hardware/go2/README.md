# Experimental SNAKE1 → Go2 scaffold

This directory is an **unverified integration attempt**, not a completed
hardware demo. The Even glasses path has not been connected to Dimensional or
Go2, and no Even event currently causes a robot action. The on-site Go2 demo is
manual teleoperation.

The code explores how Wingman could call a real Go2 through DimOS MCP without
adding another LLM inside DimOS. Unit tests cover the software policy and MCP
request shape only; they do not prove physical connectivity, autonomous
behavior, or an Even → Agent → Go2 closed loop.

The MCP surface is intentionally limited to:

- `snake1_stationary_greeting`: `Hello` or `Sit`, plus a short local opener
- `snake1_neutral_pose`: stop, then balanced standing
- `snake1_emergency_stop`: stop base movement immediately

There is no navigation, raw velocity, following, jumping, flipping, or dancing
tool in this blueprint. Non-emergency physical actions require a one-time
Wingman `action_id` confirmation.

The proposed mapping would reuse the current Even gesture protocol:
`ring_confirm_up` would confirm the latest proposal and `ring_confirm_down`
would cancel it, while ring double-click remains reserved for P0 rescue. This
mapping exists in software only and has not been validated on the combined
Even + DimOS + Go2 hardware path.

## Development preflight

The following commands are for continuing integration work. A successful
preflight is not evidence that the end-to-end hardware path works.

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
