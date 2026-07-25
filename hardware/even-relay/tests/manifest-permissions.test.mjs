import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appJson = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'))

test('declares the G2 microphone and relay network permissions', () => {
  assert.deepEqual(appJson.permissions, [
    {
      name: 'g2-microphone',
      desc: 'Capture short audio from G2 for the social copilot.',
    },
    {
      name: 'network',
      desc: 'Send captured audio and gestures to the SNAKE1 relay.',
      whitelist: ['https://speeches-bibliography-enters-participant.trycloudflare.com'],
    },
  ])
})
