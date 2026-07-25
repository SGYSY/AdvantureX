import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createRelayServer } from './relay-server.mjs'

test('exposes an idempotent social session cancel route', async () => {
  const cancelled = []
  const server = createRelayServer({
    sessionStore: {
      cancel: async id => {
        cancelled.push(id)
        return { cancelled: true }
      },
    },
    accessToken: 'relay-test-token',
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}/social/session/session-1/cancel`, {
      method: 'POST',
      headers: { Authorization: 'Bearer relay-test-token' },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, cancelled: true })
    assert.deepEqual(cancelled, ['session-1'])
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('fails closed when relay access token is not configured', async () => {
  const server = createRelayServer({
    accessToken: '',
    sessionStore: { start: async () => ({ id: 'unused' }) },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    for (const [path, method] of [['/even', 'POST'], ['/social/session/start', 'POST'], ['/social/anything', 'GET']]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method })
      assert.equal(response.status, 503)
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('requires the exact bearer token for relay and social routes', async () => {
  const server = createRelayServer({
    accessToken: 'relay-test-token',
    sessionStore: { start: async () => ({ id: 'session-1', expiresAt: 123 }) },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    for (const path of ['/even', '/social/session/start']) {
      for (const authorization of [undefined, 'Basic relay-test-token', 'Bearer wrong-token']) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: authorization ? { Authorization: authorization } : {},
          body: path === '/even' ? '{}' : undefined,
        })
        assert.equal(response.status, 401)
      }
    }

    for (const path of ['/even', '/social/session/start']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer relay-test-token' },
        body: path === '/even' ? '{}' : undefined,
      })
      assert.equal(response.status, 200)
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('allows browser preflight to request the Authorization header', async () => {
  const server = createRelayServer({ accessToken: 'relay-test-token' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}/even`, { method: 'OPTIONS' })
    assert.equal(response.status, 204)
    assert.match(response.headers.get('access-control-allow-headers') ?? '', /Authorization/i)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('does not expose the removed latest-insight route', async () => {
  const server = createRelayServer({ accessToken: 'relay-test-token', sessionStore: {} })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const removedPath = ['social', 'insight'].join('/')
    const response = await fetch(`http://127.0.0.1:${port}/${removedPath}`, {
      headers: { Authorization: 'Bearer relay-test-token' },
    })
    assert.equal(response.status, 404)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('projects private diagnostic reason out of the public finish response', async () => {
  const server = createRelayServer({
    accessToken: 'relay-test-token',
    sessionStore: {
      finish: async () => ({
        trend: 'stable',
        suggestion: ['继续聊展览'],
        confidence: 0.8,
        reason: 'private provider diagnostic',
      }),
    },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}/social/session/session-1/finish`, {
      method: 'POST',
      headers: { Authorization: 'Bearer relay-test-token' },
    })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.insight.reason, undefined)
    assert.equal(body.insight.trend, 'stable')
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('authenticates relay forwarding to Wingman with its shared secret', async () => {
  let forwardedSecret
  const hardware = http.createServer((request, response) => {
    forwardedSecret = request.headers['x-wingman-secret']
    request.resume()
    request.on('end', () => {
      response.writeHead(200)
      response.end()
    })
  })
  await new Promise(resolve => hardware.listen(0, '127.0.0.1', resolve))
  const hardwarePort = hardware.address().port
  const server = createRelayServer({
    accessToken: 'relay-test-token',
    wingmanSharedSecret: 'wingman-test-secret',
    forwardUrl: `http://127.0.0.1:${hardwarePort}/api/v1/hardware/even`,
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}/even`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer relay-test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ schema: 'even-r1-relay/v1', event: { gesture: 'ring.click' } }),
    })
    assert.equal(response.status, 200)
    assert.equal(forwardedSecret, 'wingman-test-secret')
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await new Promise((resolve, reject) => hardware.close(error => error ? reject(error) : resolve()))
  }
})
