import { setTrayTooltip } from './app/tray'

export type DictationState = 'idle' | 'recording'

export interface DictationControllerOptions {
  /** Holds shorter than this are discarded as taps. */
  readonly minUtteranceMs: number
}

export interface DictationController {
  readonly start: () => void
  readonly stop: (durationMs: number) => void
}

/**
 * Minimal owner of "what is happening right now" (docs/ARCHITECTURE.md §5).
 * Phase 2 uses it to guard start/stop and apply the tap policy; phase 3 adds
 * capture and transcription states alongside it.
 */
export function createDictationController(
  options: DictationControllerOptions
): DictationController {
  let state: DictationState = 'idle'

  return {
    start: () => {
      if (state !== 'idle') {
        return
      }

      state = 'recording'
      console.log('[murmur] dictation start')
      setTrayTooltip('Recording...')
    },
    stop: (durationMs) => {
      if (state !== 'recording') {
        return
      }

      state = 'idle'
      setTrayTooltip('Idle')

      if (durationMs < options.minUtteranceMs) {
        // The recording pulse is intentional; the utterance is discarded, so
        // no text is ever produced for a quick tap.
        console.log(`[murmur] tap ignored (${durationMs} ms < ${options.minUtteranceMs} ms)`)
        return
      }

      console.log(`[murmur] dictation stop (${durationMs} ms)`)
    }
  }
}
