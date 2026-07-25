import {
  AppLocationAccuracy,
  AudioInputSource,
  CreateStartUpPageContainer,
  EventSourceType,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type AppLocation,
  type DeviceInfo,
  type DeviceStatus,
  type EvenAppBridge,
  type EvenHubEvent,
  type LaunchSource,
} from '@evenrealities/even_hub_sdk'
import { RescueSequenceRecognizer } from './gesture-sequence'
import {
  createCheckedGlassesWriter,
  createGlassesFramePresenter,
  getGlassesPageLayout,
  type GlassesFrame,
} from './glasses-ui'
import {
  finishAfterBestEffortAudioStop,
  stopGlassesAudio,
} from './social-listening-lifecycle'
import {
  routeSocialGesture,
  hasUsableSocialInsight,
  shouldAppendSocialPcm,
  SocialCopilotController,
  type SocialInsight,
  type SocialListeningState,
} from './social-copilot'

type ForwardConfig = {
  endpoint: string
  accessToken: string
  enabled: boolean
  includeRaw: boolean
}

type SourceKind = 'ring' | 'glasses_right' | 'glasses_left' | 'unknown'
type EventEnvelope = 'sysEvent' | 'textEvent' | 'listEvent' | 'audioEvent' | 'unknown'

type NormalizedSource = {
  code?: number
  label: string
  kind: SourceKind
}

type NormalizedEventType = {
  code?: number
  label: string
}

type GestureToken = {
  at: string
  source: SourceKind
  name: string
  label: string
}

type RecognizedAction = {
  name: string
  confidence: number
}

type NormalizedEvent = {
  id: number
  receivedAt: string
  envelope: EventEnvelope
  gesture: string
  source: NormalizedSource
  eventType: NormalizedEventType
  container?: {
    id?: number
    name?: string
  }
  selected?: {
    index?: number
    name?: string
  }
  imu?: {
    x?: number
    y?: number
    z?: number
  }
  audio?: {
    source: string
    byteLength: number
  }
  raw?: unknown
}

type RelayPayload = {
  schema: 'even-r1-relay/v1'
  context: {
    app: {
      url: string
      userAgent: string
      launchSource: LaunchSource | null
    }
    device: unknown
    status: unknown
    location: AppLocation | null
    recentGestures: GestureToken[]
  }
  event: NormalizedEvent
  action: RecognizedAction | null
}

const CONFIG_KEY = 'even-r1-relay.config.v4'
const MAX_LOGS = 40
const SEQUENCE_WINDOW_MS = 2500

const eventTypeLabels: Record<number, string> = {
  [OsEventTypeList.CLICK_EVENT]: 'click',
  [OsEventTypeList.SCROLL_TOP_EVENT]: 'swipe_up',
  [OsEventTypeList.SCROLL_BOTTOM_EVENT]: 'swipe_down',
  [OsEventTypeList.DOUBLE_CLICK_EVENT]: 'double_click',
  [OsEventTypeList.FOREGROUND_ENTER_EVENT]: 'foreground_enter',
  [OsEventTypeList.FOREGROUND_EXIT_EVENT]: 'foreground_exit',
  [OsEventTypeList.ABNORMAL_EXIT_EVENT]: 'abnormal_exit',
  [OsEventTypeList.SYSTEM_EXIT_EVENT]: 'system_exit',
  [OsEventTypeList.IMU_DATA_REPORT]: 'imu',
}

const eventTypeNameToCode: Record<string, number> = {
  CLICK: OsEventTypeList.CLICK_EVENT,
  CLICK_EVENT: OsEventTypeList.CLICK_EVENT,
  SCROLL_TOP: OsEventTypeList.SCROLL_TOP_EVENT,
  SCROLL_TOP_EVENT: OsEventTypeList.SCROLL_TOP_EVENT,
  SWIPE_UP: OsEventTypeList.SCROLL_TOP_EVENT,
  SCROLL_BOTTOM: OsEventTypeList.SCROLL_BOTTOM_EVENT,
  SCROLL_BOTTOM_EVENT: OsEventTypeList.SCROLL_BOTTOM_EVENT,
  SWIPE_DOWN: OsEventTypeList.SCROLL_BOTTOM_EVENT,
  DOUBLE_CLICK: OsEventTypeList.DOUBLE_CLICK_EVENT,
  DOUBLE_CLICK_EVENT: OsEventTypeList.DOUBLE_CLICK_EVENT,
  FOREGROUND_ENTER: OsEventTypeList.FOREGROUND_ENTER_EVENT,
  FOREGROUND_ENTER_EVENT: OsEventTypeList.FOREGROUND_ENTER_EVENT,
  FOREGROUND_EXIT: OsEventTypeList.FOREGROUND_EXIT_EVENT,
  FOREGROUND_EXIT_EVENT: OsEventTypeList.FOREGROUND_EXIT_EVENT,
  ABNORMAL_EXIT: OsEventTypeList.ABNORMAL_EXIT_EVENT,
  ABNORMAL_EXIT_EVENT: OsEventTypeList.ABNORMAL_EXIT_EVENT,
  SYSTEM_EXIT: OsEventTypeList.SYSTEM_EXIT_EVENT,
  SYSTEM_EXIT_EVENT: OsEventTypeList.SYSTEM_EXIT_EVENT,
  IMU_DATA_REPORT: OsEventTypeList.IMU_DATA_REPORT,
  IMU: OsEventTypeList.IMU_DATA_REPORT,
}

