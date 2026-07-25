import assert from 'node:assert/strict'
import test from 'node:test'
import { SocialSessionStore } from './social-session-store.mjs'

function createManualTimers() {
  const scheduled = []
  return {
    scheduled,
    setTimeout(callback, delay) {
      const task = { callback, delay, cleared: false }
      scheduled.push(task)
      return task
    },
    clearTimeout(task) {
      if (task) task.cleared = true
    },
    run(task) {
      if (!task.cleared) task.callback()
    },
  }
}

test('keeps chunk order and discards a finished session', async () => {
  const provider = {
    start: async () => {},
    appendCalls: [],
    append(value) { this.appendCalls.push(value) },
    finish: async () => JSON.stringify({
      engagement: 0.5,
      comfort: 0.5,
      reciprocity: 0.5,
      tension: 0.2,
      opportunity: 0.7,
      confidence: 0.8,
      trend: 'stable',
      topic: '展览',
      suggestion_line_1: '她提到了展览',
      suggestion_line_2: '问问最喜欢哪一件',
      reason: '话题有连续回应',
    }),
    close() {},
  }
  const store = new SocialSessionStore({ providerFactory: () => provider })
  const session = await store.start()
  store.append(session.id, 0, 'AQI=')
  store.append(session.id, 1, 'AwQ=')
  const state = await store.finish(session.id)
  assert.deepEqual(provider.appendCalls, ['AQI=', 'AwQ='])
  assert.equal(state.trend, 'stable')
  assert.equal(store.get(session.id), null)
})

test('allows a capture to use its full 15 seconds after the first chunk', async () => {
  let now = 1_000
  let finishCalls = 0
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => {
      finishCalls += 1
      return JSON.stringify(validInsight())
    },
    close() {},
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    now: () => now,
  })
  const session = await store.start()

  now = 20_000
  store.append(session.id, 0, 'AQI=')
  now = 34_999
  const insight = await store.finish(session.id)

  assert.equal(finishCalls, 1)
  assert.equal(insight.trend, 'stable')
})

test('expires an active capture at 15 seconds before another chunk', async () => {
  let now = 1_000
  let closed = false
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => '{}',
    close() { closed = true },
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    now: () => now,
  })
  const session = await store.start()
  now = 10_000
  store.append(session.id, 0, 'AQI=')
  now = 25_000

  assert.throws(() => store.append(session.id, 1, 'AwQ='), /expired/)
  assert.equal(closed, true)
  assert.equal(store.get(session.id), null)
})

test('allows finish during a two-second grace after the strict capture deadline', async () => {
  let now = 1_000
  let closed = false
  let finishCalls = 0
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => { finishCalls += 1; return JSON.stringify(validInsight()) },
    close() { closed = true },
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    now: () => now,
  })
  const session = await store.start()
  now = 10_000
  store.append(session.id, 0, 'AQI=')
  now = 26_999

  await store.finish(session.id)
  assert.equal(finishCalls, 1)
  assert.equal(closed, true)
  assert.equal(store.get(session.id), null)
})

function validInsight() {
  return {
    engagement: 0.5,
    comfort: 0.5,
    reciprocity: 0.5,
    tension: 0.2,
    opportunity: 0.7,
    confidence: 0.8,
    trend: 'stable',
    topic: '展览',
    suggestion_line_1: '她提到了展览',
    suggestion_line_2: '问问最喜欢哪一件',
    reason: '话题有连续回应',
  }
}

test('expires and deletes a capture at the end of the two-second finish grace', async () => {
  let now = 1_000
  let closed = false
  let finishCalls = 0
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => { finishCalls += 1; return '{}' },
    close() { closed = true },
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    now: () => now,
  })
  const session = await store.start()
  now = 10_000
  store.append(session.id, 0, 'AQI=')
  now = 27_000

  await assert.rejects(store.finish(session.id), /expired/)
  assert.equal(finishCalls, 0)
  assert.equal(closed, true)
  assert.equal(store.get(session.id), null)
})

