export type SocialInsight = {
  suggestion: string[]
  expiresAt: number
}

export function hasUsableSocialInsight(insight: SocialInsight | null): insight is SocialInsight {
  return Boolean(insight?.suggestion.some(line => typeof line === 'string' && line.trim()))
}

export type SocialListeningState = 'idle' | 'starting' | 'active' | 'finishing' | 'stopping' | 'error'

type Fetcher = typeof fetch

export function shouldAppendSocialPcm(
  state: SocialListeningState,
  source: unknown,
  glassesSource: unknown,
) {
  return state === 'active' && source === glassesSource
}

export function routeSocialGesture(gesture: string): 'toggle' | 'view' | 'forward' {
  if (gesture.endsWith('.swipe_up')) return 'toggle'
  if (gesture.endsWith('.swipe_down')) return 'view'
  return 'forward'
}

export function socialFailureGesture(stage: 'start' | 'finish', error: unknown) {
  const failure = toError(error)
  const normalized = `${failure.name}_${failure.message}`
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `social.${stage}_failed.${normalized || 'unknown'}`.slice(0, 96)
}

export class SocialCopilotController {
  private readonly fetcher: Fetcher
  private readonly timeoutMs: number
  private readonly analysisTimeoutMs: number
  private readonly accessToken: string
  private eventEndpoint: string
  private baseUrl: string | null = null
  private sessionId: string | null = null
  private seq = 0
  private capturedAudioBytes = 0
  private pendingAudio: number[] = []
  private audioBatchTimer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private firstChunkError: Error | null = null
  private startPromise: Promise<void> | null = null
  private generation = 0
  private currentGeneration = 0
  private _state: SocialListeningState = 'idle'
  private cancelling = false
  private inFlight = new Set<AbortController>()
  latestInsight: SocialInsight | null = null

  constructor({
    eventEndpoint,
    accessToken = '',
    fetcher = fetch,
    timeoutMs = 8_000,
    analysisTimeoutMs = 65_000,
  }: {
    eventEndpoint: string
    accessToken?: string
    fetcher?: Fetcher
    timeoutMs?: number
    analysisTimeoutMs?: number
  }) {
    this.eventEndpoint = eventEndpoint
    this.accessToken = accessToken
    this.fetcher = fetcher
    this.timeoutMs = timeoutMs
    this.analysisTimeoutMs = analysisTimeoutMs
  }

  get active() {
    return this._state === 'active'
  }

  get state() {
    return this._state
  }

  setEventEndpoint(eventEndpoint: string) {
    this.eventEndpoint = eventEndpoint
  }

