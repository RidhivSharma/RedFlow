import { RECORDER_MAX_UTTERANCE_MS } from './audio'
import { DEFAULT_HOTKEY_BINDING, HOTKEY_MODIFIERS, type HotkeyModifier } from './hotkey'

/**
 * Settings schema shared by the main process, the settings preload, and the
 * settings renderer. The file on disk uses the same shape; validation and
 * migration live in `src/main/settings.ts`.
 */
export const SETTINGS_SCHEMA_VERSION = 2

/** The model Murmur ships with; `modelPath: null` resolves to this file. */
export const DEFAULT_MODEL_FILE = 'ggml-base.en.bin'

export const WHISPER_LANGUAGES = ['en', 'auto'] as const

export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number]

export const OVERLAY_POSITIONS = ['bottom-center'] as const

export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number]

export interface MurmurSettings {
  readonly schemaVersion: number
  readonly hotkey: string
  readonly hotkeyModifiers: readonly HotkeyModifier[]
  /** `null` means the Windows default input device. */
  readonly microphoneId: string | null
  /**
   * A `.bin` file name inside `resources/models`, an absolute path, or `null`
   * for the bundled model. Relative file names keep the setting portable
   * between the dev checkout and an installed app.
   */
  readonly modelPath: string | null
  readonly language: WhisperLanguage
  /** Append one space after the transcript so consecutive dictations flow. */
  readonly trailingSpace: boolean
  /** Holds shorter than this are discarded as taps. */
  readonly minUtteranceMs: number
  /** Hard upper bound for one utterance. */
  readonly maxUtteranceMs: number
  /** whisper threads; `0` means auto. */
  readonly threads: number
  readonly autostart: boolean
  readonly overlay: { readonly position: OverlayPosition }
  readonly sounds: boolean
  readonly pasteRestoreDelayMs: number
}

/** Every field a settings window is allowed to change. */
export type SettingsPatch = Partial<Omit<MurmurSettings, 'schemaVersion' | 'overlay'>> & {
  readonly overlay?: { readonly position: OverlayPosition }
}

export type SettingsUpdateResult =
  | { readonly ok: true; readonly settings: MurmurSettings }
  | { readonly ok: false; readonly message: string }

export interface ModelOption {
  /** File name inside the models folder. */
  readonly file: string
  readonly sizeBytes: number
}

/**
 * Defaults mirror docs/ARCHITECTURE.md §8. The hotkey defaults to holding F9,
 * the microphone to the Windows default device, English-only whisper, and one
 * trailing space after each inserted transcript.
 */
export const DEFAULT_SETTINGS: MurmurSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  hotkey: DEFAULT_HOTKEY_BINDING.key,
  hotkeyModifiers: [...DEFAULT_HOTKEY_BINDING.modifiers],
  microphoneId: null,
  modelPath: null,
  language: 'en',
  trailingSpace: true,
  minUtteranceMs: 300,
  maxUtteranceMs: RECORDER_MAX_UTTERANCE_MS,
  threads: 0,
  autostart: false,
  overlay: { position: 'bottom-center' },
  sounds: false,
  pasteRestoreDelayMs: 350
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Runtime guard for the settings snapshot pushed from main. Main is trusted,
 * but the preload still refuses to hand a malformed object to React.
 */
export function isMurmurSettings(value: unknown): value is MurmurSettings {
  if (!isPlainObject(value)) {
    return false
  }

  const modifiers = value['hotkeyModifiers']
  const overlay = value['overlay']
  return (
    typeof value['schemaVersion'] === 'number' &&
    typeof value['hotkey'] === 'string' &&
    Array.isArray(modifiers) &&
    modifiers.every((modifier) => HOTKEY_MODIFIERS.some((known) => known === modifier)) &&
    (value['microphoneId'] === null || typeof value['microphoneId'] === 'string') &&
    (value['modelPath'] === null || typeof value['modelPath'] === 'string') &&
    WHISPER_LANGUAGES.some((language) => language === value['language']) &&
    typeof value['trailingSpace'] === 'boolean' &&
    typeof value['minUtteranceMs'] === 'number' &&
    typeof value['maxUtteranceMs'] === 'number' &&
    typeof value['threads'] === 'number' &&
    typeof value['autostart'] === 'boolean' &&
    isPlainObject(overlay) &&
    OVERLAY_POSITIONS.some((position) => position === overlay['position']) &&
    typeof value['sounds'] === 'boolean' &&
    typeof value['pasteRestoreDelayMs'] === 'number'
  )
}
