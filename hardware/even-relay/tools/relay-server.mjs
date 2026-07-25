import http from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { SocialSessionStore } from './social-session-store.mjs'
import { StepFunRealtimeSession } from './stepfun-realtime.mjs'

const port = Number(process.env.PORT ?? 8788)
// 音频段较大（base64 PCM），放宽 body 上限到 4MB
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES ?? 4 * 1024 * 1024)

export function createRelayServer({
  forwardUrl = process.env.FORWARD_URL ?? '',
  accessToken = process.env.RELAY_ACCESS_TOKEN ?? '',
  wingmanSharedSecret = process.env.WINGMAN_SHARED_SECRET ?? '',
  stepfunApiKey = process.env.STEPFUN_API_KEY ?? '',
  stepfunModel = process.env.STEPFUN_MODEL ?? 'stepaudio-2.5-realtime',
  stepfunRealtimeUrl = process.env.STEPFUN_REALTIME_URL ?? 'wss://api.stepfun.com/step_plan/v1/realtime',
  sessionStore,
} = {}) {
  const configuredAccessToken = accessToken.trim()
  const sessions = sessionStore ?? (stepfunApiKey
    ? new SocialSessionStore({
        providerFactory: () => new StepFunRealtimeSession({
          apiKey: stepfunApiKey,
          model: stepfunModel,
          baseUrl: stepfunRealtimeUrl,
        }),
      })
    : null)

  return http.createServer(async (request, response) => {
    setCorsHeaders(response)

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    try {
      if (url.pathname === '/even' || url.pathname.startsWith('/social/')) {
        if (!configuredAccessToken) {
          return sendJson(response, 503, { ok: false, error: 'Relay access token is not configured' })
        }
        if (!hasValidBearerToken(request.headers.authorization, configuredAccessToken)) {
          return sendJson(response, 401, { ok: false, error: 'Unauthorized' })
        }
      }

      if (request.method === 'POST' && url.pathname === '/even') {
        await handleEven(request, response, forwardUrl, wingmanSharedSecret)
        return
      }

      if (request.method === 'POST' && url.pathname === '/social/session/start') {
        if (!sessions) return sendJson(response, 503, { ok: false, error: 'Social copilot unavailable' })
        return sendJson(response, 200, { ok: true, ...(await sessions.start()) })
      }

      const chunk = url.pathname.match(/^\/social\/session\/([^/]+)\/chunk$/)
      if (request.method === 'POST' && chunk) {
        if (!sessions) return sendJson(response, 503, { ok: false, error: 'Social copilot unavailable' })
        const payload = parseJsonBody(await readBody(request, maxBodyBytes))
        sessions.append(chunk[1], Number(payload.seq), String(payload.pcmBase64 ?? ''))
        return sendJson(response, 200, { ok: true })
      }

      const finish = url.pathname.match(/^\/social\/session\/([^/]+)\/finish$/)
      if (request.method === 'POST' && finish) {
        if (!sessions) return sendJson(response, 503, { ok: false, error: 'Social copilot unavailable' })
        const insight = await sessions.finish(finish[1])
        const { reason: _privateReason, ...publicInsight } = insight
        return sendJson(response, 200, { ok: true, insight: publicInsight })
      }

      const cancel = url.pathname.match(/^\/social\/session\/([^/]+)\/cancel$/)
      if (request.method === 'POST' && cancel) {
        if (!sessions) return sendJson(response, 503, { ok: false, error: 'Social copilot unavailable' })
        return sendJson(response, 200, { ok: true, ...(await sessions.cancel(cancel[1])) })
      }

      sendJson(response, 404, { ok: false, error: 'Route not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 422, { ok: false, error: message })
    }
  })
}

/** 接收标准化事件（even-r1-relay/v1），可选转发硬件 */
async function handleEven(request, response, forwardUrl, wingmanSharedSecret) {
  try {
    const body = await readBody(request, maxBodyBytes)
    const payload = parseJsonBody(body)
    const gesture = payload?.event?.gesture ?? 'unknown'
    const source = payload?.event?.source?.label ?? 'unknown'
    const action = payload?.action?.name ?? 'none'
    console.log(`[${new Date().toISOString()}] ${source} ${gesture} action=${action}`)

    const forwarded = await forwardToHardware(payload, forwardUrl, wingmanSharedSecret)
    sendJson(response, 200, { ok: true, forwarded })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[relay-error] ${message}`)
    sendJson(response, 500, { ok: false, error: message })
  }
}

/** 若配置了 FORWARD_URL，则把 payload 原样转发到硬件 */
async function forwardToHardware(payload, forwardUrl, wingmanSharedSecret) {
  if (!forwardUrl) return false
  const forwardResponse = await fetch(forwardUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wingman-Secret': wingmanSharedSecret,
    },
    body: JSON.stringify(payload),
  })
  if (!forwardResponse.ok) throw new Error(`FORWARD_URL 返回 HTTP ${forwardResponse.status}`)
  return true
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createRelayServer().listen(port, '0.0.0.0', () => {
    console.log(`Even R1 relay listening on http://0.0.0.0:${port}`)
    console.log('  events: POST /even')
    console.log('  social: POST /social/session/start')
    console.log('          POST /social/session/:id/cancel')
  })
}

function hasValidBearerToken(authorization, accessToken) {
  const provided = createHash('sha256').update(String(authorization ?? '')).digest()
  const expected = createHash('sha256').update(`Bearer ${accessToken}`).digest()
  return timingSafeEqual(provided, expected)
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

function parseJsonBody(body) {
  if (!body.trim()) return {}
  return JSON.parse(body)
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []

    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`Request body exceeded ${limit} bytes`))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })

    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}