const sourceLabels: Record<number, { label: string; kind: SourceKind }> = {
  [EventSourceType.TOUCH_EVENT_FORM_DUMMY_NULL]: { label: 'unknown', kind: 'unknown' },
  [EventSourceType.TOUCH_EVENT_FROM_GLASSES_R]: { label: 'glasses_right', kind: 'glasses_right' },
  [EventSourceType.TOUCH_EVENT_FROM_RING]: { label: 'ring', kind: 'ring' },
  [EventSourceType.TOUCH_EVENT_FROM_GLASSES_L]: { label: 'glasses_left', kind: 'glasses_left' },
}

const sourceNameToCode: Record<string, number> = {
  TOUCH_EVENT_FORM_DUMMY_NULL: EventSourceType.TOUCH_EVENT_FORM_DUMMY_NULL,
  TOUCH_EVENT_FROM_GLASSES_R: EventSourceType.TOUCH_EVENT_FROM_GLASSES_R,
  TOUCH_EVENT_FROM_RING: EventSourceType.TOUCH_EVENT_FROM_RING,
  TOUCH_EVENT_FROM_GLASSES_L: EventSourceType.TOUCH_EVENT_FROM_GLASSES_L,
  GLASSES_R: EventSourceType.TOUCH_EVENT_FROM_GLASSES_R,
  GLASSES_RIGHT: EventSourceType.TOUCH_EVENT_FROM_GLASSES_R,
  RING: EventSourceType.TOUCH_EVENT_FROM_RING,
  GLASSES_L: EventSourceType.TOUCH_EVENT_FROM_GLASSES_L,
  GLASSES_LEFT: EventSourceType.TOUCH_EVENT_FROM_GLASSES_L,
}

let bridge: EvenAppBridge | null = null
let deviceInfo: DeviceInfo | null = null
let deviceStatus: DeviceStatus | null = null
let launchSource: LaunchSource | null = null
let lastLocation: AppLocation | null = null
let glassesReady = false
let eventId = 0
let events: NormalizedEvent[] = []
let sequence: GestureToken[] = []
let lastForwardStatus = '未开始转发'
let deviceDiagnostic = '设备信息未加载'
let glassesDiagnostic = 'G2 页面待创建'
let lastRawEventPreview = '暂无原始事件'
let socialListeningTimer: number | null = null
let socialListeningState: SocialListeningState = 'idle'
let socialCopilot: SocialCopilotController | null = null
let socialListeningRun = 0
let latestSocialInsight: SocialInsight | null = null
const writeGlassesText = createCheckedGlassesWriter({
  update: async content => {
    if (!bridge || !glassesReady) return false
    return bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 1,
      containerName: 'snake-main',
      content,
    }))
  },
  report: diagnostic => {
    glassesDiagnostic = `页面已创建；${diagnostic}`
    renderDiagnostics()
  },
})
const glassesFramePresenter = createGlassesFramePresenter({
  render: writeGlassesText,
})

