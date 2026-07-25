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
