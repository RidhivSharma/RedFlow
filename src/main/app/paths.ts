import { join } from 'node:path'
import { app } from 'electron'

/**
 * Resolves a file inside the app's resources directory. In development the
 * resources live in the repo; in an installed build electron-builder places
 * them next to the app bundle.
 */
export function getResourcePath(...segments: string[]): string {
  const resourcesRoot = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(resourcesRoot, ...segments)
}
