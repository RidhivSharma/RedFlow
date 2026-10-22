import pcmWorkletSource from './pcm-capture.worklet.js?raw'
import { encodePcm16Wav, RECORDER_MAX_UTTERANCE_MS, RECORDER_SAMPLE_RATE } from '../../shared/audio'
import type {
  CaptureErrorCode,
  DictationAudioPayload,
  DictationBeginPayload,
  DictationCaptureErrorPayload,
  DictationSessionPayload,
  MicrophoneDevice,
  RecorderSetDevicePayload,
  RecorderStatusPayload,
  RecorderTestMonitorPayload
} from '../../shared/ipc'

/** 100 ms at 16 kHz: small enough for a snappy stop, large enough to keep IPC quiet. */
const CHUNK_FRAMES = 1600
const WORKLET_NAME = 'murmur-pcm-capture'
/** ~15 fps keeps the overlay meter lively without flooding IPC. */
const LEVEL_INTERVAL_MS = 66
/** RMS range mapped to the meter: -54 dBFS is silence, -6 dBFS is full scale. */
const LEVEL_FLOOR_DB = -54
const LEVEL_CEILING_DB = -6

interface CapturePipeline {
  readonly context: AudioContext
  readonly stream: MediaStream
  readonly node: AudioWorkletNode
  readonly analyser: AnalyserNode
}

interface WorkletChunkMessage {
  readonly type: 'chunk'
  readonly samples: ArrayBuffer
}

interface WorkletEndedMessage {
  readonly type: 'ended'
  readonly frames: number
  readonly capReached: boolean
}

type WorkletMessage = WorkletChunkMessage | WorkletEndedMessage

/** A setup failure with a user-facing message that is not a `getUserMedia` DOMException. */
class CaptureSetupError extends Error {
  readonly code: CaptureErrorCode

  constructor(code: CaptureErrorCode, message: string) {
    super(message)
    this.name = 'CaptureSetupError'
    this.code = code
  }
}

let pipeline: CapturePipeline | null = null
let pipelinePromise: Promise<CapturePipeline> | null = null
let activeSessionId: string | null = null
let activeMaxDurationMs = RECORDER_MAX_UTTERANCE_MS
let chunks: Int16Array[] = []
let frameCount = 0
let levelTimer: number | null = null
let preferredDeviceId: string | null = null
let configurationPromise: Promise<void> | null = null
let deviceChangePending = false
let pipelineRestartPromise: Promise<void> | null = null
let testMonitorEnabled = false
let testMonitorTimer: number | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkletMessage(value: unknown): value is WorkletMessage {
  if (!isRecord(value)) {
    return false
  }

  if (value['type'] === 'chunk') {
    return value['samples'] instanceof ArrayBuffer
  }

  if (value['type'] === 'ended') {
    return (
      typeof value['frames'] === 'number' &&
      Number.isFinite(value['frames']) &&
      value['frames'] >= 0 &&
      typeof value['capReached'] === 'boolean'
    )
  }

  return false
}

function describeCaptureError(error: unknown): { code: CaptureErrorCode; message: string } {
  if (error instanceof CaptureSetupError) {
    return { code: error.code, message: error.message }
  }

  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return {
          code: 'permission-denied',
          message:
            'Microphone access is blocked. Open Windows Settings > Privacy & security > Microphone, allow desktop apps to use the microphone, then try again.'
        }
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return {
          code: 'no-device',
          message: 'No microphone was found. Connect a microphone and try again.'
        }
      case 'NotReadableError':
      case 'TrackStartError':
      case 'AbortError':
        return {
          code: 'device-busy',
          message:
            'The microphone is in use by another app or is unavailable. Close the other app and try again.'
        }
      case 'OverconstrainedError':
        return {
          code: 'no-device',
          message:
            preferredDeviceId === null
              ? 'The microphone does not support the audio format Murmur needs.'
              : 'The selected microphone is unavailable. Choose another microphone in Settings.'
        }
      default:
        return {
          code: 'capture-failed',
          message: `Microphone capture failed (${error.name}): ${error.message}`
        }
    }
  }

  if (error instanceof Error) {
    return { code: 'capture-failed', message: `Microphone capture failed: ${error.message}` }
  }

  return { code: 'unknown', message: 'Microphone capture failed.' }
}

