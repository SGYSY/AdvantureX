# Wingman — private social-assist control plane

Wingman is a local-first FastAPI application for a discreet "rescue" workflow.
It currently implements the first four stages of the product plan:

- Zilo-compatible event gateway (`double_tap`, `long_press`, and voice input)
- deterministic orchestration, scheduling, cancellation, audit trail, and SQLite persistence
- Photon/Spectrum iMessage bridge, inbound message commands, and a browser simulation when credentials are absent
- viaim-style voice-first Rescue and Coach conversations with short, interruptible responses
- optional opt-in telephone escalation using Twilio
- StepFun Step Plan Agent planning with a confirmation-gated, stationary Go2
  tool surface over DimOS MCP

## Repository map

```text
backend/          FastAPI orchestration and local control dashboard
snakeone/         Spectrum/Photon iMessage Agent
docs/             GitHub Pages mobile call demo
hardware/ring/    Ring prototype firmware (ready for contributors)
hardware/glasses/ Glasses prototype firmware (ready for contributors)
hardware/go2/     Stationary real-Go2 skills and DimOS MCP blueprint
hardware/shared/  Shared device protocol code
```

Hardware contributors should start with the [event contract](docs/hardware-event-contract.md)
and [contribution guide](CONTRIBUTING.md). Device code sends normalized gestures
to the backend; it never contains Photon credentials.

The maintained public Even G2/R1 delivery is
[`hardware/even-relay`](hardware/even-relay). It is the same fail-closed source
as the standalone SNAKE ONE relay: new installs have an empty endpoint/token
and forwarding disabled; `/even` and `/social/*` require
`RELAY_ACCESS_TOKEN`; the loopback Wingman hop requires
`WINGMAN_SHARED_SECRET`.

```bash
cd hardware/even-relay
npm install
cp .env.example .env
# Fill local-only STEPFUN_API_KEY, RELAY_ACCESS_TOKEN, and WINGMAN_SHARED_SECRET.
npm run relay
```

The relay command requires `.env` and does not silently start without it.
For a temporary public tunnel, enter the newly generated HTTPS endpoint and
local relay token in the installed Even app. Update the endpoint after every
tunnel restart; no temporary domain is embedded in this repository.

## Quick start

```bash
conda activate wingman-photon
cp .env.example .env
uvicorn app.main:app --app-dir backend --reload
```

Open <http://127.0.0.1:8000>. The application starts in demo mode, so a rescue can be scheduled and its message delivery simulated without any credentials.

## SNAKE1 local Agent + ring relay + optional Go2

The local topology is:

```text
Even ring -> Cloudflare -> Even relay :8788 -> Wingman :8000
                                              |
                                    StepFun Step Plan
                                              |
                                confirmed stationary tool
                                              |
                                      DimOS MCP :9990 -> Go2
```

The launcher automatically prefers the active glasses relay at
`/Users/wujiajun/Downloads/adx26/.worktrees/snake1-realtime-copilot/even` and
does not modify that worktree. Its existing `RELAY_ACCESS_TOKEN` protects the
public first hop, while `WINGMAN_SHARED_SECRET` protects Relay → Wingman.

Run the hidden-input configurator and paste a newly generated Wingman StepFun
key plus the existing Go2 AES key. It copies the already configured
`WINGMAN_SHARED_SECRET` from the active Even `.env` without printing it. The
resulting Wingman `.env` is ignored by Git and written with mode `600`:

```bash
python scripts/configure_snake1.py
```

Run a non-mutating preflight:

```bash
python scripts/start_snake1.py --check
python scripts/start_snake1.py --check --with-go2
```

Start the local Agent, ring relay, and a temporary Cloudflare tunnel:

```bash
python scripts/start_snake1.py
```

After the Go2 AP preflight passes, start the stationary DimOS MCP blueprint too:

```bash
python scripts/start_snake1.py --with-go2
```

The launcher prints a temporary Cloudflare hostname. Add `/even` and use the
active Even relay's existing access token in the phone console. Quick-tunnel
hostnames can change on every launch. The glasses Relay remains the owner of
StepAudio realtime sessions; Wingman uses `step-3.5-flash` only for Agent/tool
planning, so the two backends do not duplicate the audio pipeline.

Agent API:

- `POST /api/v1/agent/turn` with `{"text":"让狗打个招呼"}` plans an action.
- If `requires_confirmation` is true, display the returned action and require
  the user to approve it.
- `POST /api/v1/agent/confirm` with the returned `action_id` executes that exact
  action once. Reuse is rejected.
- Without changing the current glasses code, its existing `上滑 → 单击`
  (`ring_confirm_up`) gesture confirms the latest proposal; `下滑 → 单击`
  cancels it. Ring double-click remains the P0 rescue trigger.
- Emergency stop executes immediately.

See [hardware/go2/README.md](hardware/go2/README.md) for the stationary safety
boundary. This integration does not modify the glasses implementation or the
existing dashboard UI.

The committed `environment.yml` creates the isolated environment used by this project:

```bash
conda env create -f environment.yml
conda activate wingman-photon
```

## Real Photon iMessage and web-initiated DMs

The `snakeone` Spectrum Agent owns the real iMessage identity. It also exposes
a localhost-only control endpoint for this dashboard, so a webpage request can
cold-start a direct message to a phone number or Apple ID.

