import { describe, expect, it, vi } from 'vitest'
import { stopGlassesAudio } from '../src/social-listening-lifecycle'

describe('stopGlassesAudio', () => {
  it('retries false and thrown stop attempts until one succeeds', async () => {
    const audioControl = vi.fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('bridge busy'))
      .mockResolvedValueOnce(true)
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(stopGlassesAudio({ audioControl, sleep, retryDelayMs: 1 })).resolves.toEqual({ stopped: true, attempts: 3 })
    expect(audioControl).toHaveBeenCalledTimes(3)
    expect(audioControl).toHaveBeenNthCalledWith(1, false)
    expect(audioControl).toHaveBeenNthCalledWith(2, false)
    expect(audioControl).toHaveBeenNthCalledWith(3, false)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('returns an explicit failure after all stop attempts fail', async () => {
    const audioControl = vi.fn().mockResolvedValue(false)

    await expect(stopGlassesAudio({ audioControl, sleep: vi.fn(), retryDelayMs: 1 })).resolves.toEqual({ stopped: false, attempts: 3 })
    expect(audioControl).toHaveBeenCalledTimes(3)
  })
})

describe('finishAfterBestEffortAudioStop', () => {
  it('continues analysis when the native stop acknowledgement is false', async () => {
    const lifecycle = await import('../src/social-listening-lifecycle')
    const finishAfterStop = (
      lifecycle as unknown as Record<string, unknown>
    ).finishAfterBestEffortAudioStop
    const finish = vi.fn().mockResolvedValue('insight')

    expect(finishAfterStop).toBeTypeOf('function')
    await expect((finishAfterStop as (options: {
      stopAudio: () => Promise<boolean>
      finish: () => Promise<string>
    }) => Promise<string>)({
      stopAudio: async () => false,
      finish,
    })).resolves.toBe('insight')
    expect(finish).toHaveBeenCalledOnce()
  })

  it('keeps the thinking state visible until its minimum delay completes', async () => {
    const { finishAfterBestEffortAudioStop } = await import('../src/social-listening-lifecycle')
    let releaseMinimum!: () => void
    const minimumVisible = new Promise<void>(resolve => {
      releaseMinimum = resolve
    })
    const finish = vi.fn().mockResolvedValue('insight')
    let settled = false

    const result = finishAfterBestEffortAudioStop({
      stopAudio: async () => true,
      finish,
      waitForMinimum: () => minimumVisible,
    }).then(value => {
      settled = true
      return value
    })

    await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(settled).toBe(false)
    releaseMinimum()
    await expect(result).resolves.toBe('insight')
  })
})
