import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('new Even installs require an explicit relay URL and local access token', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

  assert.match(source, /const CONFIG_KEY = 'even-r1-relay\.config\.v4'/)
  assert.match(source, /accessToken: ''/)
  assert.match(source, /endpoint: ''/)
  assert.match(source, /enabled: false/)
  assert.match(source, /id="access-token" type="password"/)
})
