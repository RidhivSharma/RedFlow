import { app } from 'electron'

/**
 * Mirrors the `autostart` setting into the Windows login items. It is applied
 * at startup as well as on change so removing the entry outside Murmur (for
 * example through Task Manager's Startup tab) is repaired next launch.
 *
 * In development `process.execPath` is electron.exe, so the app path is passed
 * as an argument; the installed build launches Murmur.exe directly.
 */
export function applyAutostart(enabled: boolean): void {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
    } else {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: [app.getAppPath()]
      })
    }
    console.log(`[murmur] start with Windows ${enabled ? 'enabled' : 'disabled'}`)
  } catch (error) {
    console.error('[murmur] could not update the start-with-Windows setting', error)
  }
}
