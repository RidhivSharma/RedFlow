import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, ipcMain, type IpcMainEvent } from 'electron'
import { readPcm16WavInfo, RECORDER_MAX_UTTERANCE_MS } from '../shared/audio'
import {
  IPC_CHANNELS,
  isDictationAudioPayload,
  isDictationCaptureErrorPayload,
  isRecorderStatusPayload,
  type CaptureErrorCode,
  type DictationBeginPayload,
  type RecorderStatusPayload
} from '../shared/ipc'
import {
  createRecorderWindow,
  destroyRecorderWindow,
  isRecorderWebContents,
  sendToRecorder
} from './windows/recorderWindow'

const FINISH_TIMEOUT_MS = 8000
const MIC_WARM_TIMEOUT_MS = 5000

export interface UtteranceSaved {
  readonly sessionId: string
  readonly filePath: string
  readonly durationMs: number
}

export interface RecorderFailure {
  /** `null` when the failure is not tied to one utterance (for example mic startup). */
  readonly sessionId: string | null
  readonly code: CaptureErrorCode
  readonly message: string
  readonly cause?: unknown
}

export interface RecorderOptions {
  readonly onUtteranceSaved: (result: UtteranceSaved) => void
  readonly onError: (failure: RecorderFailure) => void
}

export interface RecorderController {
  /** Creates the hidden window and waits for the microphone warm-up. */
  initialize(): Promise<boolean>
  /** Starts one utterance; returns false if the request could not be delivered. */
  begin(sessionId: string, maxDurationMs: number): boolean
  /** Asks the renderer to finalize and deliver the current utterance. */
  finish(sessionId: string): void
  /** Discards the current utterance without producing a file. */
  cancel(sessionId: string): void
  /** Removes IPC listeners and destroys the hidden window. */
  dispose(): void
}

interface ActiveSession {
  readonly sessionId: string
  readonly maxDurationMs: number
}

/**
 * Resolves the scratch file used for the most recent utterance. The folder is
 * created on first save and the file is intentionally kept so the phase-3
 * capture can be inspected with a media player. Phase 4 will snapshot it for
 * whisper before the next utterance overwrites it.
 */
export function getLastUtterancePath(): string {
  // Windows: %TEMP% is per-user and resolved by Electron, so no drive letter or
  // username is hardcoded. A 'murmur' subfolder keeps our audio out of the way
  // of other applications' temp files.
  return join(app.getPath('temp'), 'murmur', 'last.wav')
}

async function saveLastUtterance(wav: ArrayBuffer): Promise<string> {
  const filePath = getLastUtterancePath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, new Uint8Array(wav))
  return filePath
}

/**
 * Owns the hidden recorder's main-process side: one active session at a time,
 * validation of everything arriving from the renderer, the finish watchdog,
 * and writing the delivered WAV to `%TEMP%\murmur\last.wav`.
 */
