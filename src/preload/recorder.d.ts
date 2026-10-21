import type { RecorderBridge } from '../shared/ipc'

declare global {
  interface Window {
    murmurRecorder: RecorderBridge
  }
}

export {}
