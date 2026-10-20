import { UiohookKey } from 'uiohook-napi'
import { HOTKEY_MODIFIERS, type HotkeyBinding, type HotkeyModifier } from '../shared/hotkey'

export interface ResolvedHotkey {
  readonly binding: HotkeyBinding
  readonly keycode: number
  readonly modifierKeycodes: ReadonlySet<number>
}

const MODIFIER_KEYCODES: Readonly<Record<HotkeyModifier, readonly number[]>> = {
  Ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  Alt: [UiohookKey.Alt, UiohookKey.AltRight],
  Shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  Win: [UiohookKey.Meta, UiohookKey.MetaRight]
}

const MODIFIER_ALIASES: Readonly<Record<string, HotkeyModifier>> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  win: 'Win',
  meta: 'Win',
  super: 'Win'
}

// A few familiar names on top of the canonical UiohookKey names.
const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'Escape',
  return: 'Enter',
  spacebar: 'Space',
  del: 'Delete',
  ins: 'Insert',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  backtick: 'Backquote',
  grave: 'Backquote',
  dash: 'Minus',
  hyphen: 'Minus',
  equals: 'Equal',
  dot: 'Period'
}

const MODIFIER_KEY_NAMES: ReadonlySet<string> = new Set([
  'ctrl',
  'ctrlright',
  'alt',
  'altright',
  'shift',
  'shiftright',
  'meta',
  'metaright'
])

interface KeyDefinition {
  readonly name: string
  readonly keycode: number
}

const KEY_BY_NAME = new Map<string, KeyDefinition>()
for (const [name, keycode] of Object.entries(UiohookKey)) {
  KEY_BY_NAME.set(name.toLowerCase(), { name, keycode })
}
for (const [alias, canonicalName] of Object.entries(KEY_ALIASES)) {
  const definition = KEY_BY_NAME.get(canonicalName.toLowerCase())
  if (definition !== undefined) {
    KEY_BY_NAME.set(alias, definition)
  }
}

function normalizeModifiers(rawModifiers: readonly string[]): readonly HotkeyModifier[] {
  const requested = new Set<HotkeyModifier>()

  for (const rawModifier of rawModifiers) {
    const modifier = MODIFIER_ALIASES[rawModifier.trim().toLowerCase()]
    if (modifier === undefined) {
      throw new Error(
        `Unknown hotkey modifier "${rawModifier}". Supported modifiers: ${HOTKEY_MODIFIERS.join(', ')}.`
      )
    }
    requested.add(modifier)
  }

  // Canonical order keeps logs and future UI labels stable.
  return HOTKEY_MODIFIERS.filter((modifier) => requested.has(modifier))
}

/**
 * Validates raw settings values and resolves them to uiohook keycodes.
 * Throws with a user-readable message for an unknown key or modifier.
 */
export function resolveHotkey(key: string, rawModifiers: readonly string[]): ResolvedHotkey {
  const trimmedKey = key.trim()
  if (trimmedKey === '') {
    throw new Error('The hotkey key is empty.')
  }

  const definition = KEY_BY_NAME.get(trimmedKey.toLowerCase())
  if (definition === undefined) {
    throw new Error(`Unknown hotkey key "${key}". Use a key name such as F9, Space, or A.`)
  }
  if (MODIFIER_KEY_NAMES.has(definition.name.toLowerCase())) {
    throw new Error(
      `"${definition.name}" cannot be the push-to-talk key. Use it as a modifier instead.`
    )
  }

  const modifiers = normalizeModifiers(rawModifiers)
  const modifierKeycodes = new Set<number>()
  for (const modifier of modifiers) {
    for (const keycode of MODIFIER_KEYCODES[modifier]) {
      modifierKeycodes.add(keycode)
    }
  }

  return {
    binding: { key: definition.name, modifiers },
    keycode: definition.keycode,
    modifierKeycodes
  }
}
