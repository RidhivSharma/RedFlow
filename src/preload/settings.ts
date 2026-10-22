import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HotkeyBinding } from '../shared/hotkey'
import {
  IPC_CHANNELS,
  isMicLevelPayload,
  isMicrophoneDeviceListPayload,
  isRecord,
  type AppInfo,
  type MicrophoneDevice,
  type MurmurBridge,
  type SettingsErrorPayload,
  type SettingsSnapshot,
  type Unsubscribe
} from '../shared/ipc'
import {
  isMurmurSettings,
  type MurmurSettings,
  type SettingsPatch,
  type SettingsUpdateResult
} from '../shared/settings'

type PayloadGuard<T> = (value: unknown) => value is T

function subscribe<T>(
  channel: string,
  guard: PayloadGuard<T>,
  handler: (payload: T) => void
): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    if (guard(payload)) {
      handler(payload)
    }
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

function isSettingsErrorPayload(value: unknown): value is SettingsErrorPayload {
  return (
    isRecord(value) &&
    typeof value['message'] === 'string' &&
    value['message'].length > 0 &&
    value['message'].length <= 500
  )
}

const murmur: MurmurBridge = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>,
  getSettings: (): Promise<SettingsSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsGetState) as Promise<SettingsSnapshot>,
  updateSettings: (patch: SettingsPatch): Promise<SettingsUpdateResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, patch) as Promise<SettingsUpdateResult>,
  onSettingsChanged: (handler: (settings: MurmurSettings) => void): Unsubscribe =>
    subscribe(IPC_CHANNELS.settingsChanged, isMurmurSettings, handler),
  onMicrophonesChanged: (handler: (devices: readonly MicrophoneDevice[]) => void): Unsubscribe =>
    subscribe(IPC_CHANNELS.settingsDevices, isMicrophoneDeviceListPayload, (payload) => {
      handler(payload.devices)
    }),
  onSettingsError: (handler: (message: string) => void): Unsubscribe =>
    subscribe(IPC_CHANNELS.settingsError, isSettingsErrorPayload, (payload) => {
      handler(payload.message)
    }),
  onMicLevel: (handler: (level: number) => void): Unsubscribe =>
    subscribe(IPC_CHANNELS.settingsMicLevel, isMicLevelPayload, (payload) => {
      handler(payload.level)
    }),
  startMicTest: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsStartMicTest) as Promise<void>,
  stopMicTest: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsStopMicTest) as Promise<void>,
  captureHotkey: (): Promise<HotkeyBinding | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsCaptureHotkey) as Promise<HotkeyBinding | null>,
  cancelHotkeyCapture: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsCancelHotkeyCapture) as Promise<void>
}

if (!process.contextIsolated) {
  throw new Error('Murmur requires contextIsolation to be enabled')
}

contextBridge.exposeInMainWorld('murmur', murmur)
