import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appJson = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'))

test('declares the G2 microphone permission', () => {
  const mic = appJson.permissions.find((p) => p.name === 'g2-microphone')
  assert.ok(mic, 'app.json must declare the g2-microphone permission')
  assert.ok(mic.desc, 'g2-microphone permission must include a description')
})

test('declares the relay network permission with an https whitelist', () => {
  const network = appJson.permissions.find((p) => p.name === 'network')
  assert.ok(network, 'app.json must declare the network permission')
  assert.ok(Array.isArray(network.whitelist) && network.whitelist.length > 0, 'network permission must include a non-empty whitelist')
  for (const origin of network.whitelist) {
    assert.match(origin, /^https:\/\//, `whitelist origin must use https: ${origin}`)
  }
})
