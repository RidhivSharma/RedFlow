import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import {
  HOTKEY_MODIFIERS,
  formatHotkeyBinding,
  type HotkeyBinding,
  type HotkeyModifier
} from '../shared/hotkey'
import { MODIFIER_EVENT_FLAGS } from './hotkey'
import { resolveHotkey } from './hotkeyBinding'

/** A forgotten capture must not leave the global hook running forever. */
const CAPTURE_TIMEOUT_MS = 15_000
/** Ignore keydowns caused by the click/Enter that started the capture. */
const ARM_DELAY_MS = 300

const MODIFIER_KEY_NAMES: ReadonlySet<string> = new Set([
  'Ctrl',
  'CtrlRight',
  'Alt',
  'AltRight',
  'Shift',
  'ShiftRight',
  'Meta',
  'MetaRight'
])

/**
 * uiohook reports numeric keycodes; settings.json stores the canonical names
 * (`F9`, `Space`, ...). The first name for a keycode is the canonical one.
 */
const KEY_NAMES_BY_CODE = new Map<number, string>()
for (const [name, keycode] of Object.entries(UiohookKey)) {
  if (!MODIFIER_KEY_NAMES.has(name) && !KEY_NAMES_BY_CODE.has(keycode)) {
    KEY_NAMES_BY_CODE.set(keycode, name)
  }
}

let activeCapture: { cancel: () => void } | null = null

export function cancelHotkeyCapture(): void {
  activeCapture?.cancel()
}

/**
 * Captures the next key or modifier combo. Escape, a 15 s timeout, or
 * `cancelHotkeyCapture()` resolves `null`; a successful press resolves with the
 * normalized binding so the settings store can validate it again.
 *
 * The caller must stop the normal hotkey listener first: this temporarily owns
 * the native hook.
 */
export function captureHotkeyBinding(): Promise<HotkeyBinding | null> {
  if (activeCapture !== null) {
    return Promise.reject(new Error('Another hotkey capture is already in progress.'))
  }

  return new Promise<HotkeyBinding | null>((resolve, reject) => {
    const startedAt = Date.now()
    let settled = false
    let hookStarted = false
    let timer: NodeJS.Timeout | null = null

    const finish = (binding: HotkeyBinding | null): void => {
      if (settled) {
        return
      }
      settled = true
      activeCapture = null
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      uIOhook.off('keydown', onKeyDown)

      if (hookStarted) {
        try {
          uIOhook.stop()
        } catch (error) {
          console.error('[murmur] could not stop the keyboard hook after capture', error)
        }
      }

      if (binding !== null) {
        console.log(`[murmur] captured hotkey ${formatHotkeyBinding(binding)}`)
      } else {
        console.log('[murmur] hotkey capture cancelled')
      }
      resolve(binding)
    }

    const modifiersFromEvent = (event: UiohookKeyboardEvent): HotkeyModifier[] =>
      HOTKEY_MODIFIERS.filter((modifier) => event[MODIFIER_EVENT_FLAGS[modifier]])

    const onKeyDown = (event: UiohookKeyboardEvent): void => {
      if (event.keycode === UiohookKey.Escape) {
        finish(null)
        return
      }

      if (Date.now() - startedAt < ARM_DELAY_MS) {
        return
      }

      const name = KEY_NAMES_BY_CODE.get(event.keycode)
      if (name === undefined || MODIFIER_KEY_NAMES.has(name)) {
        return
      }

      const modifiers = modifiersFromEvent(event)
      try {
        const resolved = resolveHotkey(name, modifiers)
        finish(resolved.binding)
      } catch (error) {
        // A name outside the binding validator (for example a media key) is
        // not usable; keep listening instead of failing the whole capture.
        console.warn(`[murmur] ignored uncapturable key ${name}`, error)
      }
    }

    activeCapture = { cancel: () => finish(null) }

    try {
      uIOhook.on('keydown', onKeyDown)
      uIOhook.start()
      hookStarted = true
      console.log('[murmur] waiting for a hotkey to be pressed')
    } catch (error) {
      activeCapture = null
      uIOhook.off('keydown', onKeyDown)
      reject(
        new Error(
          `The keyboard hook could not start for hotkey capture: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      )
      return
    }

    timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS)
  })
}
