import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { RECORDER_MAX_UTTERANCE_MS } from '../shared/audio'
import type { HotkeyModifier } from '../shared/hotkey'
import {
  DEFAULT_SETTINGS,
  OVERLAY_POSITIONS,
  SETTINGS_SCHEMA_VERSION,
  WHISPER_LANGUAGES,
  type MurmurSettings,
  type OverlayPosition,
  type WhisperLanguage
} from '../shared/settings'
import { resolveHotkey } from './hotkeyBinding'

/** Writes coalesce while the user flips several controls in a row. */
const SAVE_DEBOUNCE_MS = 250
const MAX_PASTE_RESTORE_DELAY_MS = 5000
const MAX_MICROPHONE_ID_LENGTH = 512
const MAX_MODEL_PATH_LENGTH = 1024
const MIN_UTTERANCE_LIMIT_MS = 60_000
const MAX_THREADS = 64

let currentSettings: MurmurSettings | null = null
let initialization: Promise<MurmurSettings> | null = null
let saveTimer: NodeJS.Timeout | null = null
let pendingSettings: MurmurSettings | null = null
let saveChain: Promise<void> = Promise.resolve()
let saveErrorHandler: ((error: unknown) => void) | null = null

export function getSettingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Lets the main process surface background write failures in the UI/tray. */
export function setSettingsSaveErrorHandler(handler: ((error: unknown) => void) | null): void {
  saveErrorHandler = handler
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = true
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const clamped = Math.min(Math.max(value, min), max)
  return integer ? Math.floor(clamped) : clamped
}

function readStringOrNull(
  value: unknown,
  maxLength: number,
  fallback: string | null
): string | null {
  if (value === null || value === undefined) {
    return fallback
  }
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  return trimmed.length <= maxLength ? trimmed : fallback
}

function isWhisperLanguage(value: unknown): value is WhisperLanguage {
  return WHISPER_LANGUAGES.some((language) => language === value)
}

function readLanguage(value: unknown, fallback: WhisperLanguage): WhisperLanguage {
  return isWhisperLanguage(value) ? value : fallback
}

function isOverlayPosition(value: unknown): value is OverlayPosition {
  return OVERLAY_POSITIONS.some((position) => position === value)
}

function readOverlayPosition(value: unknown, fallback: OverlayPosition): OverlayPosition {
  return isOverlayPosition(value) ? value : fallback
}

function readModifiers(value: unknown): HotkeyModifier[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const modifiers: string[] = []
  for (const modifier of value) {
    if (typeof modifier !== 'string') {
      return null
    }
    modifiers.push(modifier)
  }

  try {
    return [...resolveHotkey('F9', modifiers).binding.modifiers]
  } catch {
    return null
  }
}

function readHotkey(
  keyValue: unknown,
  modifierValue: unknown
): { key: string; modifiers: readonly HotkeyModifier[] } {
  const modifiers = readModifiers(modifierValue)
  if (typeof keyValue !== 'string' || modifiers === null) {
    return {
      key: DEFAULT_SETTINGS.hotkey,
      modifiers: DEFAULT_SETTINGS.hotkeyModifiers
    }
  }

  try {
    const resolved = resolveHotkey(keyValue, modifiers)
    return { key: resolved.binding.key, modifiers: resolved.binding.modifiers }
  } catch {
    return {
      key: DEFAULT_SETTINGS.hotkey,
      modifiers: DEFAULT_SETTINGS.hotkeyModifiers
    }
  }
}

function freezeSettings(settings: MurmurSettings): MurmurSettings {
  return Object.freeze({
    ...settings,
    hotkeyModifiers: Object.freeze([...settings.hotkeyModifiers]),
    overlay: Object.freeze({ ...settings.overlay })
  })
}

/**
 * Turns whatever is on disk into a valid settings object. Every key goes
 * through its own whitelist and range check, so one corrupt value cannot make
 * the rest of the file unusable.
 */
