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
  /** hidden recorder → main: result of the one-time microphone warm-up. */
  recorderStatus: 'recorder:status'
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

/** The only API exposed to the hidden recorder renderer through `window.murmurRecorder`. */
export interface RecorderBridge {
  onBegin(handler: (payload: DictationBeginPayload) => void): void
  onFinish(handler: (payload: DictationSessionPayload) => void): void
  onCancel(handler: (payload: DictationSessionPayload) => void): void
  sendAudio(payload: DictationAudioPayload): void
  reportCaptureError(payload: DictationCaptureErrorPayload): void
  reportStatus(payload: RecorderStatusPayload): void
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
