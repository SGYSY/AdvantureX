import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { StepFunRealtimeSession } from './stepfun-realtime.mjs'

class FakeSocket extends EventEmitter {
  sent = []
  onSend = null
  send(value) {
    const event = JSON.parse(value)
    this.sent.push(event)
    this.onSend?.(event)
  }
  close() { this.emit('close') }
}

async function startSession(socket, timeoutMs = 1000) {
  const session = new StepFunRealtimeSession({
    apiKey: 'test-key',
    socketFactory: () => socket,
    timeoutMs,
  })
  const started = session.start()
  socket.emit('open')
  socket.emit('message', JSON.stringify({ type: 'session.created' }))
  await started
  return session
}

test('connects through the AdventureX Step Plan realtime endpoint', async () => {
  const socket = new FakeSocket()
  let requestedUrl = ''
  let authorization = ''
  const session = new StepFunRealtimeSession({
    apiKey: 'test-key',
    socketFactory: (url, options) => {
      requestedUrl = url
      authorization = options.headers.Authorization
      return socket
    },
    timeoutMs: 1000,
  })
  const started = session.start()
  socket.emit('open')
  socket.emit('message', JSON.stringify({ type: 'session.created' }))
  await started
  assert.equal(
    requestedUrl,
    'wss://api.stepfun.com/step_plan/v1/realtime?model=stepaudio-2.5-realtime',
  )
  assert.equal(authorization, 'Bearer test-key')
})

test('rejects a concurrent start without replacing the connecting socket', async () => {
  const socket = new FakeSocket()
  let factoryCalls = 0
  const session = new StepFunRealtimeSession({
    apiKey: 'test-key',
    socketFactory: () => {
      factoryCalls += 1
      return socket
    },
  })
  const first = session.start()

  await assert.rejects(session.start(), /already started/)
  assert.equal(factoryCalls, 1)
  socket.emit('message', JSON.stringify({ type: 'session.created' }))
  await first
})

test('rejects a repeated start after the session is ready', async () => {
  const socket = new FakeSocket()
  const session = await startSession(socket)

  await assert.rejects(session.start(), /already started/)
  assert.equal(socket.sent.filter(event => event.type === 'session.update').length, 1)
})

test('streams PCM16 and resolves the text-only response', async () => {
  const socket = new FakeSocket()
  const session = new StepFunRealtimeSession({
    apiKey: 'test-key',
    socketFactory: () => socket,
    timeoutMs: 1000,
  })
  const started = session.start()
  socket.emit('open')
  socket.emit('message', JSON.stringify({ type: 'session.created' }))
  await started

  session.append('AQIDBA==')
  const result = session.finish()
  socket.emit('message', JSON.stringify({ type: 'response.text.delta', delta: '{"trend":' }))
  socket.emit('message', JSON.stringify({ type: 'response.text.delta', delta: '"unknown"}' }))
  socket.emit('message', JSON.stringify({ type: 'response.done' }))

  assert.equal(await result, '{"trend":"unknown"}')
  assert.equal(socket.sent.some(event => event.type === 'input_audio_buffer.append'), true)
  assert.equal(socket.sent.some(event => event.type === 'input_audio_buffer.commit'), true)
  assert.equal(socket.sent.some(event => event.type === 'response.create'), true)
})

test('rejects provider error events without leaking the key', async () => {
  const socket = new FakeSocket()
  const session = new StepFunRealtimeSession({
    apiKey: 'test-key',
    socketFactory: () => socket,
    timeoutMs: 1000,
  })
  const started = session.start()
  socket.emit('open')
  socket.emit('message', JSON.stringify({ type: 'session.created' }))
  await started
  const result = session.finish()
  socket.emit('message', JSON.stringify({
    type: 'error',
    error: { message: 'invalid audio' },
  }))
  await assert.rejects(result, /invalid audio/)
})

test('installs finish handlers before a synchronous text-only response completes', async () => {
  const socket = new FakeSocket()
  const session = await startSession(socket, 25)
  socket.onSend = event => {
    if (event.type === 'response.create') {
      socket.emit('message', JSON.stringify({ type: 'response.done' }))
    }
  }

  assert.equal(await session.finish(), '')
})

test('rejects a pending start immediately when the remote socket closes', async () => {
  const socket = new FakeSocket()
  const session = new StepFunRealtimeSession({
    apiKey: 'test-key',
    socketFactory: () => socket,
    timeoutMs: 25,
  })
  const started = session.start()
  socket.emit('close')

  await assert.rejects(started, /closed/)
  assert.throws(() => session.append('AQIDBA=='), /not started/)
})

test('rejects a pending finish immediately when the remote socket closes', async () => {
  const socket = new FakeSocket()
  const session = await startSession(socket, 25)
  const result = session.finish()
  socket.emit('close')

  await assert.rejects(result, /closed/)
  assert.throws(() => session.append('AQIDBA=='), /not started/)
})

test('caller close rejects a pending finish without waiting for the timeout', async () => {
  const socket = new FakeSocket()
  const session = await startSession(socket, 25)
  const result = session.finish()
  session.close()

  await assert.rejects(result, /closed/)
})

test('socket errors close the session and reject the pending finish', async () => {
  const socket = new FakeSocket()
  const session = await startSession(socket)
  const result = session.finish()
  socket.emit('error', new Error('network lost'))

  await assert.rejects(result, /network lost/)
  assert.throws(() => session.append('AQIDBA=='), /not started/)
})

test('rejects concurrent finish calls', async () => {
  const socket = new FakeSocket()
  const session = await startSession(socket)
  const first = session.finish()

  await assert.rejects(session.finish(), /already in progress/)
  socket.emit('message', JSON.stringify({ type: 'response.done' }))
  await first
})

test('malformed provider frames reject only the current session', async () => {
  const brokenSocket = new FakeSocket()
  const brokenSession = new StepFunRealtimeSession({
    apiKey: 'test-key',
    socketFactory: () => brokenSocket,
    timeoutMs: 1000,
  })
  const started = brokenSession.start()

  assert.doesNotThrow(() => brokenSocket.emit('message', '{not-json'))
  await assert.rejects(started, /JSON|Unexpected/)

  const healthySocket = new FakeSocket()
  const healthySession = await startSession(healthySocket)
  const result = healthySession.finish()
  healthySocket.emit('message', JSON.stringify({ type: 'response.done' }))
  assert.equal(await result, '')
})
