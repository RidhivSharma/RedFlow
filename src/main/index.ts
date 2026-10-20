import { app, dialog } from 'electron'
import { acquireSingleInstanceLock } from './app/singleInstance'
import { createTray, destroyTray } from './app/tray'
import { registerIpcHandlers } from './ipc'
import { ensureSettingsFile, getSettingsFilePath } from './settings'
import { openSettingsWindow } from './windows/settingsWindow'

// Windows: setting an explicit AppUserModelID makes Windows attribute the tray
// icon and notifications to Murmur instead of the generic "electron" identity.
const APP_USER_MODEL_ID = 'dev.murmur.app'

app.setName('Murmur')
app.setAppUserModelId(APP_USER_MODEL_ID)

function reportStartupError(message: string, error: unknown): void {
  console.error(`[murmur] ${message}`, error)
  dialog.showErrorBox(
    'Murmur',
    `${message}\n\n${error instanceof Error ? error.message : String(error)}`
  )
}

async function startApp(): Promise<void> {
  try {
    await ensureSettingsFile()
  } catch (error) {
    reportStartupError(`Could not create the settings file at ${getSettingsFilePath()}.`, error)
  }

  try {
    createTray({
      onOpenSettings: openSettingsWindow,
      onQuit: () => app.quit()
    })
  } catch (error) {
    reportStartupError('Could not create the Murmur tray icon.', error)
    app.quit()
    return
  }

  console.log('[murmur] ready - running in the system tray')
}

// A second launch can arrive before Electron is ready, when BrowserWindow
// creation is not allowed yet. Deferring through whenReady keeps that path safe.
function openSettingsWhenReady(): void {
  void app.whenReady().then(openSettingsWindow)
}

function bootstrap(): void {
  const hasLock = acquireSingleInstanceLock(openSettingsWhenReady)
  if (!hasLock) {
    app.quit()
    return
  }

  // Windows: a tray app must keep running when its settings window closes.
  // Quitting happens only through the tray menu, so this handler stays empty.
  app.on('window-all-closed', () => {
    // Intentionally empty.
  })

  app.on('before-quit', () => {
    destroyTray()
  })

  void app
    .whenReady()
    .then(async () => {
      registerIpcHandlers()
      await startApp()
    })
    .catch((error: unknown) => {
      reportStartupError('Murmur failed to start.', error)
      app.quit()
    })
}

bootstrap()
