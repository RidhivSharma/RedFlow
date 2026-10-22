import { join } from 'node:path'
import { BrowserWindow, type WebContents } from 'electron'
import { getResourcePath } from '../app/paths'

let settingsWindow: BrowserWindow | null = null

function getLiveSettingsWindow(): BrowserWindow | null {
  if (settingsWindow === null || settingsWindow.isDestroyed()) {
    return null
  }
  return settingsWindow
}

/** True only for the settings window; used as an IPC sender check. */
export function isSettingsWebContents(webContents: WebContents | null): boolean {
  if (webContents === null) {
    return false
  }
  return getLiveSettingsWindow()?.webContents.id === webContents.id
}

/** Pushes one update to the settings renderer when it is open. */
export function sendToSettings(channel: string, payload: unknown): void {
  const window = getLiveSettingsWindow()
  if (window !== null) {
    window.webContents.send(channel, payload)
  }
}

/**
 * Opens the settings window, or brings the existing one forward. The window is
 * a singleton: closing it destroys it and leaves the app alive in the tray.
 */
export function openSettingsWindow(): void {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore()
    }
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  const window = new BrowserWindow({
    title: 'Murmur Settings',
    width: 780,
    height: 680,
    minWidth: 560,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    icon: getResourcePath('icons', 'murmur.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  settingsWindow = window

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (settingsWindow === window) {
      settingsWindow = null
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
    }
  })

  window.webContents.on('did-finish-load', () => {
    console.log('[murmur] settings renderer loaded')
  })

  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      console.error(
        `[murmur] settings renderer error: ${details.message} (${details.sourceId}:${details.lineNumber})`
      )
    }
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(
      `[murmur] settings renderer failed to load (${errorCode}): ${errorDescription} - ${validatedUrl}`
    )
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const load = devServerUrl
    ? window.loadURL(`${devServerUrl}/settings/index.html`)
    : window.loadFile(join(__dirname, '../renderer/settings/index.html'))

  load.catch((error: unknown) => {
    console.error('[murmur] failed to open the settings window', error)
    if (!window.isDestroyed()) {
      window.destroy()
    }
  })
}
