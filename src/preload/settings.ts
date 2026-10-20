import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AppInfo, type MurmurBridge } from '../shared/ipc'

const murmur: MurmurBridge = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>
}

if (!process.contextIsolated) {
  throw new Error('Murmur requires contextIsolation to be enabled')
}

contextBridge.exposeInMainWorld('murmur', murmur)
