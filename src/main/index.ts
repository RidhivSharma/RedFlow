import { app, dialog } from 'electron'
import { applyAutostart } from './app/autostart'
import { initializeLogging } from './app/logger'
import { configureSessionPermissions } from './app/permissions'
import { acquireSingleInstanceLock } from './app/singleInstance'
import { createTray, destroyTray, setTrayTooltip } from './app/tray'
import { createDictationController, type DictationController } from './dictation'
import { createHotkeyController, type HotkeyController } from './hotkeyController'
import { registerIpcHandlers } from './ipc'
import { flushSettings, getSettings, initializeSettings } from './settings'
import { createSettingsController, type SettingsController } from './settingsController'
import { openSettingsWindow } from './windows/settingsWindow'

// Windows: setting an explicit AppUserModelID makes Windows attribute the tray
// icon and notifications to Murmur instead of the generic "electron" identity.
const APP_USER_MODEL_ID = 'dev.murmur.app'

app.setName('Murmur')
app.setAppUserModelId(APP_USER_MODEL_ID)

let activeDictation: DictationController | null = null
let activeHotkey: HotkeyController | null = null
let activeSettings: SettingsController | null = null

function reportStartupError(message: string, error: unknown): void {
  console.error(`[murmur] ${message}`, error)
  dialog.showErrorBox(
    'Murmur',
    `${message}\n\n${error instanceof Error ? error.message : String(error)}`
  )
}

async function startApp(): Promise<void> {
  // Install the rotating log before settings and windows start emitting messages.
  initializeLogging()

  try {
    await initializeSettings()
  } catch (error) {
    reportStartupError('Could not load Murmur settings.', error)
    app.quit()
    return
  }

  const settings = getSettings()

  const dictation = createDictationController({ getSettings })
  activeDictation = dictation

  const hotkey = createHotkeyController({
    onStart: dictation.start,
    onStop: dictation.stop,
    onError: (message, error) => {
      console.error(`[murmur] ${message}`, error)
      setTrayTooltip('Hotkey unavailable')
    }
  })
  activeHotkey = hotkey

  // Registers the settings IPC handlers and connects live changes to the
  // hotkey, microphone pipeline, and Windows login item.
  activeSettings = createSettingsController({ dictation, hotkey })

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

  // Create the hidden window and warm the microphone before the hotkey goes
  // live. Capture failures are reported through the tray, and the app keeps
  // running so a later attempt can retry.
  await dictation.initialize()

  hotkey.apply({ key: settings.hotkey, modifiers: settings.hotkeyModifiers })
  applyAutostart(settings.autostart)

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

  let shuttingDown = false
  let cleanupComplete = false
  app.on('before-quit', (event) => {
    if (cleanupComplete) {
      return
    }

    // Wait for whisper to be killed and its WAV snapshot removed before the
    // process exits. A repeated quit request must not bypass the cleanup.
    event.preventDefault()
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    const settingsController = activeSettings
    const hotkeyController = activeHotkey
    const dictation = activeDictation
    activeSettings = null
    activeHotkey = null
    activeDictation = null

    settingsController?.dispose()
    hotkeyController?.dispose()

    void (async () => {
      try {
        await dictation?.dispose()
      } catch (error) {
        console.error('[murmur] shutdown cleanup failed', error)
      }

      try {
        // Persist a change made just before Quit; the save is normally
        // debounced, so it may still be waiting.
        await flushSettings()
      } catch (error) {
        console.error('[murmur] settings could not be flushed during shutdown', error)
      }

      destroyTray()
      cleanupComplete = true
      app.quit()
    })()
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
