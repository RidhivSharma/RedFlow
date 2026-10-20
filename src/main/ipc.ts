import { app, ipcMain } from 'electron'
import { IPC_CHANNELS, type AppInfo } from '../shared/ipc'

/**
 * Registers every invoke-style IPC handler. Handlers are registered once,
 * after the app is ready, before any window can call them.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform
  }))
}
