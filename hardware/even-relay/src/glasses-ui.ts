export type GlassesFrame =
  | { kind: 'blank' }
  | { kind: 'listening' }
  | { kind: 'thinking' }
  | { kind: 'ready' }
  | { kind: 'rescue' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'advice'; lines: string[] }

type FrameTimers = {
  setTimeout: (callback: () => void, durationMs: number) => number
  clearTimeout: (handle: number) => void
}

type GlassesFramePresenterOptions = {
  render: (content: string) => Promise<void>
  timers?: FrameTimers
}

export function getGlassesPageLayout() {
  return {
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'snake-main',
    content: ' ',
    isEventCapture: 1,
  }
}

export function createCheckedGlassesWriter(options: {
  update: (content: string) => Promise<boolean>
  report: (diagnostic: string) => void
}) {
  return async (content: string) => {
    const updated = await options.update(content)
    if (updated) {
      options.report('textContainerUpgrade 成功')
      return
    }
    options.report('textContainerUpgrade 失败')
    throw new Error('textContainerUpgrade 失败')
  }
}

export function formatGlassesFrame(frame: GlassesFrame) {
  if (frame.kind === 'blank') return { content: ' ', durationMs: 0 }
  if (frame.kind === 'listening') return { content: '● 15s', durationMs: 0 }
  if (frame.kind === 'thinking') return { content: '○', durationMs: 2000 }
  if (frame.kind === 'ready') return { content: '▲', durationMs: 2000 }
  if (frame.kind === 'rescue') return { content: '■ 已收到', durationMs: 6000 }
  if (frame.kind === 'error') return { content: '□', durationMs: 2000 }
  if (frame.kind === 'empty') return { content: '▼ 上滑', durationMs: 2000 }
  const lines = frame.lines
    .flatMap(line => line.split(/\r\n|[\r\n]/))
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map(line => Array.from(line).slice(0, 18).join(''))
  return {
    content: lines.length ? `♥ ${lines.join('\n')}` : '▼ 上滑',
    durationMs: lines.length ? 6000 : 2000,
  }
}

export function createGlassesFramePresenter({ render, timers = window }: GlassesFramePresenterOptions) {
  let revision = 0
  let timer: number | null = null
  let tail: Promise<void> = Promise.resolve()

  function show(frame: GlassesFrame) {
    const currentRevision = ++revision
    if (timer !== null) timers.clearTimeout(timer)
    timer = null

    const view = formatGlassesFrame(frame)
    const presentation = tail.then(async () => {
      if (currentRevision !== revision) return
      await render(view.content)
      if (currentRevision !== revision) return

      if (view.durationMs > 0) {
        timer = timers.setTimeout(() => {
          if (currentRevision !== revision) return
          void show({ kind: 'blank' })
        }, view.durationMs)
      }
    })
    tail = presentation.catch(() => {})
    return presentation
  }

  return { show }
}
