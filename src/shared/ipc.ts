/**
 * IPC channel names and payload types shared by the main process, preload
 * scripts, and renderers. Channel strings exist here and nowhere else.
 */
export const IPC_CHANNELS = {
  appInfo: 'app:info'
} as const

export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly electronVersion: string
  readonly platform: string
}

/** The only API exposed to the settings renderer through `window.murmur`. */
export interface MurmurBridge {
  getAppInfo(): Promise<AppInfo>
}