function reportCaptureError(sessionId: string, error: unknown): void {
  const description = describeCaptureError(error)
  console.error(`[murmur recorder] ${description.message}`, error)
  const payload: DictationCaptureErrorPayload = {
    sessionId,
    code: description.code,
    message: description.message
  }
  window.murmurRecorder.reportCaptureError(payload)
}

function reportStatus(status: RecorderStatusPayload): void {
  window.murmurRecorder.reportStatus(status)
}

async function loadConfiguration(): Promise<void> {
  try {
    const config = await window.murmurRecorder.getConfig()
    preferredDeviceId = config.microphoneId
    console.log(
      `[murmur recorder] microphone: ${preferredDeviceId === null ? 'system default' : preferredDeviceId}`
    )
  } catch (error) {
    console.error('[murmur recorder] could not read the recorder configuration', error)
  }
}

function ensureConfiguration(): Promise<void> {
  configurationPromise ??= loadConfiguration()
  return configurationPromise
}

async function reportDeviceList(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const microphones: MicrophoneDevice[] = []
    const seen = new Set<string>()

    for (const device of devices) {
      if (device.kind !== 'audioinput' || device.deviceId === '' || seen.has(device.deviceId)) {
        continue
      }
      seen.add(device.deviceId)
      const label = device.label.trim()
      microphones.push({
        deviceId: device.deviceId,
        label: label === '' ? `Microphone ${microphones.length + 1}` : label
      })
      if (microphones.length >= 64) {
        break
      }
    }

    window.murmurRecorder.reportDevices({ devices: microphones })
  } catch (error) {
    console.error('[murmur recorder] could not list microphones', error)
  }
}

/**
 * Converts one analyser window into a 0–1 value on a dBFS scale. Raw RMS would
 * make normal speech move the meter only a few pixels, so the range from
 * -54 dB (silence/noise floor) to -6 dB (loud speech) is spread across 0–1.
 */
function readLevel(analyser: AnalyserNode): number {
  const samples = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(samples)

  let sum = 0
  for (const sample of samples) {
    sum += sample * sample
  }

  const rms = Math.sqrt(sum / samples.length)
  if (rms <= 0) {
    return 0
  }

  const decibels = 20 * Math.log10(rms)
  const normalized = (decibels - LEVEL_FLOOR_DB) / (LEVEL_CEILING_DB - LEVEL_FLOOR_DB)
  return Math.min(1, Math.max(0, normalized))
}

function stopLevelMonitor(): void {
  if (levelTimer !== null) {
    window.clearInterval(levelTimer)
    levelTimer = null
  }
}

function startLevelMonitor(sessionId: string): void {
  stopLevelMonitor()
  const active = pipeline
  if (active === null) {
    return
  }

  const sendSample = (): void => {
    // The utterance can end between two timer ticks; never send a level for a
    // session main no longer considers active.
    if (activeSessionId !== sessionId || pipeline === null) {
      stopLevelMonitor()
      return
    }

    window.murmurRecorder.sendLevel({
      sessionId,
      level: readLevel(pipeline.analyser)
    })
  }

  sendSample()
  levelTimer = window.setInterval(sendSample, LEVEL_INTERVAL_MS)
}

function stopTestMonitor(): void {
  if (testMonitorTimer !== null) {
    window.clearInterval(testMonitorTimer)
    testMonitorTimer = null
  }
}