test('cleanup preserves only the two-second finish grace', async () => {
  let now = 1_000
  let closeCalls = 0
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => JSON.stringify(validInsight()),
    close() { closeCalls += 1 },
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    now: () => now,
  })
  const session = await store.start()
  now = 10_000
  store.append(session.id, 0, 'AQI=')

  now = 26_999
  store.cleanupExpired()
  assert.equal(store.get(session.id)?.id, session.id)
  assert.equal(closeCalls, 0)

  now = 27_000
  store.cleanupExpired()
  assert.equal(store.get(session.id), null)
  assert.equal(closeCalls, 1)
})

test('actively closes a disconnected session at the prepare deadline', async () => {
  let closeCalls = 0
  const timers = createManualTimers()
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => JSON.stringify(validInsight()),
    close() { closeCalls += 1 },
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    timers,
    prepareWindowMs: 20,
    captureWindowMs: 15,
    finishGraceMs: 2,
  })
  const session = await store.start()

  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 20)
  timers.run(timers.scheduled[0])

  assert.equal(closeCalls, 1)
  assert.equal(store.get(session.id), null)
})

test('first PCM replaces prepare expiry with capture plus finish grace', async () => {
  let closeCalls = 0
  const timers = createManualTimers()
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => JSON.stringify(validInsight()),
    close() { closeCalls += 1 },
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    timers,
    prepareWindowMs: 20,
    captureWindowMs: 15,
    finishGraceMs: 2,
  })
  const session = await store.start()
  const prepareTimer = timers.scheduled[0]

  store.append(session.id, 0, 'AQI=')
  assert.equal(prepareTimer.cleared, true)
  assert.equal(timers.scheduled.length, 2)
  assert.equal(timers.scheduled[1].delay, 17)

  timers.run(timers.scheduled[1])
  assert.equal(closeCalls, 1)
  assert.equal(store.get(session.id), null)
})

test('finish, cancel, and validation failures clear active expiry timers', async () => {
  const timers = createManualTimers()
  const providers = []
  const store = new SocialSessionStore({
    providerFactory: () => {
      const provider = {
        start: async () => {},
        append() {},
        finish: async () => JSON.stringify(validInsight()),
        close() {},
      }
      providers.push(provider)
      return provider
    },
    timers,
  })

  const finished = await store.start()
  const finishTimer = timers.scheduled.at(-1)
  await store.finish(finished.id)
  assert.equal(finishTimer.cleared, true)

  const cancelled = await store.start()
  const cancelTimer = timers.scheduled.at(-1)
  await store.cancel(cancelled.id)
  assert.equal(cancelTimer.cleared, true)

  const invalid = await store.start()
  const invalidTimer = timers.scheduled.at(-1)
  assert.throws(() => store.append(invalid.id, 1, 'AQI='), /sequence/)
  assert.equal(invalidTimer.cleared, true)
})

test('accepts append just before but not at first PCM plus fifteen seconds', async () => {
  let now = 1_000
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => '{}',
    close() {},
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    now: () => now,
  })
  const accepted = await store.start()
  now = 5_000
  store.append(accepted.id, 0, 'AQI=')
  now = 19_999
  assert.doesNotThrow(() => store.append(accepted.id, 1, 'AwQ='))
  await store.cancel(accepted.id)

  const expired = await store.start()
  now = 30_000
  store.append(expired.id, 0, 'AQI=')
  now = 45_000
  assert.throws(() => store.append(expired.id, 1, 'AwQ='), /expired/)
  assert.equal(store.get(expired.id), null)
})

test('closes and removes expired sessions before accepting more audio', async () => {
  let now = 1_000
  let closed = false
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => '{}',
    close() { closed = true },
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    now: () => now,
  })
  const session = await store.start()
  now = session.expiresAt
  assert.throws(() => store.append(session.id, 0, 'AQI='), /expired/)
  assert.equal(closed, true)
  assert.equal(store.get(session.id), null)
})

test('discards partially uploaded audio after a non-canonical Base64 chunk', async () => {
  const provider = {
    start: async () => {},
    appendCalls: [],
    append(value) { this.appendCalls.push(value) },
    finish: async () => '{}',
    close() {},
  }
  const store = new SocialSessionStore({ providerFactory: () => provider })
  const session = await store.start()

  store.append(session.id, 0, 'AQI=')
  assert.throws(() => store.append(session.id, 1, 'AQI=!'), /Base64/)
  assert.deepEqual(provider.appendCalls, ['AQI='])
  assert.equal(store.get(session.id), null)
})

