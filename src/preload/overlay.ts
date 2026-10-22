import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  isOverlayLevelPayload,
  isOverlayStatePayload,
  type OverlayBridge
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

const murmurOverlay: OverlayBridge = {
  onState: (handler): void => {
    subscribe(IPC_CHANNELS.overlayState, isOverlayStatePayload, handler)
  },
  onLevel: (handler): void => {
    subscribe(IPC_CHANNELS.overlayLevel, isOverlayLevelPayload, handler)
  }
}

if (!process.contextIsolated) {
  throw new Error('Murmur requires contextIsolation to be enabled')
}

contextBridge.exposeInMainWorld('murmurOverlay', murmurOverlay)
