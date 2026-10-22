import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  isDictationBeginPayload,
  isDictationSessionPayload,
  type DictationBeginPayload,
  type DictationSessionPayload,
  type RecorderBridge
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
  sendAudio: (payload): void => {
    ipcRenderer.send(IPC_CHANNELS.dictationAudio, payload)
  },
  sendLevel: (payload): void => {
    ipcRenderer.send(IPC_CHANNELS.dictationLevel, payload)
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