const app = byId<HTMLDivElement>('app')
app.innerHTML = `
  <main class="shell">
    <section class="panel header">
      <div>
        <p class="eyebrow">Even G2 / R1</p>
        <h1>输入中继控制台</h1>
        <p class="subtitle">捕获戒指与眼镜输入，并转发到你的硬件。</p>
      </div>
      <span id="bridge-status" class="status-pill warn">正在连接…</span>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>转发设置</h2>
        <span id="endpoint-host" class="hint">目标：未设置</span>
      </div>
      <label class="field">
        <span>转发地址（Mac relay 或硬件）</span>
        <input id="endpoint" inputmode="url" placeholder="https://当前-relay-地址/even" />
      </label>
      <label class="field">
        <span>Relay 本地访问令牌</span>
        <input id="access-token" type="password" autocomplete="off" placeholder="仅保存在本机" />
      </label>
      <div class="checks">
        <label class="check-field">
          <input id="enabled" type="checkbox" />
          <span>转发事件</span>
        </label>
        <label class="check-field">
          <input id="include-raw" type="checkbox" />
          <span>包含原始 JSON</span>
        </label>
      </div>
      <div class="button-row">
        <button id="save-config" type="button" class="primary">保存</button>
        <button id="send-test" type="button">发送测试</button>
        <button id="refresh-device" type="button">设备信息</button>
        <button id="refresh-location" type="button">定位</button>
        <button id="close-glasses" type="button" class="danger">关闭 G2</button>
      </div>
    </section>

    <section class="panel status-grid">
      <div>
        <span class="metric-label">最近事件</span>
        <strong id="last-event">无</strong>
      </div>
      <div>
        <span class="metric-label">手势序列</span>
        <strong id="sequence">空</strong>
      </div>
      <div>
        <span class="metric-label">转发状态</span>
        <strong id="forward-status">空闲</strong>
      </div>
      <div>
        <span class="metric-label">设备</span>
        <strong id="context-status">无设备</strong>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>事件日志</h2>
        <button id="clear-log" type="button">清空</button>
      </div>
      <ol id="event-log" class="event-log"></ol>
    </section>

    <section class="panel diagnostics">
      <div class="panel-title">
        <h2>诊断</h2>
      </div>
      <dl>
        <div>
          <dt>设备</dt>
          <dd id="device-diagnostic">设备信息未加载</dd>
        </div>
        <div>
          <dt>G2 页面</dt>
          <dd id="glasses-diagnostic">G2 页面待创建</dd>
        </div>
        <div>
          <dt>原始事件</dt>
          <dd><pre id="raw-event">暂无原始事件</pre></dd>
        </div>
      </dl>
    </section>
  </main>
`

const bridgeStatus = byId<HTMLSpanElement>('bridge-status')
const endpointInput = byId<HTMLInputElement>('endpoint')
const accessTokenInput = byId<HTMLInputElement>('access-token')
const enabledInput = byId<HTMLInputElement>('enabled')
const includeRawInput = byId<HTMLInputElement>('include-raw')
const saveConfigButton = byId<HTMLButtonElement>('save-config')
const sendTestButton = byId<HTMLButtonElement>('send-test')
const refreshDeviceButton = byId<HTMLButtonElement>('refresh-device')
const refreshLocationButton = byId<HTMLButtonElement>('refresh-location')
const closeGlassesButton = byId<HTMLButtonElement>('close-glasses')
const clearLogButton = byId<HTMLButtonElement>('clear-log')
const lastEventEl = byId<HTMLElement>('last-event')
const sequenceEl = byId<HTMLElement>('sequence')
const forwardStatusEl = byId<HTMLElement>('forward-status')
const contextStatusEl = byId<HTMLElement>('context-status')
const eventLogEl = byId<HTMLOListElement>('event-log')
const deviceDiagnosticEl = byId<HTMLElement>('device-diagnostic')
const glassesDiagnosticEl = byId<HTMLElement>('glasses-diagnostic')
const rawEventEl = byId<HTMLPreElement>('raw-event')
const endpointHostEl = byId<HTMLElement>('endpoint-host')

const initialConfig = loadConfig()
const rescueSequenceRecognizer = new RescueSequenceRecognizer()
endpointInput.value = initialConfig.endpoint
accessTokenInput.value = initialConfig.accessToken
enabledInput.checked = initialConfig.enabled
includeRawInput.checked = initialConfig.includeRaw

saveConfigButton.addEventListener('click', () => {
  saveConfig(readConfigFromControls())
  setForwardStatus('配置已保存')
  renderEndpointHost()
})

for (const input of [endpointInput, accessTokenInput, enabledInput, includeRawInput]) {
  input.addEventListener('change', () => {
    saveConfig(readConfigFromControls())
    renderEndpointHost()
  })
}

sendTestButton.addEventListener('click', () => {
  void handleTestEvent()
})

refreshDeviceButton.addEventListener('click', () => {
  void loadDeviceInfo()
})

refreshLocationButton.addEventListener('click', () => {
  void refreshLocation()
})

closeGlassesButton.addEventListener('click', () => {
  void bridge?.shutDownPageContainer(1)
})

clearLogButton.addEventListener('click', () => {
  events = []
  sequence = []
  render()
  void showGlassesFrame({ kind: 'blank' })
})

