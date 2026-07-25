export type StopGlassesAudioOptions = {
  audioControl: (isOpen: boolean) => Promise<boolean>
  maxAttempts?: number
  retryDelayMs?: number
  sleep?: (delayMs: number) => Promise<void>
}

export async function stopGlassesAudio({
  audioControl,
  maxAttempts = 3,
  retryDelayMs = 150,
  sleep = delay => new Promise(resolve => window.setTimeout(resolve, delay)),
}: StopGlassesAudioOptions): Promise<{ stopped: boolean; attempts: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (await audioControl(false)) return { stopped: true, attempts: attempt }
    } catch {
      // A bridge rejection is retried with the same bounded policy as false.
    }
    if (attempt < maxAttempts) await sleep(retryDelayMs)
  }
  return { stopped: false, attempts: maxAttempts }
}
