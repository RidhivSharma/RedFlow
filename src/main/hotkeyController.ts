import type { HotkeyBinding } from '../shared/hotkey'
import { startHotkeyListener, stopHotkeyListener } from './hotkey'
import { cancelHotkeyCapture, captureHotkeyBinding } from './hotkeyCapture'

export interface HotkeyControllerOptions {
  readonly onStart: () => void
  readonly onStop: (durationMs: number) => void
  readonly onError: (message: string, error: unknown) => void
}

export interface HotkeyController {
  /** Replaces the active binding. Returns false when the hook could not start. */
  apply(binding: HotkeyBinding): boolean
  /** Suspends dictation, captures the next binding, then restores the listener. */
  capture(): Promise<HotkeyBinding | null>
  cancelCapture(): void
  dispose(): void
}

/**
 * Owns the lifetime of the global hotkey listener so settings can rebind it
 * live. The raw listener in `hotkey.ts` intentionally knows nothing about
 * settings windows or capture mode.
 */
export function createHotkeyController(options: HotkeyControllerOptions): HotkeyController {
  let current: HotkeyBinding | null = null
  let capturing = false
  let disposed = false

  function apply(binding: HotkeyBinding): boolean {
    if (disposed) {
      return false
    }

    stopHotkeyListener()
    const started = startHotkeyListener({
      key: binding.key,
      modifiers: binding.modifiers,
      onStart: options.onStart,
      onStop: options.onStop,
      onError: options.onError
    })

    if (started) {
      current = binding
    }
    return started
  }

  async function capture(): Promise<HotkeyBinding | null> {
    if (disposed) {
      throw new Error('The hotkey listener is shutting down.')
    }
    if (capturing) {
      throw new Error('A hotkey capture is already in progress.')
    }

    capturing = true
    stopHotkeyListener()
    try {
      return await captureHotkeyBinding()
    } finally {
      capturing = false
      // Put the previous binding back even when capture timed out, failed, or
      // the user pressed Escape.
      if (!disposed && current !== null) {
        apply(current)
      }
    }
  }

  function cancelCapture(): void {
    cancelHotkeyCapture()
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    cancelHotkeyCapture()
    stopHotkeyListener()
  }

  return { apply, capture, cancelCapture, dispose }
}