void boot()

async function boot() {
  renderEndpointHost()
  bridge = await waitForBridgeWithTimeout(7000)

  if (!bridge) {
    setBridgeStatus('桥接不可用', 'warn')
    setForwardStatus('请在 Even App 内打开以捕获 R1/G2 事件')
    render()
    return
  }

  setBridgeStatus('桥接已连接', 'ok')

  await Promise.all([loadDeviceInfo(), createGlassesPage()])

  bridge.onLaunchSource(source => {
    launchSource = source
    renderContext()
  })

  bridge.onDeviceStatusChanged(status => {
    deviceStatus = status
    renderContext()
  })

  bridge.onEvenHubEvent(event => {
    if (event.audioEvent) {
      if (socialCopilot && shouldAppendSocialPcm(
        socialListeningState,
        event.audioEvent.source,
        AudioInputSource.Glasses,
      )) {
        socialCopilot.appendPcm(event.audioEvent.audioPcm)
      }
      return
    }
    void handleEvenHubEvent(event)
  })

  render()
  void showGlassesFrame({ kind: 'blank' })
}

async function waitForBridgeWithTimeout(timeoutMs: number): Promise<EvenAppBridge | null> {
  try {
    return await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), timeoutMs)),
    ])
  } catch (error) {
    console.warn('Even bridge unavailable:', error)
    return null
  }
}

async function loadDeviceInfo() {
  if (!bridge) return

  try {
    deviceInfo = await bridge.getDeviceInfo()
    deviceStatus = deviceInfo?.status ?? null
    deviceDiagnostic = deviceInfo
      ? previewJson(toPlainValue(deviceInfo), 240)
      : 'getDeviceInfo 返回 null。请检查 G2/R1 是否已配对、已连接，以及本页是否从 Even App 内（设备已连接）打开。'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deviceDiagnostic = `getDeviceInfo 失败：${message}`
    console.warn('Failed to load device info:', error)
  }

  renderContext()
  renderDiagnostics()
}

async function createGlassesPage() {
  if (!bridge) return

  const mainText = new TextContainerProperty(getGlassesPageLayout())

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [mainText],
    }),
  )

  glassesReady = result === 0
  glassesDiagnostic = glassesReady
    ? 'createStartUpPageContainer 成功'
    : `createStartUpPageContainer 失败：${String(result)}`
  console.log('G2 page created:', glassesReady ? 'success' : `failed (${result})`)
}

async function handleEvenHubEvent(event: EvenHubEvent) {
  lastRawEventPreview = previewJson(event.jsonData ?? toPlainValue(event), 500)
  const normalized = normalizeEvent(event)
  if (!normalized) {
    renderDiagnostics()
    return
  }

  let action = updateGestureSequence(normalized)
  if (
    normalized.source.kind === 'ring' &&
    (normalized.eventType.label === 'click' || normalized.eventType.label === 'double_click')
  ) {
    const rescueAction = rescueSequenceRecognizer.push(normalized.eventType.label, Date.parse(normalized.receivedAt))
    if (rescueAction) action = { name: rescueAction, confidence: 1 }
  }
  events = [normalized, ...events].slice(0, MAX_LOGS)
  render()

  if (action?.name === 'snake1_rescue') await showGlassesFrame({ kind: 'rescue' })

  const socialRoute = routeSocialGesture(normalized.gesture)
  if (socialRoute === 'toggle') {
    await toggleSocialListening()
  } else if (socialRoute === 'view') {
    await showLatestSocialInsight()
    return
  }

  const config = readConfigFromControls()
  if (config.enabled && config.endpoint.trim()) {
    await forwardEvent(normalized, action)
  }

  if (
    bridge &&
    normalized.eventType.code === OsEventTypeList.DOUBLE_CLICK_EVENT &&
    (normalized.source.kind === 'glasses_left' || normalized.source.kind === 'glasses_right')
  ) {
    await bridge.shutDownPageContainer(1)
  }
}

