import type { OverlayState } from '../shared/ipc'
import {
  destroyOverlayWindow,
  initializeOverlayWindow,
  positionOverlayWindow,
  sendOverlayLevel,
  sendOverlayState,
  showOverlayWindow
} from './windows/overlayWindow'

/** Keep the confirmation on screen long enough to notice, short enough to ignore. */
const DONE_VISIBLE_MS = 900
/** Errors are one sentence; five seconds is enough to read one without clicking. */
const ERROR_VISIBLE_MS = 5000
/** The admin-target notice asks for a manual action, so give it a little longer. */
const NOTICE_VISIBLE_MS = 6000
/** The pill is narrow; the friendly message is shared with the tray, raw detail goes to the log. */
const MAX_ERROR_DETAIL = 140

export interface OverlayPresenter {
  /** Creates the hidden window at app startup so the first key-down is instant. */
  initialize(): void
  showListening(): void
  /** Feeds one ~15 fps microphone level sample while listening. */
  setLevel(level: number): void
  showTranscribing(): void
  /** Brief "inserted" confirmation, then hide. Ignored while listening. */
  showDone(): void
  /** Non-fatal result such as "text copied, press Ctrl+V manually". */
  showNotice(message: string): void
  showError(message: string): void
  hide(): void
  dispose(): void
}

function toDetail(message: string): string {
  const singleLine = message.replace(/\s+/g, ' ').trim()
  if (singleLine === '') {
    return 'Dictation failed.'
  }
  return singleLine.length <= MAX_ERROR_DETAIL
    ? singleLine
    : `${singleLine.slice(0, MAX_ERROR_DETAIL - 3)}...`
}

/**
 * Owns the overlay's visible state and auto-hide timers. The dictation
 * controller decides *when* feedback is appropriate; this module makes sure a
 * later event never replaces "Listening" and that done/error flashes disappear
 * on their own.
 */
export function createOverlayPresenter(): OverlayPresenter {
  let current: OverlayState = 'idle'
  let hideTimer: NodeJS.Timeout | null = null
  let disposed = false

  function clearHideTimer(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function show(state: OverlayState, detail?: string): void {
    current = state
    sendOverlayState(detail === undefined ? { state } : { state, detail })
    showOverlayWindow()
  }

  function scheduleHide(delayMs: number): void {
    clearHideTimer()
    hideTimer = setTimeout(() => {
      hideTimer = null
      if (current === 'done' || current === 'notice' || current === 'error') {
        hide()
      }
    }, delayMs)
  }

  function hide(): void {
    if (disposed) {
      return
    }
    clearHideTimer()
    current = 'idle'
    // The window itself stays mapped and click-through; idle content is
    // transparent, which is what keeps the next Listening change one frame fast.
    sendOverlayState({ state: 'idle' })
  }

  function showListening(): void {
    if (disposed) {
      return
    }
    clearHideTimer()
    // Move while idle/transparent first, then reveal "Listening", so a pill for
    // a new utterance never flashes on the previously used monitor.
    positionOverlayWindow()
    show('listening')
  }

  function setLevel(level: number): void {
    if (disposed || current !== 'listening') {
      return
    }
    if (!Number.isFinite(level)) {
      return
    }
    sendOverlayLevel(Math.min(1, Math.max(0, level)))
  }

  function showTranscribing(): void {
    if (disposed) {
      return
    }
    clearHideTimer()
    show('transcribing')
  }

  function showDone(): void {
    if (disposed || current === 'listening') {
      return
    }
    clearHideTimer()
    show('done')
    scheduleHide(DONE_VISIBLE_MS)
  }

  function showNotice(message: string): void {
    if (disposed || current === 'listening') {
      return
    }
    clearHideTimer()
    show('notice', toDetail(message))
    scheduleHide(NOTICE_VISIBLE_MS)
  }

  function showError(message: string): void {
    if (disposed) {
      return
    }
    clearHideTimer()
    show('error', toDetail(message))
    scheduleHide(ERROR_VISIBLE_MS)
  }

  function initialize(): void {
    if (disposed) {
      return
    }
    initializeOverlayWindow()
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    clearHideTimer()
    current = 'idle'
    destroyOverlayWindow()
  }

  return {
    initialize,
    showListening,
    setLevel,
    showTranscribing,
    showDone,
    showNotice,
    showError,
    hide,
    dispose
  }
}
