import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { RECORDER_MAX_UTTERANCE_MS } from '../shared/audio'
import { DEFAULT_HOTKEY_BINDING } from '../shared/hotkey'

export type OverlayPosition = 'bottom-center'

export interface MurmurSettings {
  schemaVersion: number
  hotkey: string
  hotkeyModifiers: string[]
  minUtteranceMs: number
  maxUtteranceMs: number
  modelPath: string | null
  threads: number
  autostart: boolean
  overlay: { position: OverlayPosition }
  sounds: boolean
  pasteRestoreDelayMs: number
}

/**
 * Defaults mirror docs/ARCHITECTURE.md §8. The hotkey defaults to holding F9;
 * phase 7 replaces this bare store with validated reads and atomic, debounced
 * writes.
 */
export const DEFAULT_SETTINGS: MurmurSettings = {
  schemaVersion: 1,
  hotkey: DEFAULT_HOTKEY_BINDING.key,
  hotkeyModifiers: [...DEFAULT_HOTKEY_BINDING.modifiers],
  minUtteranceMs: 300,
  maxUtteranceMs: 120000,
  modelPath: null,
  threads: 0,
  autostart: false,
  overlay: { position: 'bottom-center' },
  sounds: false,
  pasteRestoreDelayMs: 350
}

export function getSettingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/**
 * Creates settings.json with defaults on first run. Existing files are left
 * untouched; validation and repair arrive in phase 7.
 */
export async function ensureSettingsFile(): Promise<void> {
  const filePath = getSettingsFilePath()
  if (existsSync(filePath)) {
    return
  }

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, 'utf8')
  console.log(`[murmur] created default settings at ${filePath}`)
}

export interface HotkeyPreferences {
  readonly key: string
  /** Raw modifier names; validated by the hotkey listener at startup. */
  readonly modifiers: readonly string[]
}

export interface StartupPreferences {
  readonly hotkey: HotkeyPreferences
  readonly minUtteranceMs: number
  readonly maxUtteranceMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the startup fields the recorder and hotkey need before the full
 * validated settings store exists (phase 7): the hotkey binding, the minimum
 * hold duration, and the maximum utterance length. A missing, unreadable, or
 * corrupt file falls back to the defaults so the app still starts.
 */
export async function loadStartupPreferences(): Promise<StartupPreferences> {
  const fallback: StartupPreferences = {
    hotkey: {
      key: DEFAULT_HOTKEY_BINDING.key,
      modifiers: DEFAULT_HOTKEY_BINDING.modifiers
    },
    minUtteranceMs: DEFAULT_SETTINGS.minUtteranceMs,
    maxUtteranceMs: DEFAULT_SETTINGS.maxUtteranceMs
  }

  try {
    // Windows: Notepad and PowerShell commonly save UTF-8 JSON with a byte
    // order mark, and JSON.parse rejects that leading character.
    const raw = (await readFile(getSettingsFilePath(), 'utf8')).replace(/^\uFEFF/, '')
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return fallback
    }

    const rawKey = parsed['hotkey']
    const rawModifiers = parsed['hotkeyModifiers']
    const rawMinUtteranceMs = parsed['minUtteranceMs']
    const rawMaxUtteranceMs = parsed['maxUtteranceMs']
    const key =
      typeof rawKey === 'string' && rawKey.trim() !== '' ? rawKey.trim() : fallback.hotkey.key
    const minUtteranceMs =
      typeof rawMinUtteranceMs === 'number' &&
      Number.isFinite(rawMinUtteranceMs) &&
      rawMinUtteranceMs >= 0
        ? rawMinUtteranceMs
        : fallback.minUtteranceMs
    const maxUtteranceMs =
      typeof rawMaxUtteranceMs === 'number' && Number.isFinite(rawMaxUtteranceMs)
        ? Math.min(Math.max(rawMaxUtteranceMs, minUtteranceMs, 1), RECORDER_MAX_UTTERANCE_MS)
        : fallback.maxUtteranceMs

    return {
      hotkey: {
        key,
        // A phase-1 file has an empty hotkey key, so use F9 above. Non-string
        // entries are ignored here; unknown names make the listener report a
        // clear configuration error instead of binding the wrong key.
        modifiers: Array.isArray(rawModifiers)
          ? rawModifiers.filter((modifier): modifier is string => typeof modifier === 'string')
          : fallback.hotkey.modifiers
      },
      minUtteranceMs,
      maxUtteranceMs
    }
  } catch (error) {
    console.error('[murmur] could not read settings; using defaults', error)
    return fallback
  }
}