async function toggleSocialListening() {
  if (!bridge) return
  if (socialListeningState === 'active') {
    await finishSocialListening()
    return
  }
  if (socialListeningState === 'error') {
    await retrySocialMicrophoneStop()
    return
  }
  if (socialListeningState === 'stopping') return
  if (socialListeningState !== 'idle') return

  const config = readConfigFromControls()
  const controller = new SocialCopilotController({
    eventEndpoint: config.endpoint,
    accessToken: config.accessToken,
  })
  const run = ++socialListeningRun
  socialListeningState = 'starting'
  socialCopilot = controller
  await showGlassesFrame({ kind: 'listening' })
  try {
    await controller.start()
    if (socialListeningState !== 'starting' || socialCopilot !== controller || run !== socialListeningRun) {
      await controller.cancel()
      return
    }
    const enabled = await bridge.audioControl(true, AudioInputSource.Glasses)
    if (!enabled) throw new Error('Glasses microphone unavailable')
    socialListeningState = 'active'
    socialListeningTimer = window.setTimeout(() => {
      void finishSocialListening()
    }, 15_000)
  } catch (error) {
    console.warn('Social listening failed to start:', error)
    await resetSocialListening(controller, run)
    await showGlassesFrame({ kind: 'error' })
  }
}

async function finishSocialListening() {
  if (!bridge || socialListeningState !== 'active' || !socialCopilot) return
  const controller = socialCopilot
  const run = socialListeningRun
  socialListeningState = 'finishing'
  clearSocialListeningTimer()
  try {
    await showGlassesFrame({ kind: 'thinking' })
    const insight = await finishAfterBestEffortAudioStop({
      stopAudio: stopSocialMicrophone,
      finish: () => controller.finish(),
      waitForMinimum: () => new Promise(resolve => window.setTimeout(resolve, 1200)),
    })
    if (socialCopilot !== controller || run !== socialListeningRun) return
    latestSocialInsight = insight
    await showGlassesFrame(hasUsableSocialInsight(insight) ? { kind: 'ready' } : { kind: 'blank' })
  } catch (error) {
    console.warn('Social analysis failed:', error)
    if (socialCopilot === controller && run === socialListeningRun) {
      await showGlassesFrame({ kind: 'error' })
    }
  } finally {
    await resetSocialListening(controller, run, true)
  }
}

function clearSocialListeningTimer() {
  if (socialListeningTimer !== null) window.clearTimeout(socialListeningTimer)
  socialListeningTimer = null
}

async function stopSocialMicrophone() {
  if (!bridge) return false
  const result = await stopGlassesAudio({
    audioControl: bridge.audioControl.bind(bridge),
  })
  return result.stopped
}

async function retrySocialMicrophoneStop() {
  socialListeningState = 'stopping'
  const stopped = await stopSocialMicrophone()
  socialListeningState = 'idle'
  if (stopped) setForwardStatus('眼镜麦克风已停止')
  else setForwardStatus('已发送眼镜麦克风停止命令')
}

async function resetSocialListening(
  controller: SocialCopilotController,
  run: number,
  microphoneStopAttempted = false,
) {
  clearSocialListeningTimer()
  if (!microphoneStopAttempted) await stopSocialMicrophone()
  try {
    await controller.cancel()
  } catch (error) {
    console.warn('Failed to cancel social session:', error)
  }
  if (socialCopilot === controller && run === socialListeningRun) {
    socialCopilot = null
    socialListeningState = 'idle'
  }
}

async function showLatestSocialInsight() {
  const insight = latestSocialInsight
  if (!insight || Date.now() >= insight.expiresAt) {
    await showGlassesFrame({ kind: 'empty' })
    return
  }
  await showGlassesFrame({ kind: 'advice', lines: insight.suggestion })
}

async function showGlassesFrame(frame: GlassesFrame) {
  if (!bridge || !glassesReady) return
  try {
    await glassesFramePresenter.show(frame)
  } catch (error) {
    console.warn('Failed to update glasses:', error)
  }
}

function normalizeEvent(event: EvenHubEvent): NormalizedEvent | null {
  const envelope = getEnvelope(event)
  const typedPayload = getTypedPayload(event, envelope)
  const raw = event.jsonData ?? toPlainValue(envelope === 'unknown' ? event : typedPayload)
  if (envelope === 'unknown' && isEmptyRaw(raw)) return null

  const eventType = normalizeEventType(readPayloadEventType(typedPayload, raw, envelope))
  const source = normalizeSource(readPayloadSource(typedPayload, raw))
  const container = readContainer(typedPayload, raw)
  const selected = readSelected(typedPayload, raw)
  const imu = readImu(typedPayload, raw)
  const audio = readAudio(typedPayload)
  const gesture = buildGestureLabel(source, eventType, envelope)

  return {
    id: ++eventId,
    receivedAt: new Date().toISOString(),
    envelope,
    gesture,
    source,
    eventType,
    container,
    selected,
    imu,
    audio,
    raw,
  }
}