function normalizeSettings(raw: unknown): MurmurSettings {
  if (!isRecord(raw)) {
    return freezeSettings(DEFAULT_SETTINGS)
  }

  const rawHotkey = readHotkey(raw['hotkey'], raw['hotkeyModifiers'])
  const minUtteranceMs = clampNumber(
    raw['minUtteranceMs'],
    DEFAULT_SETTINGS.minUtteranceMs,
    0,
    MIN_UTTERANCE_LIMIT_MS
  )
  const maxUtteranceMs = Math.max(
    minUtteranceMs,
    clampNumber(
      raw['maxUtteranceMs'],
      DEFAULT_SETTINGS.maxUtteranceMs,
      1,
      RECORDER_MAX_UTTERANCE_MS
    )
  )

  return freezeSettings({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    hotkey: rawHotkey.key,
    hotkeyModifiers: rawHotkey.modifiers,
    microphoneId: readStringOrNull(
      raw['microphoneId'],
      MAX_MICROPHONE_ID_LENGTH,
      DEFAULT_SETTINGS.microphoneId
    ),
    modelPath: readStringOrNull(
      raw['modelPath'],
      MAX_MODEL_PATH_LENGTH,
      DEFAULT_SETTINGS.modelPath
    ),
    language: readLanguage(raw['language'], DEFAULT_SETTINGS.language),
    trailingSpace:
      typeof raw['trailingSpace'] === 'boolean'
        ? raw['trailingSpace']
        : DEFAULT_SETTINGS.trailingSpace,
    minUtteranceMs,
    maxUtteranceMs,
    threads: clampNumber(raw['threads'], DEFAULT_SETTINGS.threads, 0, MAX_THREADS),
    autostart:
      typeof raw['autostart'] === 'boolean' ? raw['autostart'] : DEFAULT_SETTINGS.autostart,
    overlay: {
      position: isRecord(raw['overlay'])
        ? readOverlayPosition(raw['overlay']['position'], DEFAULT_SETTINGS.overlay.position)
        : DEFAULT_SETTINGS.overlay.position
    },
    sounds: typeof raw['sounds'] === 'boolean' ? raw['sounds'] : DEFAULT_SETTINGS.sounds,
    pasteRestoreDelayMs: clampNumber(
      raw['pasteRestoreDelayMs'],
      DEFAULT_SETTINGS.pasteRestoreDelayMs,
      0,
      MAX_PASTE_RESTORE_DELAY_MS
    )
  })
}

function normalizeMatchesRaw(raw: unknown, settings: MurmurSettings): boolean {
  if (!isRecord(raw)) {
    return false
  }

  const knownKeys = new Set(Object.keys(DEFAULT_SETTINGS))
  if (Object.keys(raw).some((key) => !knownKeys.has(key))) {
    return false
  }

  return JSON.stringify(raw) === JSON.stringify(settings)
}