  async start() {
    if (this._state === 'active') return
    if (this.startPromise) return this.startPromise
    if (this._state === 'finishing') throw new Error('Social session is finishing')

    this._state = 'starting'
    const generation = ++this.generation
    this.startPromise = (async () => {
      const baseUrl = socialBaseUrl(this.eventEndpoint)
      const response = await this.request(`${baseUrl}/social/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      if (this._state !== 'starting' || generation !== this.generation) {
        await this.cancelSession(baseUrl, body.id)
        return
      }
      this.baseUrl = baseUrl
      this.sessionId = body.id
      this.seq = 0
      this.capturedAudioBytes = 0
      this.pendingAudio = []
      this.clearAudioBatchTimer()
      this.queue = Promise.resolve()
      this.firstChunkError = null
      this.cancelling = false
      this.currentGeneration = generation
      this._state = 'active'
    })()

    try {
      await this.startPromise
    } catch (error) {
      if (generation === this.generation) this._state = 'idle'
      throw error
    } finally {
      this.startPromise = null
    }
  }

  appendPcm(bytes: Uint8Array) {
    if (!this.active || !this.sessionId || !this.baseUrl || bytes.byteLength === 0) return
    this.capturedAudioBytes += bytes.byteLength
    for (const byte of bytes) this.pendingAudio.push(byte)
    if (this.audioBatchTimer === null) {
      this.audioBatchTimer = setTimeout(() => {
        this.audioBatchTimer = null
        this.flushPendingAudio()
      }, 250)
    }
  }

  private flushPendingAudio() {
    if (!this.active || !this.sessionId || !this.baseUrl || this.pendingAudio.length === 0) return
    const sessionId = this.sessionId
    const baseUrl = this.baseUrl
    const seq = this.seq++
    const bytes = new Uint8Array(this.pendingAudio)
    this.pendingAudio = []
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
    const pcmBase64 = btoa(binary)
    this.queue = this.queue.then(async () => {
      if (this.firstChunkError || this.cancelling) return
      try {
        const response = await this.request(
          `${baseUrl}/social/session/${sessionId}/chunk`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seq, pcmBase64 }),
          },
        )
        if (!response.ok) throw new Error(`Audio chunk HTTP ${response.status}`)
      } catch (error) {
        this.firstChunkError ??= toError(error)
      }
    })
  }

  async finish(): Promise<SocialInsight | null> {
    if (!this.active || !this.sessionId || !this.baseUrl) return this.latestInsight
    this.clearAudioBatchTimer()
    this.flushPendingAudio()
    const sessionId = this.sessionId
    const baseUrl = this.baseUrl
    const generation = this.currentGeneration
    this.sessionId = null
    this._state = 'finishing'

    try {
      if (this.capturedAudioBytes === 0) throw new Error('No glasses audio received')
      await this.awaitQueue()
      if (this.firstChunkError) throw this.firstChunkError
      const response = await this.request(
        `${baseUrl}/social/session/${sessionId}/finish`,
        { method: 'POST' },
        this.analysisTimeoutMs,
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      const insight = body.insight ?? null
      if (generation === this.currentGeneration) this.latestInsight = insight
      return insight
    } catch (error) {
      await this.cancelAfterFailure(baseUrl, sessionId)
      throw error
    } finally {
      if (generation === this.currentGeneration) this._state = 'idle'
    }
  }

  async cancel() {
    const sessionId = this.sessionId
    const baseUrl = this.baseUrl
    this.sessionId = null
    this._state = 'idle'
    this.generation += 1
    this.cancelling = true
    this.clearPendingAudio()
    this.abortInFlight()
    if (!sessionId || !baseUrl) return
    try {
      await this.awaitQueue()
    } catch {
      // The relay cancellation below is still the authoritative cleanup.
    }
    await this.cancelSession(baseUrl, sessionId)
  }

  private async cancelAfterFailure(baseUrl: string, sessionId: string) {
    try {
      await this.cancelSession(baseUrl, sessionId)
    } catch {
      // Preserve the original upload or finish error for the caller.
    }
  }

  private async cancelSession(baseUrl: string, sessionId: string) {
    const response = await this.request(
      `${baseUrl}/social/session/${sessionId}/cancel`,
      { method: 'POST' },
    )
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  }

  private async request(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs = this.timeoutMs,
  ) {
    const controller = new AbortController()
    this.inFlight.add(controller)
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      const headers = {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${this.accessToken}`,
      }
      const pending = this.fetcher.call(globalThis, input, {
        ...init,
        headers,
        signal: controller.signal,
      })
      const timeoutError = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Social request timed out'))
        }, timeoutMs)
      })
      return await Promise.race([pending, timeoutError])
    } finally {
      if (timeout) clearTimeout(timeout)
      this.inFlight.delete(controller)
    }
  }

  private async awaitQueue() {
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      const timeoutError = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Social audio queue timed out')), this.timeoutMs)
      })
      await Promise.race([this.queue, timeoutError])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private abortInFlight() {
    for (const controller of this.inFlight) controller.abort()
  }

  private clearAudioBatchTimer() {
    if (this.audioBatchTimer !== null) clearTimeout(this.audioBatchTimer)
    this.audioBatchTimer = null
  }

  private clearPendingAudio() {
    this.clearAudioBatchTimer()
    this.pendingAudio = []
    this.capturedAudioBytes = 0
  }
}

function socialBaseUrl(eventEndpoint: string) {
  const url = new URL(eventEndpoint)
  url.pathname = url.pathname.replace(/\/even\/?$/, '')
  return url.toString().replace(/\/$/, '')
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
