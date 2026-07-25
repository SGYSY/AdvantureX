import { describe, expect, it, vi } from 'vitest'
import {
  hasUsableSocialInsight,
  socialFailureGesture,
  SocialCopilotController,
  routeSocialGesture,
  shouldAppendSocialPcm,
} from '../src/social-copilot'

describe('SocialCopilotController', () => {
  it('starts, uploads ordered PCM chunks, and returns the final insight', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        id: 'session-1',
        expiresAt: Date.now() + 20_000,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        insight: {
          suggestion: ['她提到了旅行', '问问最喜欢哪里'],
          expiresAt: Date.now() + 600_000,
        },
      }), { status: 200 }))

    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      accessToken: 'relay-test-token',
      fetcher,
    })
    await controller.start()
    controller.appendPcm(new Uint8Array([1, 2, 3, 4]))
    const insight = await controller.finish()

    expect(insight?.suggestion).toEqual(['她提到了旅行', '问问最喜欢哪里'])
    expect(fetcher.mock.calls[1][0]).toContain('/social/session/session-1/chunk')
    expect(fetcher.mock.calls[2][0]).toContain('/social/session/session-1/finish')
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer relay-test-token')
    }
  })

  it('calls a native-style fetcher with the browser global as its receiver', async () => {
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        id: 'session-1',
      }), { status: 200 }))
    })
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
    })

    await controller.start()

    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('starts without relying on the Headers constructor', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      id: 'session-1',
    }), { status: 200 }))
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      accessToken: 'relay-test-token',
      fetcher,
    })
    vi.stubGlobal('Headers', undefined)

    try {
      await controller.start()
    } finally {
      vi.unstubAllGlobals()
    }

    expect(fetcher.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer relay-test-token',
      'Content-Type': 'application/json',
    })
  })

  it('batches short G2 PCM frames before sending them through the relay', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        id: 'session-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        insight: {
          suggestion: ['认真听她说完', '再问一个细节'],
          expiresAt: Date.now() + 600_000,
        },
      }), { status: 200 }))
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
    })

    await controller.start()
    controller.appendPcm(new Uint8Array([1, 2]))
    controller.appendPcm(new Uint8Array([3, 4]))
    controller.appendPcm(new Uint8Array([5, 6]))
    await controller.finish()

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toEqual({
      seq: 0,
      pcmBase64: 'AQIDBAUG',
    })
  })

  it('does not upload PCM outside an active session', () => {
    const fetcher = vi.fn()
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
    })
    controller.appendPcm(new Uint8Array([1, 2]))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cancels instead of asking StepFun to analyze an empty capture', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        id: 'session-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
    })

    await controller.start()
    await expect(controller.finish()).rejects.toThrow('No glasses audio received')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://relay.example/social/session/start',
      'https://relay.example/social/session/session-1/cancel',
    ])
  })

  it('defers endpoint validation until a session starts', () => {
    expect(() => new SocialCopilotController({ eventEndpoint: '' })).not.toThrow()
  })

  it('cancels the relay session after the first chunk upload fails without poisoning finish', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: 'session-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
    })

    await controller.start()
    controller.appendPcm(new Uint8Array([1]))
    controller.appendPcm(new Uint8Array([2]))

    await expect(controller.finish()).rejects.toThrow('Audio chunk HTTP 500')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://relay.example/social/session/start',
      'https://relay.example/social/session/session-1/chunk',
      'https://relay.example/social/session/session-1/cancel',
    ])
  })

  it('only accepts active glasses PCM and keeps swipe-down local', () => {
    expect(shouldAppendSocialPcm('active', 'glasses', 'glasses')).toBe(true)
    expect(shouldAppendSocialPcm('starting', 'glasses', 'glasses')).toBe(false)
    expect(shouldAppendSocialPcm('active', 'ring', 'glasses')).toBe(false)
    expect(routeSocialGesture('ring.swipe_down')).toBe('view')
    expect(routeSocialGesture('ring.swipe_up')).toBe('toggle')
    expect(routeSocialGesture('ring.click')).toBe('forward')
  })

  it('routes source-less SDK text swipe events by their gesture type', () => {
    expect(routeSocialGesture('unknown.swipe_up')).toBe('toggle')
    expect(routeSocialGesture('unknown.swipe_down')).toBe('view')
  })

  it('treats low-confidence or empty completion output as blank', () => {
    expect(hasUsableSocialInsight(null)).toBe(false)
    expect(hasUsableSocialInsight({ suggestion: [], expiresAt: Date.now() + 1_000 })).toBe(false)
    expect(hasUsableSocialInsight({
      suggestion: ['继续聊旅行'],
      expiresAt: Date.now() + 1_000,
    })).toBe(true)
  })

  it('encodes a bounded client failure stage for relay diagnostics', () => {
    expect(socialFailureGesture('start', new TypeError('Illegal invocation')))
      .toBe('social.start_failed.TypeError_Illegal_invocation')
    expect(socialFailureGesture('finish', new Error('x'.repeat(200))).length)
      .toBeLessThanOrEqual(96)
  })

  it('times out a never-resolving start and returns to idle', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}))
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
      timeoutMs: 5,
    })

    await expect(controller.start()).rejects.toThrow('timed out')
    expect(controller.state).toBe('idle')
  })

  it('aborts a never-settling chunk before cancelling the relay session', async () => {
    let aborted = false
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: 'session-1' }), { status: 200 }))
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('Aborted', 'AbortError'))
        })
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
      timeoutMs: 5,
    })

    await controller.start()
    controller.appendPcm(new Uint8Array([1]))
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    await expect(controller.cancel()).resolves.toBeUndefined()

    expect(aborted).toBe(true)
    expect(fetcher.mock.calls[2][0]).toContain('/social/session/session-1/cancel')
  })

  it('bounds finish while an upload is stuck, then cancels the relay session', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: 'session-1' }), { status: 200 }))
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
      timeoutMs: 5,
    })

    await controller.start()
    controller.appendPcm(new Uint8Array([1]))
    await expect(controller.finish()).rejects.toThrow('timed out')
    expect(fetcher.mock.calls[2][0]).toContain('/social/session/session-1/cancel')
  })

  it('allows realtime analysis to run longer than the eight-second upload timeout', async () => {
    vi.useFakeTimers()
    let resolveFinish!: (response: Response) => void
    let finishSignal: AbortSignal | null = null
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: 'session-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        finishSignal = init.signal ?? null
        return new Promise<Response>(resolve => {
          resolveFinish = resolve
        })
      })
    const controller = new SocialCopilotController({
      eventEndpoint: 'https://relay.example/even',
      fetcher,
    })

    try {
      await controller.start()
      controller.appendPcm(new Uint8Array([1, 2]))
      const result = controller.finish().then(
        value => ({ value, error: null }),
        error => ({ value: null, error }),
      )
      for (let attempt = 0; attempt < 10 && fetcher.mock.calls.length < 3; attempt += 1) {
        await Promise.resolve()
      }
      expect(fetcher).toHaveBeenCalledTimes(3)
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()

      expect(finishSignal?.aborted).toBe(false)
      resolveFinish(new Response(JSON.stringify({
        ok: true,
        insight: {
          suggestion: ['互动正在升温', '先回应，再认真听'],
          expiresAt: Date.now() + 600_000,
        },
      }), { status: 200 }))
      await expect(result).resolves.toMatchObject({
        value: {
          suggestion: ['互动正在升温', '先回应，再认真听'],
        },
        error: null,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
