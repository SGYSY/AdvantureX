# SNAKE1 Final Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a truthful, judge-friendly, bilingual SNAKE1 submission on the public `final` branch of `SGYSY/AdvantureX`.

**Architecture:** Keep one demonstrable closed loop—physical trigger → personal Agent → authorized Skill → real-world output—as the lead story. Integrate the already-developed Zilo gesture pipeline and stationary DimOS/Go2 adapter into the latest hardware branch, then document Photon, Zilo, Dimensional, and Future Intelligence as four interfaces to the same platform.

**Tech Stack:** FastAPI, SQLite, TypeScript, Photon Spectrum/iMessage, Zilo BLE + HMM gestures, Even Hub, StepFun realtime audio, DimOS MCP, Unitree Go2, Twilio optional escalation.

## Global Constraints

- The P0 demo must remain independently runnable without the headset or robot dog.
- Do not claim that a browser-simulated incoming call is a PSTN call.
- Distinguish verified integrations from optional or adapter-ready paths.
- Keep credentials and phone numbers out of Git.
- Preserve the existing `main`, `hardware`, and contributor branches; publish only to the new `final` branch.
- Provide complete English and Chinese versions as `README.md` and `README.zh.md`.

---

### Task 1: Integrate the selected sponsor-track implementations

**Files:**
- Integrate: `zilo/hmm_gesture/**`
- Modify: `backend/app/main.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/orchestrator.py`
- Create: `backend/app/agent_service.py`
- Create: `backend/app/go2_mcp.py`
- Create: `backend/app/stepfun_agent.py`
- Create: `hardware/go2/**`
- Create: `scripts/configure_snake1.py`
- Create: `scripts/start_snake1.py`
- Modify: `.env.example`
- Test: `backend/tests/test_*.py`
- Test: `zilo/hmm_gesture/tests/test_*.py`

**Interfaces:**
- Consumes: normalized Zilo gesture events, the existing FastAPI orchestration layer, StepFun chat completions, and a local DimOS MCP endpoint.
- Produces: `POST /api/v1/events/zilo`, a stationary/safety-gated Go2 action adapter, and one launcher for the integrated demo.

- [ ] **Step 1: Apply the existing Zilo integration commit**

Run:

```bash
git cherry-pick b17d66f531c99f4adeb12394aeaecf952835ca38
```

Expected: Zilo HMM assets and bridge tests are added; resolve only conflicts against the newer hardware branch.

- [ ] **Step 2: Apply the existing Go2 Agent commits**

Run:

```bash
git cherry-pick 40b1522323b62e5d6966f70baa12b0b5bbd134c4
git cherry-pick 65f1beb2e689a3f633205e29d7380b35e6fd6971
```

Expected: the stationary DimOS/Go2 adapter, StepFun Agent service, configuration helper, launcher, and tests are present. Keep the latest `hardware/even-relay` behavior when resolving overlaps.

- [ ] **Step 3: Verify the integrated backend and hardware**

Run:

```bash
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
PYTHONPATH=zilo/hmm_gesture .venv/bin/python -m pytest zilo/hmm_gesture/tests -q
node --test backend/tests/mobile_ui.test.mjs
(cd snakeone && npm ci && npx tsc --noEmit)
(cd photon-bridge && npm ci && npm run check)
npm test --prefix hardware/even-relay
npm run test:tools --prefix hardware/even-relay
npm run build --prefix hardware/even-relay
```

Expected: every suite exits `0`; the Even build completes.

### Task 2: Write the bilingual judge-facing README

**Files:**
- Replace: `README.md`
- Create: `README.zh.md`

**Interfaces:**
- Consumes: the verified repository structure and test results from Task 1.
- Produces: a 30-second product explanation, demo path, architecture, four-track fit, honest implementation status, quick start, safety model, and repository map.

- [ ] **Step 1: Replace the English README**

Write `README.md` with this order:

1. One-line value proposition and Chinese easter egg.
2. A five-step judge demo.
3. `Moment → Input → Agent → Skill → Output → Feedback` architecture.
4. Four selected tracks: Photon, Zilo, Dimensional, Future Intelligence.
5. Implemented/optional status matrix.
6. Fast demo-mode quick start and real integration setup links.
7. Safety and privacy boundary.
8. Test commands and repository map.
9. Link to `README.zh.md`.

- [ ] **Step 2: Add the complete Chinese README**

Mirror every material section from `README.md` in natural Chinese. Lead with “现实世界唤醒 Agent，Agent 回到现实世界帮你” and keep the P0 social-rescue story understandable before introducing platform vocabulary.

- [ ] **Step 3: Check README integrity**

Run:

```bash
test -f README.md
test -f README.zh.md
rg -n "Photon|Zilo|Dimensional|Future Intelligence" README.md
rg -n "Photon|弦指科技|Dimensional|未来智能" README.zh.md
rg -n "/Users/|PROJECT_SECRET=.+|API_KEY=.+" README.md README.zh.md
```

Expected: both files exist, all four tracks appear, and the final scan prints no local absolute paths or committed secret values.

### Task 3: Verify and publish the final branch

**Files:**
- Review: all changed files

**Interfaces:**
- Consumes: the integrated code and bilingual documentation.
- Produces: a public, pushable `final` branch with reproducible verification evidence.

- [ ] **Step 1: Review the final diff and secret surface**

Run:

```bash
git status --short
git diff --check
git diff --stat origin/hardware...HEAD
git grep -nE 'gho_[A-Za-z0-9]+|sk-[A-Za-z0-9]{16,}|PROJECT_SECRET=[^[:space:]]+' -- . ':!*.lock'
```

Expected: no whitespace errors and no credential matches.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
PYTHONPATH=zilo/hmm_gesture .venv/bin/python -m pytest zilo/hmm_gesture/tests -q
node --test backend/tests/mobile_ui.test.mjs
(cd snakeone && npm ci && npx tsc --noEmit)
(cd photon-bridge && npm ci && npm run check)
npm test --prefix hardware/even-relay
npm run test:tools --prefix hardware/even-relay
npm run build --prefix hardware/even-relay
```

Expected: all commands exit `0`.

- [ ] **Step 3: Commit the submission documentation**

Run:

```bash
git add README.md README.zh.md docs/superpowers/plans/2026-07-25-snake1-final-submission.md
git commit -m "docs: prepare bilingual SNAKE1 submission"
```

Expected: one documentation commit on `final`.

- [ ] **Step 4: Push the requested branch**

Run:

```bash
git push -u origin final
```

Expected: `origin/final` is created without force-pushing or changing `main`.
