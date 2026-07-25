import { describe, expect, it, vi } from 'vitest'
import { createGlassesFramePresenter, formatGlassesFrame } from '../src/glasses-ui'

describe('formatGlassesFrame', () => {
  it('renders standby as a single blank space', () => {
    expect(formatGlassesFrame({ kind: 'blank' })).toEqual({
      content: ' ',
      durationMs: 0,
    })
  })

  it('uses documented glyphs and minimal temporary copy', () => {
    expect(formatGlassesFrame({ kind: 'listening' })).toEqual({
      content: '● 15s',
      durationMs: 2000,
    })
    expect(formatGlassesFrame({ kind: 'ready' })).toEqual({
      content: '▲',
      durationMs: 2000,
    })
    expect(formatGlassesFrame({ kind: 'rescue' })).toEqual({
      content: '■ 已收到',
      durationMs: 2000,
    })
  })

  it('renders advice as at most two lines for six seconds', () => {
    expect(formatGlassesFrame({
      kind: 'advice',
      lines: ['她提到了旅行', '问问最喜欢哪里'],
    })).toEqual({
      content: '♥ 她提到了旅行\n问问最喜欢哪里',
      durationMs: 6000,
    })
  })

  it('splits advice on line breaks and bounds each visual line to 18 code points', () => {
    expect(formatGlassesFrame({
      kind: 'advice',
      lines: ['  第一行\r\n\n第二行  ', '1234567890123456789', '不应显示'],
    })).toEqual({
      content: '♥ 第一行\n第二行',
      durationMs: 6000,
    })
    expect(formatGlassesFrame({
      kind: 'advice',
      lines: ['😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀'],
    })).toEqual({
      content: '♥ 😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀',
      durationMs: 6000,
    })
  })

  it('serializes in-flight renders so the latest frame is written last', async () => {
    const renders: string[] = []
    const pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
    const timers: Array<{ callback: () => void; cleared: boolean }> = []
    const presenter = createGlassesFramePresenter({
      render: content => new Promise<void>((resolve, reject) => {
        renders.push(content)
        pending.push({ resolve, reject })
      }),
      timers: {
        setTimeout: callback => {
          timers.push({ callback, cleared: false })
          return timers.length - 1
        },
        clearTimeout: handle => {
          timers[handle].cleared = true
        },
      },
    })

    const stale = presenter.show({ kind: 'listening' })
    await vi.waitFor(() => expect(renders).toEqual(['● 15s']))
    const current = presenter.show({ kind: 'ready' })
    await Promise.resolve()
    expect(renders).toEqual(['● 15s'])

    pending[0].resolve()
    await stale
    expect(timers).toHaveLength(0)
    await vi.waitFor(() => expect(renders).toEqual(['● 15s', '▲']))
    pending[1].resolve()
    await current
    expect(timers).toHaveLength(1)

    const failed = presenter.show({ kind: 'thinking' })
    expect(timers[0].cleared).toBe(true)
    timers[0].callback()
    await vi.waitFor(() => expect(renders).toEqual(['● 15s', '▲', '○']))
    const recovery = presenter.show({ kind: 'empty' })
    pending[2].reject(new Error('native write failed'))
    await expect(failed).rejects.toThrow('native write failed')
    await vi.waitFor(() => expect(renders).toEqual(['● 15s', '▲', '○', '▼ 上滑']))
    pending[3].resolve()
    await recovery
  })
})
