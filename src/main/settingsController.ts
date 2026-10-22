import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  IPC_CHANNELS,
  type MicrophoneDevice,
  type MicLevelPayload,
  type SettingsErrorPayload,
  type SettingsSnapshot
} from '../shared/ipc'
import {
  DEFAULT_MODEL_FILE,
  type MurmurSettings,
  type SettingsUpdateResult
} from '../shared/settings'
import { applyAutostart } from './app/autostart'
import { setTrayTooltip } from './app/tray'
import type { DictationController } from './dictation'
import type { HotkeyController } from './hotkeyController'
import { listModelOptions } from './models'
import { getSettings, setSettingsSaveErrorHandler, updateSettings } from './settings'
import { isSettingsWebContents, sendToSettings } from './windows/settingsWindow'

export interface SettingsControllerOptions {
  readonly dictation: DictationController
  readonly hotkey: HotkeyController
}

export interface SettingsController {
  dispose(): void
}

function canChangeHotkey(previous: MurmurSettings, next: MurmurSettings): boolean {
  return (
    previous.hotkey !== next.hotkey ||
    previous.hotkeyModifiers.length !== next.hotkeyModifiers.length ||
    previous.hotkeyModifiers.some((modifier, index) => modifier !== next.hotkeyModifiers[index])
  )
}

/**
 * Wires the validated settings store to the live app (hotkey, microphone,
 * autostart) and serves the settings renderer. Keeping every mutation here
 * means the settings window can change behavior without restarting Murmur.
 */
export function createSettingsController(options: SettingsControllerOptions): SettingsController {
  let micTestActive = false
  let micTestSender: WebContents | null = null

  function sendSettingsChanged(settings: MurmurSettings): void {
    sendToSettings(IPC_CHANNELS.settingsChanged, settings)
  }

  function sendDevices(devices: readonly MicrophoneDevice[]): void {
    sendToSettings(IPC_CHANNELS.settingsDevices, { devices })
  }

  function stopMicTest(): void {
    if (micTestSender !== null) {
      micTestSender.removeListener('destroyed', stopMicTest)
      micTestSender = null
    }

    if (!micTestActive) {
      return
    }

    micTestActive = false
    options.dictation.stopMicTest()
    const silentLevel: MicLevelPayload = { level: 0 }
    sendToSettings(IPC_CHANNELS.settingsMicLevel, silentLevel)
  }

  function startMicTest(sender: WebContents): void {
    if (micTestSender !== sender) {
      micTestSender?.removeListener('destroyed', stopMicTest)
      micTestSender = sender
      sender.once('destroyed', stopMicTest)
    }

    if (micTestActive) {
      return
    }

    micTestActive = true
    options.dictation.startMicTest((level) => {
      if (!micTestActive) {
        return
      }
      const payload: MicLevelPayload = { level }
      sendToSettings(IPC_CHANNELS.settingsMicLevel, payload)
    })
  }

  function applyChangedSettings(previous: MurmurSettings, next: MurmurSettings): void {
    if (canChangeHotkey(previous, next)) {
      // The binding was validated before it was saved; a failed hook start is
      // reported through the tray by hotkeyController's onError handler.
      options.hotkey.apply({ key: next.hotkey, modifiers: next.hotkeyModifiers })
    }

    if (previous.microphoneId !== next.microphoneId) {
      options.dictation.setMicrophone(next.microphoneId)
    }

    if (previous.autostart !== next.autostart) {
      applyAutostart(next.autostart)
    }
  }

  async function getState(): Promise<SettingsSnapshot> {
    const [models, microphones] = await Promise.all([
      listModelOptions(),
      options.dictation.listMicrophones()
    ])

    return {
      settings: getSettings(),
      models,
      defaultModelFile: DEFAULT_MODEL_FILE,
      microphones
    }
  }

  function update(patch: unknown): SettingsUpdateResult {
    try {
      const previous = getSettings()
      const next = updateSettings(patch)
      applyChangedSettings(previous, next)
      sendSettingsChanged(next)
      return { ok: true, settings: next }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The settings change was rejected.'
      }
    }
  }

  function assertSettingsSender(event: IpcMainInvokeEvent): void {
    if (!isSettingsWebContents(event.sender)) {
      throw new Error('This action is only available to the Murmur settings window.')
    }
  }

  ipcMain.handle(IPC_CHANNELS.settingsGetState, async (event): Promise<SettingsSnapshot> => {
    assertSettingsSender(event)
    return getState()
  })

  ipcMain.handle(IPC_CHANNELS.settingsUpdate, (event, patch: unknown): SettingsUpdateResult => {
    assertSettingsSender(event)
    return update(patch)
  })

  ipcMain.handle(IPC_CHANNELS.settingsStartMicTest, (event): void => {
    assertSettingsSender(event)
    startMicTest(event.sender)
  })

  ipcMain.handle(IPC_CHANNELS.settingsStopMicTest, (event): void => {
    assertSettingsSender(event)
    stopMicTest()
  })

  ipcMain.handle(IPC_CHANNELS.settingsCaptureHotkey, async (event) => {
    assertSettingsSender(event)
    const onDestroyed = (): void => options.hotkey.cancelCapture()
    event.sender.once('destroyed', onDestroyed)
    try {
      return await options.hotkey.capture()
    } finally {
      event.sender.removeListener('destroyed', onDestroyed)
    }
  })

  ipcMain.handle(IPC_CHANNELS.settingsCancelHotkeyCapture, (event): void => {
    assertSettingsSender(event)
    options.hotkey.cancelCapture()
  })

  options.dictation.setMicrophoneListListener((devices) => {
    sendDevices(devices)
  })

  setSettingsSaveErrorHandler((error) => {
    const detail = error instanceof Error ? error.message : String(error)
    const payload: SettingsErrorPayload = {
      message: `Settings could not be saved: ${detail}`
    }
    console.error('[murmur] settings could not be saved', error)
    setTrayTooltip('Could not save settings')
    sendToSettings(IPC_CHANNELS.settingsError, payload)
  })

  function dispose(): void {
    ipcMain.removeHandler(IPC_CHANNELS.settingsGetState)
    ipcMain.removeHandler(IPC_CHANNELS.settingsUpdate)
    ipcMain.removeHandler(IPC_CHANNELS.settingsStartMicTest)
    ipcMain.removeHandler(IPC_CHANNELS.settingsStopMicTest)
    ipcMain.removeHandler(IPC_CHANNELS.settingsCaptureHotkey)
    ipcMain.removeHandler(IPC_CHANNELS.settingsCancelHotkeyCapture)
    setSettingsSaveErrorHandler(null)
    options.dictation.setMicrophoneListListener(null)
    stopMicTest()
  }

  return { dispose }
}
