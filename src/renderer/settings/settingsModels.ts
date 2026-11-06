import type { SettingsSnapshot } from '@shared/ipc'

export interface ModelChoice {
  readonly file: string
  readonly sizeBytes: number | null
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}

export function modelChoicesFor(snapshot: SettingsSnapshot): ModelChoice[] {
  const choices: ModelChoice[] = snapshot.models.map((model) => ({
    file: model.file,
    sizeBytes: model.sizeBytes
  }))
  const selected = snapshot.settings.modelPath ?? snapshot.defaultModelFile
  if (!choices.some((choice) => choice.file === selected)) {
    choices.unshift({ file: selected, sizeBytes: null })
  }
  return choices
}
