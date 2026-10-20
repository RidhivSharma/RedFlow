import type { MurmurBridge } from '../shared/ipc'

declare global {
  interface Window {
    murmur: MurmurBridge
  }
}

export {}
