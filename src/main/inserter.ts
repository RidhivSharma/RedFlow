import { setTimeout as delay } from 'node:timers/promises'
import { BrowserWindow, clipboard } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'

const DEFAULT_RESTORE_DELAY_MS = 350
const MIN_RESTORE_DELAY_MS = 0
const MAX_RESTORE_DELAY_MS = 5000

export type InsertionErrorCode =
  | 'empty-text'
  | 'modifiers-held'
  | 'own-window-focused'
  | 'paste-failed'
  | 'restore-failed'
  | 'cancelled'

export class InsertionError extends Error {
  readonly code: InsertionErrorCode

  constructor(code: InsertionErrorCode, message: string) {
    super(message)
    this.name = 'InsertionError'
    this.code = code
  }
}

export interface InserterOptions {
  /** How long the target app gets to read the clipboard before it is restored. */
  readonly pasteRestoreDelayMs: number
  /**
   * Resolves `true` once the active hotkey's modifiers are physically up.
   * Resolves `false` if they are still held after the wait limit.
   */
  readonly waitForModifiersReleased: () => Promise<boolean>
}

export interface Inserter {
  /** Queues one transcript. Insertions run strictly in call order. */
  insert(text: string): Promise<void>
  /** Rejects new insertions and resolves after the queued one has restored the clipboard. */
  dispose(): Promise<void>
}

function clampRestoreDelay(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RESTORE_DELAY_MS
  }
  return Math.min(Math.max(Math.floor(value), MIN_RESTORE_DELAY_MS), MAX_RESTORE_DELAY_MS)
}

/**
 * True when one of Murmur's own windows currently owns keyboard focus. Only the
 * settings window can be focusable today; the recorder and the future overlay
 * are deliberately not focusable.
 */
function hasFocusedMurmurWindow(): boolean {
  return BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused())
}

async function performInsert(text: string, options: InserterOptions): Promise<void> {
  const payload = text.trim()
  if (payload === '') {
    throw new InsertionError('empty-text', 'There was no text to insert.')
  }

  // Pasting into Murmur itself is always wrong. The settings window is the only
  // focusable Murmur window today; the overlay is non-focusable by design.
  if (hasFocusedMurmurWindow()) {
    throw new InsertionError('own-window-focused', 'Murmur has focus, so the text was not pasted.')
  }

  // Wait before touching the clipboard: if a combo's modifier is still down,
  // our synthetic Ctrl+V would include it and its synthetic keyup would clear
  // the real modifier in the target app.
  const modifiersReleased = await options.waitForModifiersReleased()
  if (!modifiersReleased) {
    throw new InsertionError(
      'modifiers-held',
      'The hotkey modifiers are still held, so the text was not pasted.'
    )
  }

  // The user may have clicked into Murmur while waiting for the modifiers.
  if (hasFocusedMurmurWindow()) {
    throw new InsertionError('own-window-focused', 'Murmur has focus, so the text was not pasted.')
  }

  // Windows: no window is shown, focused, or activated here. The clipboard API
  // is silent and uiohook posts input to whatever window already has focus, so
  // the user's dictation target keeps focus throughout the insertion.
  //
  // Known limitation (docs/ARCHITECTURE.md §7): only text is round-tripped.
  // An image or file-list clipboard is replaced by text and cannot be restored.
  let savedText: string | null = null
  let insertionFailed = false
  let restoreFailed = false

  try {
    // Electron's clipboard API is promise-based: awaiting the write guarantees
    // the text is on the system clipboard before the paste keystroke arrives.
    savedText = await clipboard.readText()
    await clipboard.writeText(payload)
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl])
    // Apps such as Word and Excel read the clipboard slightly after the
    // keystroke arrives; restoring too early would paste the previous content.
    await delay(clampRestoreDelay(options.pasteRestoreDelayMs))
  } catch (error) {
    insertionFailed = true
    console.error('[murmur] the synthetic Ctrl+V could not be sent', error)
  } finally {
    if (savedText !== null) {
      try {
        await clipboard.writeText(savedText)
      } catch (error) {
        restoreFailed = true
        console.error('[murmur] the previous clipboard text could not be restored', error)
      }
    }
  }

  if (insertionFailed) {
    throw new InsertionError('paste-failed', 'The transcribed text could not be pasted.')
  }
  if (restoreFailed) {
    throw new InsertionError('restore-failed', 'The previous clipboard text could not be restored.')
  }
}

/**
 * Owns the clipboard borrow and the synthetic Ctrl+V (docs/ARCHITECTURE.md §7).
 * Calls are serialized so two transcripts can never interleave their clipboard
 * save/paste/restore windows, no matter how the whisper queue resolves.
 */
export function createInserter(options: InserterOptions): Inserter {
  let queue: Promise<void> = Promise.resolve()
  let disposed = false
  let disposePromise: Promise<void> | null = null

  function insert(text: string): Promise<void> {
    if (disposed) {
      return Promise.reject(
        new InsertionError(
          'cancelled',
          'The text was not inserted because Murmur is shutting down.'
        )
      )
    }

    const run = queue.then(() => performInsert(text, options))
    // Keep the queue alive after a failed insertion so the next utterance can
    // still be pasted.
    queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  function dispose(): Promise<void> {
    disposed = true
    disposePromise ??= queue
    return disposePromise
  }

  return { insert, dispose }
}
