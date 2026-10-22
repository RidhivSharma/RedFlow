import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelOption } from '../shared/settings'
import { getResourcePath } from './app/paths'

/**
 * Lists the whisper model files shipped in `resources/models`. The settings
 * window offers these names; a custom absolute `modelPath` still works and is
 * shown alongside them by the renderer.
 */
export async function listModelOptions(): Promise<ModelOption[]> {
  const modelsDirectory = getResourcePath('models')

  try {
    const entries = await readdir(modelsDirectory, { withFileTypes: true })
    const options: ModelOption[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.bin')) {
        continue
      }

      try {
        const info = await stat(join(modelsDirectory, entry.name))
        options.push({ file: entry.name, sizeBytes: info.size })
      } catch (error) {
        console.error(`[murmur] could not read model file ${entry.name}`, error)
      }
    }

    return options.sort((left, right) => left.file.localeCompare(right.file))
  } catch (error) {
    console.error(`[murmur] could not list models in ${modelsDirectory}`, error)
    return []
  }
}
