import { join } from 'node:path'
import { BrowserWindow, type WebContents } from 'electron'
import {
  IPC_CHANNELS,
  type DictationBeginPayload,
  type DictationSessionPayload,
  type RecorderSetDevicePayload,
  type RecorderTestMonitorPayload
} from '../../shared/ipc'

type RecorderOutboundChannel =
  | typeof IPC_CHANNELS.dictationBegin
  | typeof IPC_CHANNELS.dictationFinish
  | typeof IPC_CHANNELS.dictationCancel

type RecorderControlChannel =
  | typeof IPC_CHANNELS.recorderSetDevice
  | typeof IPC_CHANNELS.recorderListDevices
  | typeof IPC_CHANNELS.recorderTestMonitor

let recorderWindow: BrowserWindow | null = null
let loading: Promise<BrowserWindow> | null = null

function getLiveRecorderWindow(): BrowserWindow | null {
  if (recorderWindow === null || recorderWindow.isDestroyed()) {
    return null
  }
  return recorderWindow
}

export function getRecorderWebContents(): WebContents | null {
  return getLiveRecorderWindow()?.webContents ?? null
}

/** True only for the hidden recorder window; used as an IPC sender check. */
export function isRecorderWebContents(webContents: WebContents | null): boolean {
  if (webContents === null) {
    return false
  }

  const recorder = getRecorderWebContents()
  return recorder !== null && recorder.id === webContents.id
}

/**
 * Creates the hidden recorder window once and loads its page. The returned
 * promise resolves when the renderer has finished loading, never when the
 * microphone is warm — the recorder reports that separately.
 */
export function createRecorderWindow(): Promise<BrowserWindow> {
  const existing = getLiveRecorderWindow()
  if (existing !== null) {
    return loading ?? Promise.resolve(existing)
  }

  // Windows: never visible, never focusable, and absent from the taskbar. It
  // exists only so getUserMedia and the AudioWorklet have a renderer to run in.
  const window = new BrowserWindow({
    show: false,
    frame: false,
    width: 320,
    height: 240,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Murmur Recorder',
    webPreferences: {
      preload: join(__dirname, '../preload/recorder.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Windows: hidden pages throttle timers and audio. The recorder must keep
      // its mic stream and AudioContext running while the user is not speaking.
      backgroundThrottling: false,
      // A hidden window has no user gesture, so the AudioContext would otherwise
      // start suspended and drop the first utterance.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  recorderWindow = window

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
    }
  })

  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      console.error(details.message)
    } else if (details.level === 'warning') {
      console.warn(details.message)
    } else {
      console.log(details.message)
    }
  })

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[murmur] recorder preload failed at ${preloadPath}`, error)
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[murmur] recorder renderer stopped (${details.reason}, exit code ${details.exitCode})`
    )
  })

  window.on('closed', () => {
    if (recorderWindow === window) {
      recorderWindow = null
      loading = null
    }
  })

  loading = new Promise<BrowserWindow>((resolve, reject) => {
    window.webContents.once('did-finish-load', () => {
      console.log('[murmur] recorder renderer loaded')
      resolve(window)
    })

    window.webContents.once(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame) {
          return
        }
        reject(
          new Error(
            `Recorder renderer failed to load (${errorCode}): ${errorDescription} - ${validatedUrl}`
          )
        )
      }
    )
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const load = devServerUrl
    ? window.loadURL(`${devServerUrl}/recorder/index.html`)
    : window.loadFile(join(__dirname, '../renderer/recorder/index.html'))

  load.catch((error: unknown) => {
    console.error('[murmur] failed to open the recorder window', error)
    if (!window.isDestroyed()) {
      window.destroy()
    }
  })

  return loading
}

/**
 * Sends one of the three main → recorder messages. Returns `false` when the
 * window is not available so callers can surface a useful error instead of
 * leaving a session stuck.
 */
export function sendToRecorder(
  channel: RecorderOutboundChannel,
  payload: DictationBeginPayload | DictationSessionPayload
): boolean {
  const window = getLiveRecorderWindow()
  if (window === null) {
    return false
  }

  window.webContents.send(channel, payload)
  return true
}

/**
 * Sends a settings-driven control message to the recorder. Returns `false`
 * when the hidden window is not available, so the caller can fall back to the
 * last known device list.
 */
export function sendToRecorderControl(
  channel: typeof IPC_CHANNELS.recorderSetDevice,
  payload: RecorderSetDevicePayload
): boolean
export function sendToRecorderControl(
  channel: typeof IPC_CHANNELS.recorderTestMonitor,
  payload: RecorderTestMonitorPayload
): boolean
export function sendToRecorderControl(channel: typeof IPC_CHANNELS.recorderListDevices): boolean
export function sendToRecorderControl(
  channel: RecorderControlChannel,
  payload?: RecorderSetDevicePayload | RecorderTestMonitorPayload
): boolean {
  const window = getLiveRecorderWindow()
  if (window === null) {
    return false
  }

  if (payload === undefined) {
    window.webContents.send(channel)
  } else {
    window.webContents.send(channel, payload)
  }
  return true
}

/** Destroys the recorder window during app shutdown. */
export function destroyRecorderWindow(): void {
  const window = getLiveRecorderWindow()
  recorderWindow = null
  loading = null

  if (window !== null) {
    window.destroy()
  }
}
