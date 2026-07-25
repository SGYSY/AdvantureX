import WebSocket from 'ws'
import { SOCIAL_COPILOT_INSTRUCTIONS } from './social-copilot-prompt.mjs'

export class StepFunRealtimeSession {
  constructor({
    apiKey,
    model = 'stepaudio-2.5-realtime',
    baseUrl = 'wss://api.stepfun.com/step_plan/v1/realtime',
    resolvedIp = '',
    localAddress = '',
    timeoutMs = 60_000,
    socketFactory,
  }) {
    if (!apiKey) throw new Error('STEPFUN_API_KEY is required')
    this.apiKey = apiKey
    this.model = model
    this.baseUrl = baseUrl
    this.resolvedIp = resolvedIp.trim()
    this.localAddress = localAddress.trim()
    this.timeoutMs = timeoutMs
    this.socketFactory = socketFactory
    this.socket = null
    this.intentionalCloseSocket = null
    this.text = ''
    this.audioTranscript = ''
    this.startResolve = null
    this.startReject = null
    this.startTimer = null
    this.finishResolve = null
    this.finishReject = null
    this.finishTimer = null
  }

  start() {
    if (this.socket) return Promise.reject(new Error('StepFun session is already started'))
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}?model=${encodeURIComponent(this.model)}`
      const connectionOptions = {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        ...(this.localAddress ? { localAddress: this.localAddress } : {}),
        ...(this.resolvedIp ? {
          lookup: (_hostname, _options, callback) => {
            callback(null, this.resolvedIp, this.resolvedIp.includes(':') ? 6 : 4)
          },
        } : {}),
      }
      const socket = this.socketFactory
        ? this.socketFactory(url, connectionOptions)
        : new WebSocket(url, connectionOptions)
      this.socket = socket
      this.startResolve = resolve
      this.startReject = reject
      this.startTimer = setTimeout(() => {
        this.rejectStart(new Error('StepFun connection timeout'))
        this.closeSocket(socket, true)
      }, this.timeoutMs)
      socket.on('open', () => {})
      socket.on('message', raw => {
        try {
          if (socket !== this.socket) return
          const event = JSON.parse(raw.toString())
          if (event.type === 'session.created') {
            socket.send(JSON.stringify({
              type: 'session.update',
              session: {
                modalities: ['text', 'audio'],
                instructions: SOCIAL_COPILOT_INSTRUCTIONS,
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                turn_detection: null,
              },
            }))
            return
          }
          if (event.type === 'session.updated') {
            this.resolveStart()
            return
          }
          if (event.type === 'response.text.delta') this.text += event.delta ?? ''
          if (event.type === 'response.audio_transcript.delta') this.audioTranscript += event.delta ?? ''
          if (event.type === 'response.done' && this.finishResolve) {
            this.resolveFinish(this.text || this.audioTranscript)
            this.closeSocket(socket, true)
          }
          if (event.type === 'error') this.fail(new Error(event.error?.message ?? 'StepFun realtime error'))
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
        }
      })
      socket.on('error', error => {
        if (socket === this.socket) this.fail(error)
      })
      socket.on('close', () => {
        if (this.intentionalCloseSocket === socket) {
          this.intentionalCloseSocket = null
          return
        }
        if (socket !== this.socket) return
        this.socket = null
        this.rejectPending(new Error('StepFun session closed'))
      })
    })
  }

  append(audio) {
    if (!this.socket) throw new Error('StepFun session is not started')
    this.socket.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio,
    }))
  }

  finish() {
    if (!this.socket) return Promise.reject(new Error('StepFun session is not started'))
    if (this.finishReject) return Promise.reject(new Error('StepFun analysis already in progress'))
    return new Promise((resolve, reject) => {
      const socket = this.socket
      this.finishResolve = value => {
        clearTimeout(this.finishTimer)
        this.finishTimer = null
        this.finishResolve = null
        this.finishReject = null
        resolve(value)
      }
      this.finishReject = error => {
        clearTimeout(this.finishTimer)
        this.finishTimer = null
        this.finishResolve = null
        this.finishReject = null
        reject(error)
      }
      this.finishTimer = setTimeout(() => {
        this.rejectFinish(new Error('StepFun analysis timeout'))
        this.closeSocket(socket, true)
      }, this.timeoutMs)
      try {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
        socket.send(JSON.stringify({
          type: 'response.create',
          response: { modalities: ['text'] },
        }))
      } catch (error) {
        this.fail(error)
      }
    })
  }

  close() {
    const socket = this.socket
    this.rejectPending(new Error('StepFun session closed'))
    this.closeSocket(socket, true)
  }

  resolveStart() {
    clearTimeout(this.startTimer)
    this.startTimer = null
    const resolve = this.startResolve
    this.startResolve = null
    this.startReject = null
    resolve?.()
  }

  rejectStart(error) {
    clearTimeout(this.startTimer)
    this.startTimer = null
    const reject = this.startReject
    this.startResolve = null
    this.startReject = null
    reject?.(error)
  }

  resolveFinish(value) {
    this.finishResolve?.(value)
  }

  rejectFinish(error) {
    this.finishReject?.(error)
  }

  rejectPending(error) {
    this.rejectStart(error)
    this.rejectFinish(error)
  }

  fail(error) {
    const socket = this.socket
    this.rejectPending(error)
    this.closeSocket(socket, true)
  }

  closeSocket(socket, intentional) {
    if (!socket) return
    if (intentional) this.intentionalCloseSocket = socket
    if (this.socket === socket) this.socket = null
    socket.close()
  }
}
