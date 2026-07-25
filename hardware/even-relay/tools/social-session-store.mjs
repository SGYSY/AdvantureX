import { randomUUID } from 'node:crypto'
import { parseRelationshipState } from './relationship-state.mjs'

const PREPARE_WINDOW_MS = 20_000
const CAPTURE_WINDOW_MS = 15_000
const FINISH_GRACE_MS = 2_000

export class SocialSessionStore {
  constructor({
    providerFactory,
    now = () => Date.now(),
    timers = globalThis,
    prepareWindowMs = PREPARE_WINDOW_MS,
    captureWindowMs = CAPTURE_WINDOW_MS,
    finishGraceMs = FINISH_GRACE_MS,
  }) {
    this.providerFactory = providerFactory
    this.now = now
    this.timers = timers
    this.prepareWindowMs = prepareWindowMs
    this.captureWindowMs = captureWindowMs
    this.finishGraceMs = finishGraceMs
    this.sessions = new Map()
    this.latestInsight = null
  }

  async start() {
    this.cleanupExpired()
    if (this.sessions.size >= 2) throw new Error('Too many active audio sessions')
    const provider = this.providerFactory()
    await provider.start()
    const session = {
      id: randomUUID(),
      provider,
      nextSeq: 0,
      bytes: 0,
      expiresAt: this.now() + this.prepareWindowMs,
    }
    this.sessions.set(session.id, session)
    this.scheduleExpiry(session, this.prepareWindowMs)
    return { id: session.id, expiresAt: session.expiresAt }
  }

  get(id) {
    return this.sessions.get(id) ?? null
  }

  append(id, seq, pcmBase64) {
    const session = this.get(id)
    if (!session) throw new Error('Audio session not found')
    const now = this.now()
    if (this.isExpired(session, now)) {
      this.discard(session, { cancelled: true })
      throw new Error('Audio session expired')
    }

    const firstChunk = session.captureStartedAt === undefined
    try {
      if (session.finishing) throw new Error('Audio session is finishing')
      if (seq !== session.nextSeq) throw new Error('Invalid audio chunk sequence')
      const bytes = decodeCanonicalBase64(pcmBase64).length
      if (bytes === 0 || bytes > 64_000) throw new Error('Invalid audio chunk size')
      if (session.bytes + bytes > 640_000) throw new Error('Audio session size exceeded')
      if (firstChunk) {
        session.captureStartedAt = now
        session.expiresAt = now + this.captureWindowMs + this.finishGraceMs
        this.scheduleExpiry(session, this.captureWindowMs + this.finishGraceMs)
      }
      session.provider.append(pcmBase64)
      session.nextSeq += 1
      session.bytes += bytes
    } catch (error) {
      this.discard(session, { cancelled: true })
      throw error
    }
  }

  async finish(id) {
    const session = this.get(id)
    if (!session) throw new Error('Audio session not found')
    if (this.isExpired(session, this.now(), { finishing: true })) {
      this.discard(session, { cancelled: true })
      throw new Error('Audio session expired')
    }
    if (session.finishing) throw new Error('Audio session is finishing')
    session.finishing = true
    this.clearExpiry(session)
    try {
      const text = await session.provider.finish()
      if (session.cancelled) throw new Error('Audio session cancelled')
      const state = parseRelationshipState(text, this.now())
      this.latestInsight = state
      return state
    } finally {
      this.discard(session)
    }
  }

  async cancel(id) {
    const session = this.get(id)
    if (!session) return { cancelled: false }
    this.discard(session, { cancelled: true })
    return { cancelled: true }
  }

  cleanupExpired() {
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session, this.now(), { finishing: true })) {
        this.discard(session, { cancelled: true })
      }
    }
  }

  isExpired(session, now, { finishing = false } = {}) {
    const deadline = session.captureStartedAt === undefined
      ? session.expiresAt
      : session.captureStartedAt + this.captureWindowMs
    const grace = finishing && session.captureStartedAt !== undefined ? this.finishGraceMs : 0
    return now >= deadline + grace
  }

  discard(session, { cancelled = false } = {}) {
    if (cancelled) session.cancelled = true
    this.clearExpiry(session)
    if (!session.closed) {
      session.closed = true
      try {
        session.provider.close()
      } finally {
        if (this.sessions.get(session.id) === session) this.sessions.delete(session.id)
      }
      return
    }
    if (this.sessions.get(session.id) === session) this.sessions.delete(session.id)
  }

  scheduleExpiry(session, delayMs) {
    this.clearExpiry(session)
    session.expiryTimer = this.timers.setTimeout(() => {
      session.expiryTimer = null
      if (this.sessions.get(session.id) === session) {
        this.discard(session, { cancelled: true })
      }
    }, delayMs)
  }

  clearExpiry(session) {
    if (session.expiryTimer == null) return
    this.timers.clearTimeout(session.expiryTimer)
    session.expiryTimer = null
  }
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid audio chunk Base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('Invalid audio chunk Base64')
  return bytes
}