function startTestMonitor(): void {
  stopTestMonitor()

  const sendSample = (): void => {
    if (!testMonitorEnabled) {
      stopTestMonitor()
      return
    }

    const active = pipeline
    window.murmurRecorder.sendMonitorLevel({
      level: active === null ? 0 : readLevel(active.analyser)
    })
  }

  sendSample()
  testMonitorTimer = window.setInterval(sendSample, LEVEL_INTERVAL_MS)
}

function disposePipeline(target: CapturePipeline): void {
  stopLevelMonitor()
  target.node.port.onmessage = null
  for (const track of target.stream.getTracks()) {
    track.stop()
  }
  void target.context.close().catch((error: unknown) => {
    console.error('[murmur recorder] could not close the audio context', error)
  })
}

async function createPipeline(): Promise<CapturePipeline> {
  // The settings store decides which device to warm. Reading it here (rather
  // than only at module start) also covers a window that finished loading
  // after the user changed the microphone.
  await ensureConfiguration()

  const context = new AudioContext({
    sampleRate: RECORDER_SAMPLE_RATE,
    latencyHint: 'interactive'
  })

  let stream: MediaStream | null = null

  try {
    if (context.sampleRate !== RECORDER_SAMPLE_RATE) {
      throw new CaptureSetupError(
        'capture-failed',
        `The audio engine could not run at ${RECORDER_SAMPLE_RATE} Hz (got ${context.sampleRate} Hz).`
      )
    }

    // The worklet source is inlined by Vite and installed as a Blob URL so the
    // same code loads in dev (http) and from the installed app (file://).
    const workletUrl = URL.createObjectURL(
      new Blob([pcmWorkletSource], { type: 'text/javascript' })
    )
    try {
      await context.audioWorklet.addModule(workletUrl)
    } catch (error) {
      console.error('[murmur recorder] audio worklet failed to load', error)
      throw new CaptureSetupError(
        'capture-failed',
        'The audio capture component could not start. Restart Murmur and try again.'
      )
    } finally {
      URL.revokeObjectURL(workletUrl)
    }

    // Windows: echo cancellation adds processing delay and can alter the voice
    // signal. Murmur never plays audio through the mic graph, so it is disabled.
    // The AudioWorkletNode below is forced to one channel, which downmixes a
    // stereo device to mono. An exact device id honours the settings dropdown;
    // `null` leaves the choice to Windows.
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: false
    }
    if (preferredDeviceId !== null) {
      audio.deviceId = { exact: preferredDeviceId }
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio })

    if (stream.getAudioTracks().length === 0) {
      throw new CaptureSetupError('no-device', 'The microphone did not provide an audio track.')
    }

    const source = context.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(context, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { chunkFrames: CHUNK_FRAMES }
    })
    node.port.onmessage = handleWorkletMessage

    // A muted output keeps the audio graph pulling samples without ever
    // routing the microphone to the speakers. The analyser is a parallel
    // branch used only to read the level for the overlay meter.
    const silence = context.createGain()
    silence.gain.value = 0
    source.connect(node)
    node.connect(silence)

    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    analyser.connect(silence)

    silence.connect(context.destination)

    // Windows: backgroundThrottling is off on the recorder window, but the
    // audio context can still be suspended after sleep or a device change.
    if (context.state !== 'running') {
      await context.resume()
    }

    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', handleTrackEnded)
    }

    console.log(`[murmur recorder] microphone ready (${context.sampleRate} Hz, mono)`)
    return { context, stream, node, analyser }
  } catch (error) {
    if (stream !== null) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }
    await context.close().catch(() => undefined)
    throw error
  }
}

async function ensurePipeline(): Promise<CapturePipeline> {
  if (pipeline !== null) {
    return pipeline
  }

  if (pipelinePromise === null) {
    pipelinePromise = createPipeline()
  }

  try {
    const created = await pipelinePromise
    pipeline = created
    pipelinePromise = null
    return created
  } catch (error) {
    pipelinePromise = null
    throw error
  }
}

