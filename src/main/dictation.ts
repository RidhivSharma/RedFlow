import { randomUUID } from 'node:crypto'
import { RECORDER_MAX_UTTERANCE_MS } from '../shared/audio'
import type { MicrophoneDevice } from '../shared/ipc'
import type { MurmurSettings } from '../shared/settings'
import { applyTranscriptPreferences } from '../shared/transcript'
import { logDebug } from './app/logger'
import { setTrayTooltip } from './app/tray'
import { friendlyCaptureError, friendlyDictationError, NO_SPEECH_MESSAGE } from './friendlyErrors'
import { waitForHotkeyModifiersReleased } from './hotkey'
import { createInserter } from './inserter'
import { InsertionError } from './insertionError'
import { createOverlayPresenter } from './overlay'
import { createRecorderController, type RecorderFailure, type UtteranceSaved } from './recorder'
import { createTranscriber, TranscriptionError } from './transcriber'

export type DictationState = 'idle' | 'recording' | 'finalizing'

export interface DictationControllerOptions {
  /**
   * Read live so every settings change (hotkey-adjacent limits, model,
   * language, trailing space, microphone) applies to the next utterance
   * without restarting the app.
   */
  readonly getSettings: () => MurmurSettings
}

export interface DictationController {
  /** Creates the hidden recorder and warms the microphone. */
  readonly initialize: () => Promise<void>
  readonly start: () => void
  readonly stop: (durationMs: number) => void
  readonly setMicrophone: (deviceId: string | null) => void
  readonly listMicrophones: () => Promise<readonly MicrophoneDevice[]>
  readonly setMicrophoneListListener: (
    listener: ((devices: readonly MicrophoneDevice[]) => void) | null
  ) => void
  readonly startMicTest: (onLevel: (level: number) => void) => void
  readonly stopMicTest: () => void
  /** Stops capture, transcription, and insertion; resolves after cleanup. */
  readonly dispose: () => Promise<void>
}

function toTooltip(message: string): string {
  const singleLine = message.replace(/\s+/g, ' ').trim()
  return singleLine.length <= 120 ? singleLine : `${singleLine.slice(0, 117)}...`
}

/**
 * Owns "what is happening right now" (docs/ARCHITECTURE.md §5), drives the
 * hidden recorder, queues each saved utterance for whisper, and passes the
 * resulting text to the inserter so it lands at the focused app's cursor.
 */
