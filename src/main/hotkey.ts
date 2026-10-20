import { uIOhook, type UiohookKeyboardEvent } from 'uiohook-napi'
import { formatHotkeyBinding, type HotkeyModifier } from '../shared/hotkey'
import { resolveHotkey, type ResolvedHotkey } from './hotkeyBinding'

/**
 * Raw hotkey configuration, as read from settings.json. Values are validated
 * while starting the listener so a typo disables the hotkey with a clear log
 * entry instead of silently binding a different key.
 */
export interface HotkeyListenerOptions {
  readonly key: string
  /** May be empty; for example `['Ctrl']` with key `Space` means Ctrl+Space. */
  readonly modifiers: readonly string[]
  readonly onStart: () => void
  /** Receives how long the binding was held so callers can discard short taps. */
  readonly onStop: (durationMs: number) => void
  readonly onError: (message: string, error: unknown) => void
}

interface ActiveHotkeyListener {
  readonly onKeyDown: (event: UiohookKeyboardEvent) => void
  readonly onKeyUp: (event: UiohookKeyboardEvent) => void
  readonly reset: () => void
}

const MODIFIER_EVENT_FLAGS: Readonly<
  Record<HotkeyModifier, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>
> = {
  Ctrl: 'ctrlKey',
  Alt: 'altKey',
  Shift: 'shiftKey',
  Win: 'metaKey'
}

let activeHotkey: ActiveHotkeyListener | null = null

function notify(listener: () => void, action: 'start' | 'stop'): void {
  try {
    listener()
  } catch (error) {
    // A throwing consumer must not take down the native hook thread.
    console.error(`[murmur] hotkey ${action} handler failed`, error)
  }
}

function reportError(options: HotkeyListenerOptions, message: string, error: unknown): void {
  try {
    options.onError(message, error)
  } catch (handlerError) {
    console.error('[murmur] hotkey error handler failed', handlerError)
  }
}

// Windows: holding a key re-sends keydown at roughly 30 Hz. The `pressed`
// latch treats those repeats as one press until the matching keyup arrives.
/**
 * Starts the global keyboard hook and reports `onStart` when the configured
 * binding is pressed and `onStop` when it is released. Returns `false` when
 * the hook or the binding could not be started; the app keeps running either
 * way.
 */
export function startHotkeyListener(options: HotkeyListenerOptions): boolean {
  if (activeHotkey !== null) {
    console.warn('[murmur] hotkey listener is already running; ignoring duplicate start')
    return true
  }

  let resolved: ResolvedHotkey
  try {
    resolved = resolveHotkey(options.key, options.modifiers)
  } catch (error) {
    reportError(options, 'The configured push-to-talk hotkey is invalid.', error)
    return false
  }

  const bindingText = formatHotkeyBinding(resolved.binding)
  let pressed = false
  let pressedAtMs = 0

  const onKeyDown = (event: UiohookKeyboardEvent): void => {
    if (pressed || event.keycode !== resolved.keycode) {
      return
    }

    for (const modifier of resolved.binding.modifiers) {
      if (!event[MODIFIER_EVENT_FLAGS[modifier]]) {
        return
      }
    }

    pressed = true
    pressedAtMs = Date.now()
    console.log(`[murmur] hotkey start (${bindingText})`)
    notify(options.onStart, 'start')
  }

  const onKeyUp = (event: UiohookKeyboardEvent): void => {
    if (!pressed) {
      return
    }

    // Releasing the primary key ends the utterance. For combos, releasing a
    // required modifier first also ends it, so Ctrl+Space cannot stick while
    // Space is still held.
    const releasedPrimaryKey = event.keycode === resolved.keycode
    const releasedRequiredModifier = resolved.modifierKeycodes.has(event.keycode)
    if (!releasedPrimaryKey && !releasedRequiredModifier) {
      return
    }

    const durationMs = Math.max(0, Date.now() - pressedAtMs)
    pressed = false
    pressedAtMs = 0
    console.log(`[murmur] hotkey stop (${bindingText}, ${durationMs} ms)`)
    notify(() => options.onStop(durationMs), 'stop')
  }

  try {
    uIOhook.on('keydown', onKeyDown)
    uIOhook.on('keyup', onKeyUp)
    uIOhook.start()
  } catch (error) {
    uIOhook.off('keydown', onKeyDown)
    uIOhook.off('keyup', onKeyUp)
    try {
      uIOhook.stop()
    } catch {
      // The hook may never have started; the original error is the useful one.
    }
    reportError(options, 'The global keyboard hook could not start.', error)
    return false
  }

  activeHotkey = {
    onKeyDown,
    onKeyUp,
    reset: () => {
      pressed = false
      pressedAtMs = 0
    }
  }
  console.log(`[murmur] global hotkey listener started (${bindingText})`)
  return true
}

/**
 * Removes the listeners and stops the native hook. Safe to call more than once
 * and during app shutdown; it deliberately does not emit `onStop`.
 */
export function stopHotkeyListener(): void {
  const listener = activeHotkey
  if (listener === null) {
    return
  }

  activeHotkey = null
  listener.reset()
  uIOhook.off('keydown', listener.onKeyDown)
  uIOhook.off('keyup', listener.onKeyUp)

  try {
    uIOhook.stop()
  } catch (error) {
    console.error('[murmur] failed to stop the global keyboard hook', error)
  }

  console.log('[murmur] global hotkey listener stopped')
}
