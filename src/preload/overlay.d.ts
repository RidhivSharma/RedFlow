import type { OverlayBridge } from '../shared/ipc'

declare global {
  interface Window {
    murmurOverlay: OverlayBridge
  }
}

export {}