async function handleTestEvent() {
  const event = createTestEvent()
  const action = updateGestureSequence(event) ?? { name: 'ring_select', confidence: 0.8 }

  lastRawEventPreview = previewJson(event.raw, 500)
  events = [event, ...events].slice(0, MAX_LOGS)
  render()

  if (action.name === 'snake1_rescue') await showGlassesFrame({ kind: 'rescue' })
  await forwardEvent(event, action)
}

function getEnvelope(event: EvenHubEvent): EventEnvelope {
  if (event.sysEvent) return 'sysEvent'
  if (event.textEvent) return 'textEvent'
  if (event.listEvent) return 'listEvent'
  if (event.audioEvent) return 'audioEvent'
  return 'unknown'
}

function getTypedPayload(event: EvenHubEvent, envelope: EventEnvelope): unknown {
  if (envelope === 'sysEvent') return event.sysEvent
  if (envelope === 'textEvent') return event.textEvent
  if (envelope === 'listEvent') return event.listEvent
  if (envelope === 'audioEvent') return event.audioEvent
  return null
}

function readPayloadEventType(payload: unknown, raw: unknown, envelope: EventEnvelope): unknown {
  const typedValue = readLoose(payload, ['eventType'])
  const rawValue = readLoose(raw, ['eventType', 'Event_Type', 'event_type', 'type'])

  if (typedValue !== undefined) return typedValue
  if (rawValue !== undefined) return rawValue

  if (envelope === 'sysEvent' || envelope === 'textEvent' || envelope === 'listEvent') {
    return OsEventTypeList.CLICK_EVENT
  }

  return undefined
}

function readPayloadSource(payload: unknown, raw: unknown): unknown {
  const typedValue = readLoose(payload, ['eventSource'])
  if (typedValue !== undefined) return typedValue

  return readLoose(raw, ['eventSource', 'EventSource', 'event_source', 'source', 'Source'])
}

function normalizeEventType(value: unknown): NormalizedEventType {
  const code = toEnumCode(value, eventTypeNameToCode)
  return {
    code,
    label: code === undefined ? 'unknown' : eventTypeLabels[code] ?? `event_${code}`,
  }
}

function normalizeSource(value: unknown): NormalizedSource {
  const code = toEnumCode(value, sourceNameToCode)
  const source = code === undefined ? undefined : sourceLabels[code]

  return {
    code,
    label: source?.label ?? 'unknown',
    kind: source?.kind ?? 'unknown',
  }
}

function toEnumCode(value: unknown, nameMap: Record<string, number>): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const asNumber = Number(trimmed)
    if (Number.isFinite(asNumber)) return asNumber

    const normalized = trimmed.split('.').pop()?.toUpperCase()
    if (normalized && normalized in nameMap) return nameMap[normalized]
  }

  return undefined
}

function buildGestureLabel(source: NormalizedSource, eventType: NormalizedEventType, envelope: EventEnvelope): string {
  if (envelope === 'audioEvent') return 'audio.frame'
  if (eventType.label === 'imu') return `${source.kind}.imu`
  return `${source.kind}.${eventType.label}`
}

function readContainer(payload: unknown, raw: unknown): NormalizedEvent['container'] {
  const id = readNumberFrom(payload, raw, ['containerID', 'Container_ID', 'containerId'])
  const name = readStringFrom(payload, raw, ['containerName', 'Container_Name', 'container'])
  if (id === undefined && name === undefined) return undefined
  return { id, name }
}

function readSelected(payload: unknown, raw: unknown): NormalizedEvent['selected'] {
  const index = readNumberFrom(payload, raw, ['currentSelectItemIndex', 'CurrentSelect_ItemIndex', 'selectedIndex'])
  const name = readStringFrom(payload, raw, ['currentSelectItemName', 'CurrentSelect_ItemName', 'selectedName'])
  if (index === undefined && name === undefined) return undefined
  return { index, name }
}

function readImu(payload: unknown, raw: unknown): NormalizedEvent['imu'] {
  const imuValue = readLoose(payload, ['imuData', 'IMU_Data']) ?? readLoose(raw, ['imuData', 'IMU_Data', 'imu'])
  if (!isRecord(imuValue)) return undefined

  return {
    x: readNumberFrom(imuValue, imuValue, ['x', 'X']),
    y: readNumberFrom(imuValue, imuValue, ['y', 'Y']),
    z: readNumberFrom(imuValue, imuValue, ['z', 'Z']),
  }
}

function readAudio(payload: unknown): NormalizedEvent['audio'] {
  if (!isRecord(payload)) return undefined

  const source = String(readLoose(payload, ['source']) ?? 'unknown')
  const audioPcm = readLoose(payload, ['audioPcm'])
  const byteLength = audioPcm instanceof Uint8Array ? audioPcm.byteLength : Array.isArray(audioPcm) ? audioPcm.length : 0

  return { source, byteLength }
}

