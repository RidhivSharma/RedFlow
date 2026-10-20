import { app } from 'electron'

/**
 * Acquires the per-user single-instance lock. A second launch is rejected:
 * two copies would mean two hotkey listeners, two tray icons, and competing
 * clipboard writers.
 *
 * Returns `true` when this process owns the app and may continue booting.
 */
export function acquireSingleInstanceLock(onSecondInstance: () => void): boolean {
  const hasLock = app.requestSingleInstanceLock()
  if (!hasLock) {
    return false
  }

  app.on('second-instance', () => {
    console.log('[murmur] second instance blocked; showing the running app')
    onSecondInstance()
  })

  return true
}
