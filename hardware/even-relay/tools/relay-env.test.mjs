import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import test from 'node:test'

test('package relay script loads its required local .env file', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(packageJson.scripts.relay, /^node --env-file=\.env tools\/relay-server\.mjs$/)

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'snake1-relay-env-'))
  const port = await reservePort()
  await writeFile(
    path.join(tempDirectory, '.env'),
    `PORT=${port}\nRELAY_ACCESS_TOKEN=integration-test-token\n`,
    { mode: 0o600 },
  )

  const relayPath = fileURLToPath(new URL('./relay-server.mjs', import.meta.url))
  const child = spawn(process.execPath, ['--env-file=.env', relayPath], {
    cwd: tempDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForListening(child)
    const response = await fetch(`http://127.0.0.1:${port}/even`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer integration-test-token',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    assert.equal(response.status, 200)
  } finally {
    child.kill('SIGTERM')
    await once(child, 'exit').catch(() => {})
    await rm(tempDirectory, { recursive: true, force: true })
  }
})

async function reservePort() {
  const server = http.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

function waitForListening(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Relay did not start')), 5_000)
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('exit', code => {
      clearTimeout(timeout)
      reject(new Error(`Relay exited before listening (${code}): ${stderr}`))
    })
    child.stdout.on('data', chunk => {
      if (!chunk.toString().includes('Even R1 relay listening')) return
      clearTimeout(timeout)
      resolve()
    })
  })
}
