import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  isDictationBeginPayload,
  isDictationSessionPayload,
  isMicLevelPayload,
  isRecorderSetDevicePayload,
  isRecorderTestMonitorPayload,
  type DictationBeginPayload,
  type DictationSessionPayload,
  type RecorderBridge,
  type RecorderConfigPayload,
  type RecorderSetDevicePayload,
  type RecorderTestMonitorPayload
} from '../shared/ipc'

type PayloadGuard<T> = (value: unknown) => value is T

function subscribe<T>(
  channel: string,
  guard: PayloadGuard<T>,
  handler: (payload: T) => void
): void {
  ipcRenderer.on(channel, (_event, payload: unknown) => {
    if (guard(payload)) {
      handler(payload)
    }
  })
}

const murmurRecorder: RecorderBridge = {
  onBegin: (handler: (payload: DictationBeginPayload) => void): void => {
    subscribe(IPC_CHANNELS.dictationBegin, isDictationBeginPayload, handler)
  },
  onFinish: (handler: (payload: DictationSessionPayload) => void): void => {
    subscribe(IPC_CHANNELS.dictationFinish, isDictationSessionPayload, handler)
  },
  onCancel: (handler: (payload: DictationSessionPayload) => void): void => {
    subscribe(IPC_CHANNELS.dictationCancel, isDictationSessionPayload, handler)
  },
  onSetDevice: (handler: (payload: RecorderSetDevicePayload) => void): void => {
    subscribe(IPC_CHANNELS.recorderSetDevice, isRecorderSetDevicePayload, handler)
  },
  onTestMonitor: (handler: (payload: RecorderTestMonitorPayload) => void): void => {
    subscribe(IPC_CHANNELS.recorderTestMonitor, isRecorderTestMonitorPayload, handler)
  },
  onRequestDevices: (handler: () => void): void => {
    ipcRenderer.on(IPC_CHANNELS.recorderListDevices, () => handler())
  },
  getConfig: (): Promise<RecorderConfigPayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.recorderGetConfig) as Promise<RecorderConfigPayload>,
  sendAudio: (payload): void => {
    ipcRenderer.send(IPC_CHANNELS.dictationAudio, payload)
  },
  sendLevel: (payload): void => {
    ipcRenderer.send(IPC_CHANNELS.dictationLevel, payload)
  },
  sendMonitorLevel: (payload): void => {
    if (isMicLevelPayload(payload)) {
      ipcRenderer.send(IPC_CHANNELS.recorderMonitorLevel, payload)
    }
  },
  reportDevices: (payload): void => {
    ipcRenderer.send(IPC_CHANNELS.recorderDevices, payload)
  },
  reportCaptureError: (payload): void => {
    ipcRenderer.send(IPC_CHANNELS.dictationCaptureError, payload)
  },
  reportStatus: (payload): void => {
    ipcRenderer.send(IPC_CHANNELS.recorderStatus, payload)
  }
}

if (!process.contextIsolated) {
  throw new Error('Murmur requires contextIsolation to be enabled')
}

contextBridge.exposeInMainWorld('murmurRecorder', murmurRecorder)