export function createRecorderController(options: RecorderOptions): RecorderController {
  let activeSession: ActiveSession | null = null
  let finishTimer: NodeJS.Timeout | null = null
  let saveQueue: Promise<void> = Promise.resolve()
  let startupComplete = false
  let warmStatus: RecorderStatusPayload | null = null
  let warmResolver: ((status: RecorderStatusPayload) => void) | null = null
  let initPromise: Promise<boolean> | null = null

  function clearFinishTimer(): void {
    if (finishTimer !== null) {
      clearTimeout(finishTimer)
      finishTimer = null
    }
  }

  function clearActiveSession(): void {
    activeSession = null
    clearFinishTimer()
  }

  function reportError(
    sessionId: string | null,
    code: CaptureErrorCode,
    message: string,
    cause?: unknown
  ): void {
    if (cause === undefined) {
      console.error(`[murmur] ${message}`)
    } else {
      console.error(`[murmur] ${message}`, cause)
    }

    try {
      options.onError({ sessionId, code, message, cause })
    } catch (error) {
      console.error('[murmur] recorder error handler failed', error)
    }
  }

  function notifySaved(result: UtteranceSaved): void {
    try {
      options.onUtteranceSaved(result)
    } catch (error) {
      console.error('[murmur] recorder saved-audio handler failed', error)
    }
  }

  function waitForWarmStatus(timeoutMs: number): Promise<RecorderStatusPayload | null> {
    if (warmStatus !== null) {
      return Promise.resolve(warmStatus)
    }

    return new Promise<RecorderStatusPayload | null>((resolve) => {
      let settled = false
      let timer: NodeJS.Timeout | null = null

      const finishWaiting = (status: RecorderStatusPayload | null): void => {
        if (settled) {
          return
        }
        settled = true
        if (timer !== null) {
          clearTimeout(timer)
        }
        warmResolver = null
        resolve(status)
      }

      timer = setTimeout(() => finishWaiting(null), timeoutMs)
      warmResolver = (status) => finishWaiting(status)
    })
  }

  async function initializeOnce(): Promise<boolean> {
    try {
      await createRecorderWindow()
    } catch (error) {
      startupComplete = true
      reportError(null, 'capture-failed', 'The hidden recorder window could not be created.', error)
      return false
    }

    const status = await waitForWarmStatus(MIC_WARM_TIMEOUT_MS)
    startupComplete = true

    if (status === null) {
      reportError(null, 'capture-failed', 'The microphone did not report ready in time.')
      return false
    }

    if (status.microphone !== 'ready') {
      reportError(null, 'capture-failed', status.message ?? 'The microphone is unavailable.')
      return false
    }

    console.log('[murmur] recorder initialized with a warm microphone')
    return true
  }

  function begin(sessionId: string, maxDurationMs: number): boolean {
    if (activeSession !== null) {
      console.warn('[murmur] recorder begin ignored: an utterance is already active')
      return false
    }

    const requested = Number.isFinite(maxDurationMs)
      ? Math.floor(maxDurationMs)
      : RECORDER_MAX_UTTERANCE_MS
    const effectiveMax = Math.min(Math.max(requested, 1), RECORDER_MAX_UTTERANCE_MS)
    const payload: DictationBeginPayload = { sessionId, maxDurationMs: effectiveMax }
    activeSession = { sessionId, maxDurationMs: effectiveMax }

    try {
      if (!sendToRecorder(IPC_CHANNELS.dictationBegin, payload)) {
        clearActiveSession()
        reportError(sessionId, 'capture-failed', 'The hidden recorder window is not available.')
        return false
      }
    } catch (error) {
      clearActiveSession()
      reportError(sessionId, 'capture-failed', 'The recording could not start.', error)
      return false
    }

    return true
  }

  function finish(sessionId: string): void {
    if (activeSession?.sessionId !== sessionId) {
      return
    }

    if (finishTimer === null) {
      finishTimer = setTimeout(() => {
        finishTimer = null
        if (activeSession?.sessionId === sessionId) {
          clearActiveSession()
          reportError(
            sessionId,
            'capture-failed',
            'The recorder did not deliver the utterance in time.'
          )
        }
      }, FINISH_TIMEOUT_MS)
    }

    try {
      if (!sendToRecorder(IPC_CHANNELS.dictationFinish, { sessionId })) {
        clearActiveSession()
        reportError(
          sessionId,
          'capture-failed',
          'The recorder window closed before the utterance finished.'
        )
      }
    } catch (error) {
      clearActiveSession()
      reportError(
        sessionId,
        'capture-failed',
        'The recorder could not finish the utterance.',
        error
      )
    }
  }

  function cancel(sessionId: string): void {
    if (activeSession?.sessionId !== sessionId) {
      return
    }

    clearActiveSession()
    try {
      sendToRecorder(IPC_CHANNELS.dictationCancel, { sessionId })
    } catch (error) {
      // The utterance was already discarded; a missing renderer needs no alert.
      console.error('[murmur] could not cancel the recorder session', error)
    }
  }

  function handleStatus(event: IpcMainEvent, payload: unknown): void {
    if (!isRecorderWebContents(event.sender)) {
      return
    }

    if (!isRecorderStatusPayload(payload)) {
      console.warn('[murmur] ignored a malformed recorder status payload')
      return
    }

    warmStatus = payload
    const resolver = warmResolver
    warmResolver = null
    resolver?.(payload)

    if (startupComplete && payload.microphone === 'unavailable') {
      reportError(null, 'device-busy', payload.message ?? 'The microphone became unavailable.')
    }
  }

  function handleAudio(event: IpcMainEvent, payload: unknown): void {
    if (!isRecorderWebContents(event.sender)) {
      return
    }

    if (!isDictationAudioPayload(payload)) {
      console.warn('[murmur] ignored a malformed recorder audio payload')
      return
    }

    const session = activeSession
    if (session === null || session.sessionId !== payload.sessionId) {
      console.warn('[murmur] ignored audio for an inactive recorder session')
      return
    }

    const info = readPcm16WavInfo(payload.wav)
    if (info === null) {
      clearActiveSession()
      reportError(payload.sessionId, 'capture-failed', 'The recorder produced an invalid WAV file.')
      return
    }

    if (info.dataBytes === 0) {
      clearActiveSession()
      reportError(payload.sessionId, 'no-audio', 'No audio was captured.')
      return
    }

    if (info.durationMs > session.maxDurationMs + 100) {
      clearActiveSession()
      reportError(
        payload.sessionId,
        'capture-failed',
        `The recording exceeded the ${Math.round(session.maxDurationMs / 1000)} s limit.`
      )
      return
    }

    clearActiveSession()
    console.log(
      `[murmur] received ${Math.round(info.durationMs)} ms of audio (${info.dataBytes} bytes)`
    )

    saveQueue = saveQueue
      .then(() => saveLastUtterance(payload.wav))
      .then((filePath) => {
        console.log(
          `[murmur] saved last utterance to ${filePath} (${Math.round(info.durationMs)} ms)`
        )
        notifySaved({
          sessionId: payload.sessionId,
          filePath,
          durationMs: info.durationMs
        })
      })
      .catch((error: unknown) => {
        reportError(
          payload.sessionId,
          'capture-failed',
          'The recording could not be saved to disk.',
          error
        )
      })
  }

  function handleCaptureError(event: IpcMainEvent, payload: unknown): void {
    if (!isRecorderWebContents(event.sender)) {
      return
    }

    if (!isDictationCaptureErrorPayload(payload)) {
      console.warn('[murmur] ignored a malformed capture-error payload')
      return
    }

    if (payload.sessionId !== null && activeSession?.sessionId !== payload.sessionId) {
      console.warn('[murmur] ignored a capture error for an inactive session')
      return
    }

    if (payload.sessionId !== null) {
      clearActiveSession()
    }

    reportError(payload.sessionId, payload.code, payload.message)
  }

  function dispose(): void {
    ipcMain.off(IPC_CHANNELS.dictationAudio, handleAudio)
    ipcMain.off(IPC_CHANNELS.dictationCaptureError, handleCaptureError)
    ipcMain.off(IPC_CHANNELS.recorderStatus, handleStatus)
    warmResolver = null
    clearActiveSession()
    destroyRecorderWindow()
  }

  ipcMain.on(IPC_CHANNELS.dictationAudio, handleAudio)
  ipcMain.on(IPC_CHANNELS.dictationCaptureError, handleCaptureError)
  ipcMain.on(IPC_CHANNELS.recorderStatus, handleStatus)

  return {
    initialize: () => {
      initPromise ??= initializeOnce()
      return initPromise
    },
    begin,
    finish,
    cancel,
    dispose
  }
}