async function writeSettingsFile(settings: MurmurSettings): Promise<void> {
  const filePath = getSettingsFilePath()
  const tempPath = `${filePath}.tmp`
  await mkdir(dirname(filePath), { recursive: true })

  try {
    await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function notifySaveError(error: unknown): void {
  if (saveErrorHandler !== null) {
    saveErrorHandler(error)
    return
  }
  console.error('[murmur] settings could not be saved', error)
}

function enqueueWrite(): void {
  const snapshot = pendingSettings
  pendingSettings = null
  if (snapshot === null) {
    return
  }

  saveChain = saveChain
    .then(() => writeSettingsFile(snapshot))
    .catch((error: unknown) => {
      notifySaveError(error)
    })
}

function scheduleSave(): void {
  if (currentSettings !== null) {
    pendingSettings = currentSettings
  }

  if (saveTimer !== null) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    enqueueWrite()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * Waits for the debounced write and any write already in flight. Called during
 * shutdown so a change made just before Quit is never lost.
 */
export async function flushSettings(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
    enqueueWrite()
  }
  await saveChain
}

async function loadSettings(): Promise<MurmurSettings> {
  const filePath = getSettingsFilePath()
  let raw: unknown = null
  let unreadable = false

  try {
    // Windows: Notepad and PowerShell commonly save UTF-8 JSON with a byte
    // order mark, and JSON.parse rejects that leading character.
    const text = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')
    raw = JSON.parse(text)
  } catch (error) {
    unreadable = true
    if (existsSync(filePath)) {
      console.error('[murmur] settings.json could not be read; starting from defaults', error)
    } else {
      console.log('[murmur] settings.json not found; creating it with defaults')
    }
  }

  const settings = unreadable ? freezeSettings(DEFAULT_SETTINGS) : normalizeSettings(raw)
  currentSettings = settings

  if (unreadable || !normalizeMatchesRaw(raw, settings)) {
    try {
      await writeSettingsFile(settings)
    } catch (error) {
      notifySaveError(error)
    }
  }

  return settings
}

/** Loads, validates, and repairs settings once per process. */
export function initializeSettings(): Promise<MurmurSettings> {
  initialization ??= loadSettings()
  return initialization
}

export function getSettings(): MurmurSettings {
  if (currentSettings === null) {
    throw new Error('Settings have not been initialized yet.')
  }
  return currentSettings
}

function readHotkeyPatch(
  patch: Record<string, unknown>,
  previous: MurmurSettings
): { key: string; modifiers: readonly HotkeyModifier[] } {
  const key = hasOwn(patch, 'hotkey') ? patch['hotkey'] : previous.hotkey
  const modifiers = hasOwn(patch, 'hotkeyModifiers')
    ? patch['hotkeyModifiers']
    : previous.hotkeyModifiers

  if (typeof key !== 'string') {
    throw new Error('The hotkey must be a key name.')
  }
  if (!Array.isArray(modifiers) || modifiers.some((modifier) => typeof modifier !== 'string')) {
    throw new Error('Hotkey modifiers must be a list of Ctrl, Alt, Shift, or Win.')
  }

  try {
    const resolved = resolveHotkey(key, modifiers)
    return { key: resolved.binding.key, modifiers: resolved.binding.modifiers }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'The hotkey is invalid.', {
      cause: error
    })
  }
}

function applyPatch(previous: MurmurSettings, raw: unknown): MurmurSettings {
  if (!isRecord(raw)) {
    throw new Error('The settings change is not an object.')
  }

  const knownKeys = new Set(Object.keys(DEFAULT_SETTINGS))
  for (const key of Object.keys(raw)) {
    if (!knownKeys.has(key) || key === 'schemaVersion') {
      throw new Error(`Unknown setting "${key}".`)
    }
  }

  type MutableSettings = { -readonly [Key in keyof MurmurSettings]: MurmurSettings[Key] }

  const next: MutableSettings = {
    ...previous,
    schemaVersion: SETTINGS_SCHEMA_VERSION
  }
  let hotkey = { key: previous.hotkey, modifiers: previous.hotkeyModifiers }
  let hotkeyChanged = false
  let minUtteranceMs = previous.minUtteranceMs
  let maxUtteranceMs = previous.maxUtteranceMs

  if (hasOwn(raw, 'hotkey') || hasOwn(raw, 'hotkeyModifiers')) {
    hotkey = readHotkeyPatch(raw, previous)
    hotkeyChanged = true
  }

  if (hasOwn(raw, 'microphoneId')) {
    const value = raw['microphoneId']
    if (value !== null && typeof value !== 'string') {
      throw new Error('The microphone must be a device id or null.')
    }
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed.length > MAX_MICROPHONE_ID_LENGTH) {
      throw new Error('The microphone id is too long.')
    }
    next.microphoneId = trimmed === '' ? null : trimmed
  }

  if (hasOwn(raw, 'modelPath')) {
    const value = raw['modelPath']
    if (value !== null && typeof value !== 'string') {
      throw new Error('The model must be a file name, a path, or null.')
    }
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed.length > MAX_MODEL_PATH_LENGTH) {
      throw new Error('The model path is too long.')
    }
    next.modelPath = trimmed === '' ? null : trimmed
  }

  if (hasOwn(raw, 'language')) {
    const value = raw['language']
    if (!WHISPER_LANGUAGES.some((language) => language === value)) {
      throw new Error('The language must be "en" or "auto".')
    }
    next.language = readLanguage(value, previous.language)
  }

  if (hasOwn(raw, 'trailingSpace')) {
    if (typeof raw['trailingSpace'] !== 'boolean') {
      throw new Error('The trailing-space setting must be true or false.')
    }
    next.trailingSpace = raw['trailingSpace']
  }

  if (hasOwn(raw, 'minUtteranceMs')) {
    if (typeof raw['minUtteranceMs'] !== 'number' || !Number.isFinite(raw['minUtteranceMs'])) {
      throw new Error('The minimum hold must be a number.')
    }
    minUtteranceMs = clampNumber(
      raw['minUtteranceMs'],
      previous.minUtteranceMs,
      0,
      MIN_UTTERANCE_LIMIT_MS
    )
  }

  if (hasOwn(raw, 'maxUtteranceMs')) {
    if (typeof raw['maxUtteranceMs'] !== 'number' || !Number.isFinite(raw['maxUtteranceMs'])) {
      throw new Error('The maximum hold must be a number.')
    }
    maxUtteranceMs = clampNumber(
      raw['maxUtteranceMs'],
      previous.maxUtteranceMs,
      1,
      RECORDER_MAX_UTTERANCE_MS
    )
  }

  if (minUtteranceMs > maxUtteranceMs) {
    throw new Error('The minimum hold must not be longer than the maximum hold.')
  }
  next.minUtteranceMs = minUtteranceMs
  next.maxUtteranceMs = maxUtteranceMs

  if (hasOwn(raw, 'threads')) {
    if (typeof raw['threads'] !== 'number' || !Number.isFinite(raw['threads'])) {
      throw new Error('The thread count must be a number.')
    }
    next.threads = clampNumber(raw['threads'], previous.threads, 0, MAX_THREADS)
  }

  if (hasOwn(raw, 'autostart')) {
    if (typeof raw['autostart'] !== 'boolean') {
      throw new Error('Start with Windows must be true or false.')
    }
    next.autostart = raw['autostart']
  }

  if (hasOwn(raw, 'overlay')) {
    const overlay = raw['overlay']
    if (!isRecord(overlay)) {
      throw new Error('The overlay setting is invalid.')
    }
    next.overlay = {
      position: readOverlayPosition(overlay['position'], previous.overlay.position)
    }
  }

  if (hasOwn(raw, 'sounds')) {
    if (typeof raw['sounds'] !== 'boolean') {
      throw new Error('Sound cues must be true or false.')
    }
    next.sounds = raw['sounds']
  }

  if (hasOwn(raw, 'pasteRestoreDelayMs')) {
    if (
      typeof raw['pasteRestoreDelayMs'] !== 'number' ||
      !Number.isFinite(raw['pasteRestoreDelayMs'])
    ) {
      throw new Error('The clipboard restore delay must be a number.')
    }
    next.pasteRestoreDelayMs = clampNumber(
      raw['pasteRestoreDelayMs'],
      previous.pasteRestoreDelayMs,
      0,
      MAX_PASTE_RESTORE_DELAY_MS
    )
  }

  if (hotkeyChanged) {
    next.hotkey = hotkey.key
    next.hotkeyModifiers = hotkey.modifiers
  }

  return freezeSettings(next)
}

/**
 * Validates a partial change, updates the in-memory snapshot immediately so
 * live consumers see it, and schedules an atomic write.
 */
export function updateSettings(rawPatch: unknown): MurmurSettings {
  const next = applyPatch(getSettings(), rawPatch)
  currentSettings = next
  scheduleSave()
  return next
}