test('discards a session after an invalid chunk sequence', async () => {
  let closeCalls = 0
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => '{}',
    close() { closeCalls += 1 },
  }
  const store = new SocialSessionStore({ providerFactory: () => provider })
  const session = await store.start()
  store.append(session.id, 0, 'AQI=')

  assert.throws(() => store.append(session.id, 2, 'AwQ='), /sequence/)
  assert.equal(closeCalls, 1)
  assert.equal(store.get(session.id), null)
})

test('discards a session after oversized or cumulative PCM validation failures', async () => {
  const oversized = Buffer.alloc(64_001).toString('base64')
  const maxChunk = Buffer.alloc(64_000).toString('base64')
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => '{}',
    closeCalls: 0,
    close() { this.closeCalls += 1 },
  }
  const store = new SocialSessionStore({ providerFactory: () => provider })
  const oversizedSession = await store.start()

  assert.throws(() => store.append(oversizedSession.id, 0, oversized), /chunk size/)
  assert.equal(store.get(oversizedSession.id), null)

  const cumulativeSession = await store.start()
  for (let seq = 0; seq < 10; seq += 1) store.append(cumulativeSession.id, seq, maxChunk)
  assert.throws(() => store.append(cumulativeSession.id, 10, 'AA=='), /size exceeded/)
  assert.equal(store.get(cumulativeSession.id), null)
  assert.equal(provider.closeCalls, 2)
})

test('expires a session before finish without asking the provider for insight', async () => {
  let now = 1_000
  let closed = false
  let finishCalls = 0
  const provider = {
    start: async () => {},
    append() {},
    finish: async () => { finishCalls += 1; return '{}' },
    close() { closed = true },
  }
  const store = new SocialSessionStore({
    providerFactory: () => provider,
    now: () => now,
  })
  const session = await store.start()
  store.latestInsight = { trend: 'stable' }
  now = session.expiresAt

  await assert.rejects(store.finish(session.id), /expired/)
  assert.equal(finishCalls, 0)
  assert.equal(closed, true)
  assert.equal(store.get(session.id), null)
  assert.deepEqual(store.latestInsight, { trend: 'stable' })
})

test('cancel is idempotent and wins a finish race without publishing insight', async () => {
  let resolveFinish
  let closeCalls = 0
  const provider = {
    start: async () => {},
    append() {},
    finish: () => new Promise(resolve => { resolveFinish = resolve }),
    close() { closeCalls += 1 },
  }
  const store = new SocialSessionStore({ providerFactory: () => provider })
  const session = await store.start()
  const finishing = store.finish(session.id)

  assert.deepEqual(await store.cancel(session.id), { cancelled: true })
  assert.deepEqual(await store.cancel(session.id), { cancelled: false })
  resolveFinish(JSON.stringify({
    engagement: 0.5,
    comfort: 0.5,
    reciprocity: 0.5,
    tension: 0.2,
    opportunity: 0.7,
    confidence: 0.8,
    trend: 'stable',
    topic: '展览',
    suggestion_line_1: '她提到了展览',
    suggestion_line_2: '问问最喜欢哪一件',
    reason: '话题有连续回应',
  }))

  await assert.rejects(finishing, /cancelled/)
  assert.equal(store.get(session.id), null)
  assert.equal(store.latestInsight, null)
  assert.ok(closeCalls >= 1)
})

test('rejects append while a finish is pending without calling the provider', async () => {
  let resolveFinish
  let closeCalls = 0
  const provider = {
    start: async () => {},
    appendCalls: [],
    append(value) { this.appendCalls.push(value) },
    finish: () => new Promise(resolve => { resolveFinish = resolve }),
    close() { closeCalls += 1 },
  }
  const store = new SocialSessionStore({ providerFactory: () => provider })
  const session = await store.start()
  const finishing = store.finish(session.id)

  assert.throws(() => store.append(session.id, 0, 'AQI='), /finishing/)
  assert.deepEqual(provider.appendCalls, [])
  assert.equal(store.get(session.id), null)
  assert.equal(closeCalls, 1)
  resolveFinish('{}')
  await assert.rejects(finishing, /cancelled/)
})
