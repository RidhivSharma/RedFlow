import { randomUUID } from 'node:crypto'
import { RECORDER_MAX_UTTERANCE_MS } from '../shared/audio'
import { setTrayTooltip } from './app/tray'
import { createRecorderController, type RecorderFailure, type UtteranceSaved } from './recorder'
import { createTranscriber } from './transcriber'

export type DictationState = 'idle' | 'recording' | 'finalizing'

export interface DictationControllerOptions {
  /** Holds shorter than this are discarded as taps. */
  readonly minUtteranceMs: number
  /** Hard upper bound for one utterance; the recorder also enforces its own cap. */
  readonly maxUtteranceMs: number
  /** A path from settings.json, or `null` for the bundled base.en model. */
  readonly modelPath: string | null
  /** Whisper thread count; `0` means auto. */
  readonly threads: number
}

export interface DictationController {
  /** Creates the hidden recorder and warms the microphone. */
  readonly initialize: () => Promise<void>
  readonly start: () => void
  readonly stop: (durationMs: number) => void
  /** Stops capture and transcription; resolves after temp files are cleaned. */
  readonly dispose: () => Promise<void>
}

function toTooltip(message: string): string {
  const singleLine = message.replace(/\s+/g, ' ').trim()
  return singleLine.length <= 120 ? singleLine : `${singleLine.slice(0, 117)}...`
}

/**
 * Owns "what is happening right now" (docs/ARCHITECTURE.md §5), drives the
 * hidden recorder, and queues each saved utterance for whisper. Phase 4 logs
 * the transcript; phase 5 will insert it at the cursor.
 */
export function createDictationController(
  options: DictationControllerOptions
): DictationController {
  const minUtteranceMs = Math.max(0, options.minUtteranceMs)
  const maxUtteranceMs = Math.min(Math.max(options.maxUtteranceMs, 1), RECORDER_MAX_UTTERANCE_MS)

  const transcriber = createTranscriber({
    modelPath: options.modelPath,
    threads: options.threads
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
      console.log(
        `[murmur] transcript (${Math.round(transcription.elapsedMs)} ms): ${transcription.text}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription failed.'
      console.error(`[murmur] transcription failed: ${message}`, error)
      if (state === 'idle') {
        setTrayTooltip(toTooltip(message))
      }
      return
    } finally {
      pendingTranscriptions = Math.max(0, pendingTranscriptions - 1)
    }

    if (pendingTranscriptions === 0 && state === 'idle') {
      setTrayTooltip('Idle')
    }
  }

  function handleUtteranceSaved(result: UtteranceSaved): void {
    if (result.sessionId !== sessionId) {
      return
    }

    clearSession()
    state = 'idle'
    pendingTranscriptions += 1
    setTrayTooltip('Transcribing...')
    console.log(`[murmur] utterance ready (${Math.round(result.durationMs)} ms)`)
    void transcribeUtterance(result)
  }

  function handleRecorderError(failure: RecorderFailure): void {
    if (failure.sessionId === null) {
      // Startup and device-level failures happen while no utterance is active;
      // keep the current state untouched so a later attempt can still work.
      setTrayTooltip(toTooltip(failure.message))
      return
    }

    if (failure.sessionId !== sessionId) {
      return
    }

    clearSession()
    state = 'idle'
    setTrayTooltip(toTooltip(failure.message))
  }

  const recorder = createRecorderController({
    onUtteranceSaved: handleUtteranceSaved,
    onError: handleRecorderError
  })

  function beginFinishing(id: string): void {
    if (state !== 'recording' || sessionId !== id) {
      return
    }

    clearHoldTimer()
    state = 'finalizing'
    setTrayTooltip('Saving...')
    recorder.finish(id)
  }

  function start(): void {
    if (state !== 'idle') {
      return
    }

    const id = randomUUID()
    sessionId = id
    state = 'recording'
    setTrayTooltip('Recording...')
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

    if (durationMs < minUtteranceMs) {
      const id = sessionId
      clearSession()
      state = 'idle'
      setTrayTooltip('Idle')
      recorder.cancel(id)
      console.log(`[murmur] tap ignored (${durationMs} ms < ${minUtteranceMs} ms)`)
      return
    }

    console.log(`[murmur] dictation stop (${durationMs} ms)`)
    beginFinishing(sessionId)
  }

  async function initialize(): Promise<void> {
    await recorder.initialize()
  }

  async function dispose(): Promise<void> {
    clearSession()
    state = 'idle'
    recorder.dispose()
    await transcriber.dispose()
  }

  return {
    initialize,
    start,
    stop,
    dispose
  }
}
