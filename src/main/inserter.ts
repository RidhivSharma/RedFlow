import { setTimeout as delay } from 'node:timers/promises'
import { BrowserWindow, clipboard } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { executeInsertion, type InsertionOutcome, type TargetIntegrity } from './insertionFlow'
import { InsertionError } from './insertionError'
import { createTargetIntegrityProbe, type TargetIntegrityProbe } from './targetIntegrity'

const DEFAULT_RESTORE_DELAY_MS = 350
const MIN_RESTORE_DELAY_MS = 0
const MAX_RESTORE_DELAY_MS = 5000

export { InsertionError } from './insertionError'
export type { InsertionErrorCode } from './insertionError'

export interface InserterOptions {
  /** How long the target app gets to read the clipboard before it is restored. */
  readonly getPasteRestoreDelayMs: () => number
  /** Append one trailing space so consecutive dictations do not run together. */
  readonly getTrailingSpace: () => boolean
  /**
   * Resolves `true` once the active hotkey's modifiers are physically up.
   * Resolves `false` if they are still held after the wait limit.
   */
  readonly waitForModifiersReleased: () => Promise<boolean>
  /** Overridable for tests; production uses the Windows integrity probe. */
  readonly targetIntegrityProbe?: TargetIntegrityProbe
}

export interface Inserter {
  /** Starts the integrity helper during startup so its first check is cheap. */
  warmup(): void
  /** Queues one transcript. Insertions run strictly in call order. */
  insert(text: string): Promise<InsertionOutcome>
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
 * settings window can be focusable today; the recorder and the overlay are
 * deliberately not focusable.
 */
function hasFocusedMurmurWindow(): boolean {
  return BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused())
}

async function performInsert(
  text: string,
  options: InserterOptions,
  probe: TargetIntegrityProbe
): Promise<InsertionOutcome> {
  const trimmed = text.trim()
  if (trimmed === '') {
    throw new InsertionError('empty-text', 'There was no text to insert.')
  }

  const payload = options.getTrailingSpace() && !/\s$/.test(trimmed) ? `${trimmed} ` : trimmed

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

  // Windows: UIPI blocks synthetic input from a user-level process into an
  // elevated window. Check the foreground process's token before borrowing the
  // clipboard; an unknown result is deliberately treated as unsafe.
  let target: TargetIntegrity = 'unknown'
  try {
    target = await probe.check()
  } catch (error) {
    console.error('[murmur] the target app integrity could not be checked', error)
  }

  const outcome = await executeInsertion(
    target,
    payload,
    clampRestoreDelay(options.getPasteRestoreDelayMs()),
    {
      readClipboard: async () => clipboard.readText(),
      writeClipboard: async (value) => {
        clipboard.writeText(value)
      },
      tapPaste: () => {
        uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl])
      },
      delay
    }
  )

  if (outcome.kind === 'clipboard-only') {
    console.warn(
      target === 'higher'
        ? '[murmur] target app is elevated or higher integrity; transcript left on the clipboard'
        : '[murmur] target app integrity is unknown; transcript left on the clipboard'
    )
  }

  return outcome
}

/**
 * Owns the clipboard borrow and the synthetic Ctrl+V (docs/ARCHITECTURE.md §7).
 * Calls are serialized so two transcripts can never interleave their clipboard
 * save/paste/restore windows, no matter how the whisper queue resolves.
 */
export function createInserter(options: InserterOptions): Inserter {
  const probe = options.targetIntegrityProbe ?? createTargetIntegrityProbe()
  let queue: Promise<void> = Promise.resolve()
  let disposed = false
  let disposePromise: Promise<void> | null = null

  function warmup(): void {
    if (!disposed) {
      probe.warmup()
    }
  }

  function insert(text: string): Promise<InsertionOutcome> {
    if (disposed) {
      return Promise.reject(
        new InsertionError(
          'cancelled',
          'The text was not inserted because Murmur is shutting down.'
        )
      )
    }

    const run = queue.then(() => performInsert(text, options, probe))
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
    disposePromise ??= (async () => {
      await queue
      await probe.dispose()
    })()
    return disposePromise
  }

  return { warmup, insert, dispose }
}
