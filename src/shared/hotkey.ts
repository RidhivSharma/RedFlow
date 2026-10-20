/**
 * Push-to-talk binding types shared by the main process and, later, the
 * settings UI.
 *
 * The settings file stores the same shape as two fields:
 *   { "hotkey": "F9", "hotkeyModifiers": [] }
 *   { "hotkey": "Space", "hotkeyModifiers": ["Ctrl"] }   // Ctrl+Space
 *
 * A bare key is simply an empty modifier list. Keeping the primary key and
 * modifiers separate avoids parsing composite strings and makes it impossible
 * to express something like "Ctrl+Ctrl".
 */
export const HOTKEY_MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Win'] as const

export type HotkeyModifier = (typeof HOTKEY_MODIFIERS)[number]

/** A normalized binding: canonical modifier names and a canonical key name. */
export interface HotkeyBinding {
  /** Primary key name, matching a `UiohookKey` entry (for example `F9`). */
  readonly key: string
  /** Modifiers that must be held when the primary key goes down. */
  readonly modifiers: readonly HotkeyModifier[]
}

/** Hold F9 to dictate; no modifiers for the default. */
export const DEFAULT_HOTKEY_BINDING: HotkeyBinding = {
  key: 'F9',
  modifiers: []
}

/** Human-readable form used in logs and, later, the settings UI. */
export function formatHotkeyBinding(binding: HotkeyBinding): string {
  return [...binding.modifiers, binding.key].join('+')
}
