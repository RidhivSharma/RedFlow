/**
 * IPC channel names and payload types shared by the main process, preload
 * scripts, and renderers. Channel strings exist here and nowhere else.
 */
export const IPC_CHANNELS = {
  appInfo: 'app:info',
  /** main → hidden recorder: a push-to-talk hold began. */
  dictationBegin: 'dictation:begin',
  /** main → hidden recorder: the hold ended; finalize the WAV. */
  dictationFinish: 'dictation:finish',
  /** main → hidden recorder: discard the current hold without producing a WAV. */
  dictationCancel: 'dictation:cancel',
  /** hidden recorder → main: one complete utterance as a WAV file. */
  dictationAudio: 'dictation:audio',
  /** hidden recorder → main: microphone or capture pipeline failure. */
  dictationCaptureError: 'dictation:capture-error',
  /** hidden recorder → main: live microphone level while the gate is open. */
  dictationLevel: 'dictation:level',
  /** hidden recorder → main: result of the one-time microphone warm-up. */
  recorderStatus: 'recorder:status',
  /** main → overlay: the pill's current state (and an error detail). */
  overlayState: 'overlay:state',
  /** main → overlay: one microphone level sample for the live meter. */
  overlayLevel: 'overlay:level'
} as const

export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly electronVersion: string
  readonly platform: string
}

/** The only API exposed to the settings renderer through `window.murmur`. */
export interface MurmurBridge {
  getAppInfo(): Promise<AppInfo>
}

/* -------------------------------------------------------------------------- */
/* Recorder contract                                                          */
/* -------------------------------------------------------------------------- */

export interface DictationBeginPayload {
  readonly sessionId: string
  /**
   * Upper bound for this utterance. The recorder clamps it to its hard 120 s
   * cap so even a malformed payload cannot grow the capture buffer forever.
   */
  readonly maxDurationMs: number
}

export interface DictationSessionPayload {
  readonly sessionId: string
}

export interface DictationAudioPayload {
  readonly sessionId: string
  /** Complete 16 kHz, mono, 16-bit PCM WAV file. */
  readonly wav: ArrayBuffer
  /** Measured capture length, before any discarding decisions. */
  readonly durationMs: number
}

export const CAPTURE_ERROR_CODES = [
  'permission-denied',
  'no-device',
  'device-busy',
  'capture-failed',
  'no-audio',
  'unknown'
] as const

export type CaptureErrorCode = (typeof CAPTURE_ERROR_CODES)[number]

export interface DictationCaptureErrorPayload {
  /** `null` when the failure happened outside an utterance (for example at startup). */
  readonly sessionId: string | null
  readonly code: CaptureErrorCode
  readonly message: string
}

export interface RecorderStatusPayload {
  readonly microphone: 'ready' | 'unavailable'
  readonly message?: string
}

export interface DictationLevelPayload {
  readonly sessionId: string
  /** Normalized 0–1 RMS level, ready to drive the overlay meter. */
  readonly level: number
}

/** The only API exposed to the hidden recorder renderer through `window.murmurRecorder`. */
export interface RecorderBridge {
  onBegin(handler: (payload: DictationBeginPayload) => void): void
  onFinish(handler: (payload: DictationSessionPayload) => void): void
  onCancel(handler: (payload: DictationSessionPayload) => void): void
  sendAudio(payload: DictationAudioPayload): void
  sendLevel(payload: DictationLevelPayload): void
  reportCaptureError(payload: DictationCaptureErrorPayload): void
  reportStatus(payload: RecorderStatusPayload): void
}

/* -------------------------------------------------------------------------- */
/* Overlay contract                                                           */
/* -------------------------------------------------------------------------- */

export const OVERLAY_STATES = ['idle', 'listening', 'transcribing', 'done', 'error'] as const

export type OverlayState = (typeof OVERLAY_STATES)[number]

export interface OverlayStatePayload {
  readonly state: OverlayState
  /** Short, single-line message shown only in the `error` state. */
  readonly detail?: string
}

export interface OverlayLevelPayload {
  /** Normalized 0–1 microphone level. Only meaningful while listening. */
  readonly level: number
}

/** The only API exposed to the overlay renderer through `window.murmurOverlay`. */
export interface OverlayBridge {
  onState(handler: (payload: OverlayStatePayload) => void): void
  onLevel(handler: (payload: OverlayLevelPayload) => void): void
}

/**
 * Runtime guards used by the preload scripts and the main process. The main
 * process treats every renderer payload as untrusted, so the same checks run
 * on both sides of the bridge.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

export function isDictationBeginPayload(value: unknown): value is DictationBeginPayload {
  if (!isRecord(value)) {
    return false
  }

  const maxDurationMs = value['maxDurationMs']
  return (
    isSessionId(value['sessionId']) &&
    typeof maxDurationMs === 'number' &&
    Number.isFinite(maxDurationMs) &&
    maxDurationMs > 0
  )
}

export function isDictationSessionPayload(value: unknown): value is DictationSessionPayload {
  return isRecord(value) && isSessionId(value['sessionId'])
}

export function isDictationAudioPayload(value: unknown): value is DictationAudioPayload {
  if (!isRecord(value)) {
    return false
  }

  const wav = value['wav']
  const durationMs = value['durationMs']
  return (
    isSessionId(value['sessionId']) &&
    wav instanceof ArrayBuffer &&
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs >= 0
  )
}

export function isCaptureErrorCode(value: unknown): value is CaptureErrorCode {
  return CAPTURE_ERROR_CODES.some((code) => code === value)
}

export function isDictationCaptureErrorPayload(
  value: unknown
): value is DictationCaptureErrorPayload {
  if (!isRecord(value)) {
    return false
  }

  const sessionId = value['sessionId']
  const message = value['message']
  return (
    (sessionId === null || isSessionId(sessionId)) &&
    isCaptureErrorCode(value['code']) &&
    typeof message === 'string' &&
    message.length > 0 &&
    message.length <= 500
  )
}

export function isRecorderStatusPayload(value: unknown): value is RecorderStatusPayload {
  if (!isRecord(value)) {
    return false
  }

  const microphone = value['microphone']
  const message = value['message']
  return (
    (microphone === 'ready' || microphone === 'unavailable') &&
    (message === undefined || (typeof message === 'string' && message.length <= 500))
  )
}

export function isDictationLevelPayload(value: unknown): value is DictationLevelPayload {
  if (!isRecord(value)) {
    return false
  }

  const level = value['level']
  return (
    isSessionId(value['sessionId']) &&
    typeof level === 'number' &&
    Number.isFinite(level) &&
    level >= 0 &&
    level <= 1
  )
}

export function isOverlayState(value: unknown): value is OverlayState {
  return OVERLAY_STATES.some((state) => state === value)
}

export function isOverlayStatePayload(value: unknown): value is OverlayStatePayload {
  if (!isRecord(value)) {
    return false
  }

  const detail = value['detail']
  return (
    isOverlayState(value['state']) &&
    (detail === undefined || (typeof detail === 'string' && detail.length <= 500))
  )
}

export function isOverlayLevelPayload(value: unknown): value is OverlayLevelPayload {
  if (!isRecord(value)) {
    return false
  }

  const level = value['level']
  return typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1
}