function updateGestureSequence(event: NormalizedEvent): RecognizedAction | null {
  const now = Date.parse(event.receivedAt)
  sequence = sequence.filter(item => now - Date.parse(item.at) <= SEQUENCE_WINDOW_MS)

  if (isGestureEvent(event)) {
    sequence.push({
      at: event.receivedAt,
      source: event.source.kind,
      name: event.eventType.label,
      label: event.gesture,
    })
  }

  return recognizeAction(sequence)
}

function isGestureEvent(event: NormalizedEvent): boolean {
  return ['click', 'double_click', 'swipe_up', 'swipe_down'].includes(event.eventType.label)
}

function recognizeAction(tokens: GestureToken[]): RecognizedAction | null {
  const recent = tokens.slice(-2).map(token => token.label).join(' ')
  const last = tokens.at(-1)?.label

  if (recent === 'ring.swipe_up ring.click') return { name: 'ring_confirm_up', confidence: 0.95 }
  if (recent === 'ring.swipe_down ring.click') return { name: 'ring_confirm_down', confidence: 0.95 }
  if (recent === 'ring.double_click ring.swipe_up') return { name: 'ring_debug_context', confidence: 0.85 }
  if (last === 'ring.click') return { name: 'ring_select', confidence: 0.8 }
  if (last === 'ring.double_click') return { name: 'ring_cancel_or_shortcut', confidence: 0.8 }
  if (last === 'ring.swipe_up') return { name: 'ring_previous', confidence: 0.75 }
  if (last === 'ring.swipe_down') return { name: 'ring_next', confidence: 0.75 }

  return null
}