1. Create the root `.env` from `.env.example` and set:

   ```env
   USER_PHONE_NUMBER=+8613812345678
   PHOTON_BRIDGE_URL=http://127.0.0.1:8787
   WINGMAN_SHARED_SECRET=
   ```

   Generate a long random local value and fill it after copying the example;
   keep the committed placeholder empty.

2. In `snakeone/.env`, keep the Photon-generated `PROJECT_ID` and
   `PROJECT_SECRET`, then add the exact same `WINGMAN_SHARED_SECRET` and:

   ```env
   WINGMAN_PORT=8787
   ```

3. Start both processes in separate terminals. In each terminal, first run
   `conda activate wingman-photon`:

   ```bash
   # Terminal 1
   cd /Users/yansiyu/project/advanturex/snakeone
   npm run start

   # Terminal 2
   cd /Users/yansiyu/project/advanturex
   uvicorn app.main:app --app-dir backend --reload
   ```

Open <http://127.0.0.1:8000>. The **主动私聊** panel schedules a real
Spectrum iMessage DM from the Agent. The recipient must be allowed by the
Photon line configuration; shared lines normally require the recipient to be
added in the Photon dashboard first.

## Mobile incoming-call demo

Open <http://127.0.0.1:8000/mobile> on your phone (on the same Wi-Fi, use your
Mac's LAN address instead of `127.0.0.1`). Tap **模拟眼镜 / 戒指双击**. The flow is:

1. The backend asks the Spectrum Agent to send the iMessage.
2. Five seconds later the web call screen rings with its bundled ringtone.
3. Tap **接听** to play the bundled Chinese reminder, or choose your own MP3
   before starting. Your selected recording stays in that browser and is never
   uploaded to the server.

The web call is intentionally a visual/audio demo, not a disguised PSTN call.
The separate Twilio section below is the route for a real phone call.

### GitHub Pages front end

The `docs/` folder is ready for GitHub Pages and includes a publishing workflow.
GitHub Pages can host the mobile screen and its audio files, but **cannot safely
hold Photon credentials or send iMessages by itself**. Before publishing for a
real live demo, deploy this FastAPI backend privately, put its HTTPS URL in
`docs/config.js` as `WINGMAN_API_BASE`, and add the Pages origin to the backend:

```env
CORS_ORIGINS=https://YOUR_GITHUB_NAME.github.io
```

Leave `WINGMAN_API_BASE` blank only for a visual/static preview; the double-tap
button then has no private service through which to send the iMessage.
After pushing this project to a GitHub repository, enable **Settings → Pages →
Source: GitHub Actions**. The included workflow publishes `docs/` whenever
`main` changes.

## Telephone escalation

Calling is disabled by default. To enable it, set `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `USER_PHONE_NUMBER`, and a public
HTTPS `CALL_AUDIO_URL`. The repository includes
`backend/app/static/wingman-call.wav`, a short Chinese Wingman reminder. Serve
it publicly (for example, through a temporary HTTPS tunnel or deployment) and
set `CALL_AUDIO_URL=https://your-public-host/static/wingman-call.wav`. A call
is only placed after the account holder explicitly clicks **确认后呼叫我** in the
dashboard. It plays that fixed audio once, then hangs up.

### Publishing the call audio for a local demo

Twilio cannot reach `127.0.0.1`. Serve only the fixed audio directory in a
third terminal, then create a temporary public HTTPS address in a fourth:

```bash
# Terminal 3: does not expose the dashboard or its API
cd /Users/yansiyu/project/advanturex/backend/app/static
python3 -m http.server 8080 --bind 127.0.0.1

# Terminal 4
brew install cloudflared # only needed once
cloudflared tunnel --url http://127.0.0.1:8080
```

Copy the temporary HTTPS address it prints, then place this in the root `.env`
and restart Uvicorn:

```env
CALL_AUDIO_URL=https://<temporary-host>/wingman-call.wav
```

For a persistent deployment, host the same WAV (or any public MP3/WAV) on a
public HTTPS host instead of a temporary tunnel.

## Device integration endpoints

- `POST /api/v1/events/zilo` — ring gateway; send `{"kind":"double_tap"}`
- `POST /api/v1/hardware/even` — loopback-only Even relay gateway
- `POST /api/v1/voice/turn` — viaim / headset text turn
- `POST /api/v1/photon/inbound` — bridge webhook for incoming iMessages
- `POST /api/v1/rescues` — create a rescue from any client

All endpoints use `X-Wingman-Key` when `API_KEY` is set. For a browser deployment, place the API behind an authenticated gateway; do not expose a production API key in client-side code.

The Even hardware gateway has a separate fail-closed boundary. Set a non-empty
`WINGMAN_SHARED_SECRET` in this repository's root `.env`, set the same local
value in the Even relay environment, and run the relay on `127.0.0.1:8788`.
The relay sends `X-Wingman-Secret`; Wingman returns `503` when its secret is
unconfigured, `403` for a wrong secret or non-loopback caller, and only then
processes the event. Do not put this server-to-server secret in the Even phone
UI.

## Safety model

The sender must own the configured target number and use a pre-consented contact thread. Default messages say that the user requested a reminder; they do not fabricate a workplace emergency. The dashboard exposes cancellation until execution and logs all device actions.
