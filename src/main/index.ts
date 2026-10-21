import { app, dialog } from 'electron'
import { configureSessionPermissions } from './app/permissions'
import { acquireSingleInstanceLock } from './app/singleInstance'
import { createTray, destroyTray, setTrayTooltip } from './app/tray'
import { createDictationController, type DictationController } from './dictation'
import { startHotkeyListener, stopHotkeyListener } from './hotkey'
import { registerIpcHandlers } from './ipc'
import { ensureSettingsFile, getSettingsFilePath, loadStartupPreferences } from './settings'
import { openSettingsWindow } from './windows/settingsWindow'

// Windows: setting an explicit AppUserModelID makes Windows attribute the tray
// icon and notifications to Murmur instead of the generic "electron" identity.
const APP_USER_MODEL_ID = 'dev.murmur.app'

app.setName('Murmur')
app.setAppUserModelId(APP_USER_MODEL_ID)

let activeDictation: DictationController | null = null

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

  // Chromium must allow the hidden recorder to use the microphone. The handler
  // checks the requesting window, so the settings window still cannot.
  configureSessionPermissions()

  const preferences = await loadStartupPreferences()
  const dictation = createDictationController({
    minUtteranceMs: preferences.minUtteranceMs,
    maxUtteranceMs: preferences.maxUtteranceMs
  })
  activeDictation = dictation

  // Create the hidden window and warm the microphone before the hotkey goes
  // live. Capture failures are reported through the tray, and the app keeps
  // running so a later attempt can retry.
  await dictation.initialize()

  startHotkeyListener({
    key: preferences.hotkey.key,
    modifiers: preferences.hotkey.modifiers,
    onStart: dictation.start,
    onStop: dictation.stop,
    onError: (message, error) => {
      console.error(`[murmur] ${message}`, error)
      setTrayTooltip('Hotkey unavailable')
    }
  })

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
    stopHotkeyListener()
    activeDictation?.dispose()
    activeDictation = null
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