async function restartPipeline(): Promise<void> {
  if (pipelineRestartPromise !== null) {
    return pipelineRestartPromise
  }

  pipelineRestartPromise = (async (): Promise<void> => {
    const pending = pipelinePromise
    if (pending !== null) {
      await pending.catch(() => undefined)
    }

    const previous = pipeline
    pipeline = null
    pipelinePromise = null
    if (previous !== null) {
      disposePipeline(previous)
    }

    try {
      await ensurePipeline()
      reportStatus({ microphone: 'ready' })
    } catch (error) {
      const description = describeCaptureError(error)
      console.error('[murmur recorder] could not switch microphone', error)
      reportStatus({ microphone: 'unavailable', message: description.message })
    }
  })()

  try {
    await pipelineRestartPromise
  } finally {
    pipelineRestartPromise = null
  }
}

async function applyPendingDevice(): Promise<void> {
  if (!deviceChangePending) {
    return
  }
  deviceChangePending = false
  await restartPipeline()
}

function handleSetDevice(payload: RecorderSetDevicePayload): void {
  if (payload.deviceId === preferredDeviceId) {
    return
  }

  preferredDeviceId = payload.deviceId
  console.log(
    `[murmur recorder] microphone changed to ${preferredDeviceId === null ? 'system default' : preferredDeviceId}`
  )

  if (activeSessionId !== null) {
    // Never tear down a pipeline while its audio is being captured. The new
    // device is opened before the next utterance instead.
    deviceChangePending = true
    console.log('[murmur recorder] microphone change deferred until the utterance ends')
    return
  }

  void restartPipeline()
}

function handleTestMonitor(payload: RecorderTestMonitorPayload): void {
  testMonitorEnabled = payload.enabled
  if (!payload.enabled) {
    stopTestMonitor()
    return
  }

  startTestMonitor()
  // Retry a failed warm-up so the Test button also recovers from a device that
  // was unavailable when Murmur started.
  void ensurePipeline()
    .then(() => {
      reportStatus({ microphone: 'ready' })
      void reportDeviceList()
    })
    .catch((error: unknown) => {
      const description = describeCaptureError(error)
      console.error('[murmur recorder] microphone test could not open the device', error)
      reportStatus({ microphone: 'unavailable', message: description.message })
    })
}

function handleTrackEnded(): void {
  console.error('[murmur recorder] the microphone track ended')
  stopLevelMonitor()
  const endedPipeline = pipeline
  pipeline = null
  pipelinePromise = null
  if (endedPipeline !== null) {
    disposePipeline(endedPipeline)
  }

  const session = activeSessionId
  activeSessionId = null
  chunks = []
  frameCount = 0

  if (session !== null) {
    const payload: DictationCaptureErrorPayload = {
      sessionId: session,
      code: 'device-busy',
      message: 'The microphone was disconnected during recording.'
    }
    window.murmurRecorder.reportCaptureError(payload)
  } else {
    reportStatus({
      microphone: 'unavailable',
      message: 'The microphone was disconnected.'
    })
  }
}

function resetUtterance(sessionId: string | null): void {
  activeSessionId = sessionId
  chunks = []
  frameCount = 0
}

function handleBegin(payload: DictationBeginPayload): void {
  if (activeSessionId !== null) {
    console.warn('[murmur recorder] begin ignored: a capture session is already active')
    return
  }

  activeMaxDurationMs = Math.min(Math.max(payload.maxDurationMs, 1), RECORDER_MAX_UTTERANCE_MS)
  resetUtterance(payload.sessionId)

  void startCapture(payload.sessionId)
}