async function forwardEvent(event: NormalizedEvent, action: RecognizedAction | null) {
  const config = readConfigFromControls()
  saveConfig(config)

  if (!config.endpoint.trim()) {
    setForwardStatus('未设置转发地址')
    return
  }

  const payload = buildRelayPayload(event, action, config.includeRaw)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(config.endpoint.trim(), {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    setForwardStatus(`转发成功 ${formatTime(new Date())}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setForwardStatus(`转发失败：${message}`)
  } finally {
    window.clearTimeout(timeout)
  }
}

function buildRelayPayload(event: NormalizedEvent, action: RecognizedAction | null, includeRaw: boolean): RelayPayload {
  const relayEvent = includeRaw ? event : { ...event, raw: undefined }

  return {
    schema: 'even-r1-relay/v1',
    context: {
      app: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        launchSource,
      },
      device: toPlainValue(deviceInfo),
      status: toPlainValue(deviceStatus),
      location: lastLocation,
      recentGestures: sequence.slice(-8),
    },
    event: relayEvent,
    action,
  }
}

function createTestEvent(): NormalizedEvent {
  return {
    id: ++eventId,
    receivedAt: new Date().toISOString(),
    envelope: 'sysEvent',
    gesture: 'ring.click',
    source: { code: EventSourceType.TOUCH_EVENT_FROM_RING, label: 'ring', kind: 'ring' },
    eventType: { code: OsEventTypeList.CLICK_EVENT, label: 'click' },
    raw: { test: true, eventSource: EventSourceType.TOUCH_EVENT_FROM_RING, eventType: OsEventTypeList.CLICK_EVENT },
  }
}

async function refreshLocation() {
  if (!bridge) {
    setForwardStatus('Bridge unavailable')
    return
  }

  try {
    lastLocation = await bridge.getAppLocation({
      accuracy: AppLocationAccuracy.Medium,
      timeoutMs: 5000,
    })
    renderContext()
    setForwardStatus(lastLocation ? 'Location updated' : 'Location unavailable')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setForwardStatus(`Location failed: ${message}`)
  }
}

function render() {
  lastEventEl.textContent = events[0]?.gesture ?? '无'
  sequenceEl.textContent = sequence.slice(-4).map(item => item.label).join(' → ') || '空'
  forwardStatusEl.textContent = lastForwardStatus
  renderContext()
  renderLog()
  renderDiagnostics()
}

/** 转发目标主机提示 */
function renderEndpointHost() {
  const endpoint = readConfigFromControls().endpoint
  if (!endpoint) {
    endpointHostEl.textContent = '目标：未设置'
    return
  }
  try {
    const url = new URL(endpoint)
    endpointHostEl.textContent = `目标：${url.host}`
  } catch {
    endpointHostEl.textContent = '目标：地址无效'
  }
}

function renderContext() {
  const model = deviceInfo?.model ?? '无设备'
  const battery = deviceStatus?.batteryLevel === undefined ? '' : ` ${deviceStatus.batteryLevel}%`
  const location = lastLocation ? ' 已定位' : ''
  contextStatusEl.textContent = `${model}${battery}${location}`
}

function renderLog() {
  if (events.length === 0) {
    eventLogEl.innerHTML = '<li class="empty">暂无捕获事件</li>'
    return
  }

  eventLogEl.innerHTML = events
    .map(event => {
      const detail = [
        event.envelope,
        event.container?.name,
        event.selected?.name,
        event.imu ? `imu ${formatNumber(event.imu.x)},${formatNumber(event.imu.y)},${formatNumber(event.imu.z)}` : '',
      ]
        .filter(Boolean)
        .join(' | ')

      return `
        <li>
          <time>${escapeHtml(formatTime(new Date(event.receivedAt)))}</time>
          <strong>${escapeHtml(event.gesture)}</strong>
          <span>${escapeHtml(detail || 'event')}</span>
        </li>
      `
    })
    .join('')
}

function renderDiagnostics() {
  deviceDiagnosticEl.textContent = deviceDiagnostic
  glassesDiagnosticEl.textContent = glassesDiagnostic
  rawEventEl.textContent = lastRawEventPreview
}

function setBridgeStatus(text: string, mode: 'ok' | 'warn') {
  bridgeStatus.textContent = text
  bridgeStatus.className = `status-pill ${mode}`
}

function setForwardStatus(text: string) {
  lastForwardStatus = text
  forwardStatusEl.textContent = text
}

function readConfigFromControls(): ForwardConfig {
  return {
    endpoint: endpointInput.value.trim(),
    accessToken: accessTokenInput.value,
    enabled: enabledInput.checked,
    includeRaw: includeRawInput.checked,
  }
}

function loadConfig(): ForwardConfig {
  const secureDefaults: ForwardConfig = {
    endpoint: '',
    accessToken: '',
    enabled: false,
    includeRaw: true,
  }
  const buildEndpoint = import.meta.env.VITE_DEFAULT_FORWARD_URL?.trim() ?? ''
  const buildAccessToken = import.meta.env.VITE_DEFAULT_RELAY_TOKEN ?? ''
  const fallback: ForwardConfig = {
    ...secureDefaults,
    endpoint: buildEndpoint || secureDefaults.endpoint,
    accessToken: buildAccessToken || secureDefaults.accessToken,
    enabled: Boolean(buildEndpoint && buildAccessToken),
  }

  try {
    const raw = window.localStorage.getItem(CONFIG_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<ForwardConfig>
    return {
      endpoint: parsed.endpoint ?? fallback.endpoint,
      accessToken: parsed.accessToken ?? fallback.accessToken,
      enabled: parsed.enabled ?? fallback.enabled,
      includeRaw: parsed.includeRaw ?? fallback.includeRaw,
    }
  } catch {
    return fallback
  }
}

function saveConfig(config: ForwardConfig) {
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

function readNumberFrom(primary: unknown, fallback: unknown, keys: string[]): number | undefined {
  const value = readLoose(primary, keys) ?? readLoose(fallback, keys)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }

  return undefined
}

function readStringFrom(primary: unknown, fallback: unknown, keys: string[]): string | undefined {
  const value = readLoose(primary, keys) ?? readLoose(fallback, keys)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function readLoose(value: unknown, keys: string[]): unknown {
  if (!isRecord(value)) return undefined

  for (const key of keys) {
    if (key in value) return value[key]
  }

  const normalizedEntries = new Map(
    Object.entries(value).map(([key, entryValue]) => [key.toLowerCase().replaceAll('_', ''), entryValue]),
  )

  for (const key of keys) {
    const normalized = key.toLowerCase().replaceAll('_', '')
    if (normalizedEntries.has(normalized)) return normalizedEntries.get(normalized)
  }

  return undefined
}

function toPlainValue(value: unknown): unknown {
  if (value == null) return null

  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEmptyRaw(value: unknown): boolean {
  if (value == null) return true
  if (isRecord(value)) return Object.keys(value).length === 0
  return false
}

function previewJson(value: unknown, maxLength: number): string {
  let output: string

  try {
    output = JSON.stringify(value, null, 2)
  } catch {
    output = String(value)
  }

  return output.length > maxLength ? `${output.slice(0, maxLength)}...` : output
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(2)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[char] ?? char
  })
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}