export function createDictationController(
  options: DictationControllerOptions
): DictationController {
  const transcriber = createTranscriber({
    getModelPath: () => options.getSettings().modelPath,
    getThreads: () => options.getSettings().threads,
    getLanguage: () => options.getSettings().language
  })

  const overlay = createOverlayPresenter()

  const inserter = createInserter({
    getPasteRestoreDelayMs: () => options.getSettings().pasteRestoreDelayMs,
    getTrailingSpace: () => options.getSettings().trailingSpace,
    waitForModifiersReleased: () => waitForHotkeyModifiersReleased()
  })

  let state: DictationState = 'idle'
  let sessionId: string | null = null
  let holdTimer: NodeJS.Timeout | null = null
  let pendingTranscriptions = 0

  function clearHoldTimer(): void {
    if (holdTimer !== null) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  function clearSession(): void {
    sessionId = null
    clearHoldTimer()
  }

  async function transcribeUtterance(result: UtteranceSaved): Promise<void> {
    try {
      const transcription = await transcriber.transcribe(result.filePath)
      const settings = options.getSettings()
      const text = applyTranscriptPreferences(transcription.text, {
        removeFillerWords: settings.removeFillerWords,
        spokenCommands: settings.spokenCommands
      })
      if (text === '') {
        throw new TranscriptionError(
          'empty',
          'The transcript was empty after text cleanup and was not inserted.'
        )
      }

      // The transcript can contain sensitive text; only the size is logged by
      // default. MURMUR_DEBUG=1 opts into the full text in terminal and file.
      console.log(
        `[murmur] transcript ready (${Math.round(transcription.elapsedMs)} ms, ${text.length} characters)`
      )
      logDebug(`[murmur] transcript: ${text}`)

      if (state === 'idle') {
        setTrayTooltip('Pasting...')
      }
      const outcome = await inserter.insert(text)
      if (outcome.kind === 'clipboard-only') {
        // Windows: UIPI blocks synthetic input into elevated windows. The
        // transcript is already on the clipboard; do not claim it was inserted.
        console.warn(
          `[murmur] transcript copied to the clipboard instead of pasted (${outcome.message})`
        )
        if (state === 'idle') {
          setTrayTooltip(toTooltip(outcome.message))
          overlay.showNotice(outcome.message)
        }
        return
      }
      console.log(`[murmur] inserted transcript (${text.length} characters) into the focused app`)
    } catch (error) {
      const stage = error instanceof InsertionError ? 'insertion failed' : 'transcription failed'
      const message = error instanceof Error ? error.message : 'Dictation failed.'
      const friendly = friendlyDictationError(error)
      console.error(`[murmur] ${stage}: ${message}`, error)
      if (state === 'idle') {
        setTrayTooltip(toTooltip(friendly))
        overlay.showError(friendly)
      }
      return
    } finally {
      pendingTranscriptions = Math.max(0, pendingTranscriptions - 1)
    }

    if (pendingTranscriptions === 0 && state === 'idle') {
      setTrayTooltip('Idle')
      overlay.showDone()
    }
  }

  function handleUtteranceSaved(result: UtteranceSaved): void {
    if (result.sessionId !== sessionId) {
      return
    }

    clearSession()
    state = 'idle'

    if (result.nearlySilent) {
      // Whisper hallucinates whole phrases on silence, so don't even start it.
      console.log(
        `[murmur] near-silent utterance (${Math.round(result.durationMs)} ms, ${result.rmsDbfs.toFixed(1)} dBFS); skipping transcription`
      )
      setTrayTooltip('No speech detected')
      overlay.showError(NO_SPEECH_MESSAGE)
      return
    }

    pendingTranscriptions += 1
    setTrayTooltip('Transcribing...')
    overlay.showTranscribing()
    console.log(`[murmur] utterance ready (${Math.round(result.durationMs)} ms)`)
    void transcribeUtterance(result)
  }

  function handleRecorderError(failure: RecorderFailure): void {
    const friendly = friendlyCaptureError(failure.code)
    if (failure.sessionId === null) {
      // Startup and device-level failures happen while no utterance is active;
      // keep the current state untouched so a later attempt can still work.
      setTrayTooltip(toTooltip(friendly))
      return
    }

    if (failure.sessionId !== sessionId) {
      return
    }

    clearSession()
    state = 'idle'
    setTrayTooltip(toTooltip(friendly))
    overlay.showError(friendly)
  }

  const recorder = createRecorderController({
    onUtteranceSaved: handleUtteranceSaved,
    onError: handleRecorderError,
    onLevel: (level) => overlay.setLevel(level),
    getMicrophoneId: () => options.getSettings().microphoneId
  })

  function beginFinishing(id: string): void {
    if (state !== 'recording' || sessionId !== id) {
      return
    }

    clearHoldTimer()
    state = 'finalizing'
    setTrayTooltip('Saving...')
    overlay.showTranscribing()
    recorder.finish(id)
  }

  function start(): void {
    if (state !== 'idle') {
      return
    }

    if (pendingTranscriptions > 0) {
      // A hold during an in-flight transcript is accepted rather than dropped:
      // capture is independent of whisper, and insertion stays FIFO-ordered.
      console.log(
        `[murmur] hotkey accepted while ${pendingTranscriptions} transcript(s) are still processing; the new utterance will be queued`
      )
    }

    const maxUtteranceMs = Math.min(
      Math.max(options.getSettings().maxUtteranceMs, 1),
      RECORDER_MAX_UTTERANCE_MS
    )
    const id = randomUUID()
    sessionId = id
    state = 'recording'
    setTrayTooltip('Recording...')
    overlay.showListening()
    console.log(`[murmur] dictation start (${id})`)

    if (!recorder.begin(id, maxUtteranceMs)) {
      // The recorder reports a detailed error through handleRecorderError;
      // make sure the state is idle even if that callback already ran.
      clearSession()
      state = 'idle'
      return
    }

    holdTimer = setTimeout(() => {
      holdTimer = null
      if (state !== 'recording' || sessionId === null) {
        return
      }
      console.log(`[murmur] max hold reached (${maxUtteranceMs} ms); finishing`)
      beginFinishing(sessionId)
    }, maxUtteranceMs)
  }

  function stop(durationMs: number): void {
    if (state !== 'recording' || sessionId === null) {
      return
    }

    const minUtteranceMs = Math.max(0, options.getSettings().minUtteranceMs)
    if (durationMs < minUtteranceMs) {
      const id = sessionId
      clearSession()
      state = 'idle'
      setTrayTooltip('Idle')
      overlay.hide()
      recorder.cancel(id)
      console.log(`[murmur] tap ignored (${durationMs} ms < ${minUtteranceMs} ms)`)
      return
    }

    console.log(`[murmur] dictation stop (${durationMs} ms)`)
    beginFinishing(sessionId)
  }

  async function initialize(): Promise<void> {
    // Windows: start the hidden UIPI helper first so PowerShell/Add-Type can
    // compile while the recorder warms, before the hotkey goes live. No audio
    // can be lost, and the first insertion does not pay the one-time cost.
    inserter.warmup()
    overlay.initialize()
    await recorder.initialize()
  }

  function setMicrophone(deviceId: string | null): void {
    recorder.setMicrophone(deviceId)
  }

  function listMicrophones(): Promise<readonly MicrophoneDevice[]> {
    return recorder.listMicrophones()
  }

  function setMicrophoneListListener(
    listener: ((devices: readonly MicrophoneDevice[]) => void) | null
  ): void {
    recorder.setMicrophoneListListener(listener)
  }

  function startMicTest(onLevel: (level: number) => void): void {
    recorder.setMicTestLevelListener(onLevel)
    recorder.setMicTestMonitor(true)
  }

  function stopMicTest(): void {
    recorder.setMicTestMonitor(false)
    recorder.setMicTestLevelListener(null)
  }

  async function dispose(): Promise<void> {
    overlay.dispose()
    clearSession()
    state = 'idle'
    stopMicTest()
    recorder.dispose()
    // Mark insertion as closed before whisper settles, so a transcript that
    // arrives during shutdown cannot borrow the clipboard on the way out.
    const insertionDone = inserter.dispose()
    await transcriber.dispose()
    await insertionDone
  }

  return {
    initialize,
    start,
    stop,
    setMicrophone,
    listMicrophones,
    setMicrophoneListListener,
    startMicTest,
    stopMicTest,
    dispose
  }
}