async function startCapture(sessionId: string): Promise<void> {
  try {
    await applyPendingDevice()
    const active = await ensurePipeline()
    if (activeSessionId !== sessionId) {
      return
    }

    if (active.context.state !== 'running') {
      await active.context.resume()
    }
    if (activeSessionId !== sessionId) {
      return
    }

    const maxFrames = Math.max(1, Math.floor((activeMaxDurationMs * RECORDER_SAMPLE_RATE) / 1000))
    active.node.port.postMessage({ type: 'start', maxFrames })
    startLevelMonitor(sessionId)
    console.log(`[murmur recorder] capture started (max ${activeMaxDurationMs} ms)`)
  } catch (error) {
    if (activeSessionId !== sessionId) {
      return
    }
    stopLevelMonitor()
    activeSessionId = null
    chunks = []
    frameCount = 0
    reportCaptureError(sessionId, error)
  }
}

function handleFinish(payload: DictationSessionPayload): void {
  if (activeSessionId !== payload.sessionId) {
    return
  }

  stopLevelMonitor()
  if (pipeline === null) {
    activeSessionId = null
    window.murmurRecorder.reportCaptureError({
      sessionId: payload.sessionId,
      code: 'capture-failed',
      message: 'The microphone was not ready when the utterance ended.'
    })
    return
  }

  pipeline.node.port.postMessage({ type: 'stop' })
}

function handleCancel(payload: DictationSessionPayload): void {
  if (activeSessionId !== payload.sessionId) {
    return
  }

  stopLevelMonitor()
  activeSessionId = null
  chunks = []
  frameCount = 0
  pipeline?.node.port.postMessage({ type: 'cancel' })
  void applyPendingDevice()
}

function handleWorkletMessage(event: MessageEvent<unknown>): void {
  if (!isWorkletMessage(event.data)) {
    return
  }

  if (event.data.type === 'chunk') {
    if (activeSessionId === null) {
      return
    }
    const samples = new Int16Array(event.data.samples)
    chunks.push(samples)
    frameCount += samples.length
    return
  }

  const session = activeSessionId
  if (session === null) {
    return
  }

  stopLevelMonitor()
  activeSessionId = null
  const capturedFrames = frameCount
  const capturedChunks = chunks
  chunks = []
  frameCount = 0

  if (event.data.frames !== capturedFrames) {
    console.warn(
      `[murmur recorder] worklet reported ${event.data.frames} frames, received ${capturedFrames}`
    )
  }

  if (capturedFrames === 0) {
    window.murmurRecorder.reportCaptureError({
      sessionId: session,
      code: 'no-audio',
      message: 'No audio was captured. Check the microphone and Windows privacy settings.'
    })
    void applyPendingDevice()
    return
  }

  const wav = encodePcm16Wav(capturedChunks)
  const durationMs = (capturedFrames / RECORDER_SAMPLE_RATE) * 1000
  const payload: DictationAudioPayload = { sessionId: session, wav, durationMs }
  window.murmurRecorder.sendAudio(payload)
  console.log(
    `[murmur recorder] capture ended after ${Math.round(durationMs)} ms${
      event.data.capReached ? ' (limit reached)' : ''
    }`
  )
  void applyPendingDevice()
}

async function warmUpMicrophone(): Promise<void> {
  try {
    await ensureConfiguration()
    await ensurePipeline()
    reportStatus({ microphone: 'ready' })
    void reportDeviceList()
  } catch (error) {
    const description = describeCaptureError(error)
    console.error('[murmur recorder] microphone unavailable at startup', error)
    reportStatus({ microphone: 'unavailable', message: description.message })
    void reportDeviceList()
  }
}

window.murmurRecorder.onBegin(handleBegin)
window.murmurRecorder.onFinish(handleFinish)
window.murmurRecorder.onCancel(handleCancel)
window.murmurRecorder.onSetDevice(handleSetDevice)
window.murmurRecorder.onTestMonitor(handleTestMonitor)
window.murmurRecorder.onRequestDevices(() => {
  void reportDeviceList()
})
navigator.mediaDevices.addEventListener('devicechange', () => {
  void reportDeviceList()
})

void warmUpMicrophone()
