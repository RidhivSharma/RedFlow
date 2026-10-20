import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'

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
 * Defaults mirror docs/ARCHITECTURE.md §8. The hotkey stays empty until phase 2
 * picks the real default; phase 7 replaces this bare store with validated reads
 * and atomic, debounced writes.
 */
export const DEFAULT_SETTINGS: MurmurSettings = {
  schemaVersion: 1,
  hotkey: '',
  hotkeyModifiers: [],
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
