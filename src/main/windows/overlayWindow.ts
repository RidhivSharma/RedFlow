import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { IPC_CHANNELS, type OverlayLevelPayload, type OverlayStatePayload } from '../../shared/ipc'

/** Window size includes a little transparent room for the pill's CSS shadow. */
const OVERLAY_WIDTH = 360
const OVERLAY_HEIGHT = 96
const BOTTOM_MARGIN = 48

let overlayWindow: BrowserWindow | null = null
let overlayReady = false
let lastState: OverlayStatePayload = { state: 'idle' }
let lastLevel = 0

function getLiveOverlayWindow(): BrowserWindow | null {
  if (overlayWindow === null || overlayWindow.isDestroyed()) {
    return null
  }
  return overlayWindow
}

/**
 * Places the pill at the bottom-center of the display under the cursor. On a
 * multi-monitor setup the cursor is the best proxy for the "active" display:
 * unlike BrowserWindow.getFocusedWindow it also reflects a focused external
 * app, and it is where the user is looking when they start dictating.
 *
 * `workArea` and browser-window bounds are both in DIPs, so mixed-DPI monitor
 * layouts are positioned correctly without manual scale-factor math.
 */
function positionOverlay(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const x = Math.round(area.x + (area.width - OVERLAY_WIDTH) / 2)
  const y = Math.round(area.y + area.height - OVERLAY_HEIGHT - BOTTOM_MARGIN)
  window.setBounds({ x, y, width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT })
  console.log(
    `[murmur] overlay bounds ${x},${y} ${OVERLAY_WIDTH}x${OVERLAY_HEIGHT} on display ${display.id} (scale ${display.scaleFactor}, work area ${area.x},${area.y} ${area.width}x${area.height})`
  )
}

function showWhenReady(window: BrowserWindow): void {
  positionOverlay(window)
  window.showInactive()
  console.log('[murmur] overlay shown')
}

function sendState(payload: OverlayStatePayload): void {
  lastState = payload
  const window = getLiveOverlayWindow()
  if (window !== null && overlayReady) {
    window.webContents.send(IPC_CHANNELS.overlayState, payload)
  }
}

function sendLevel(level: number): void {
  lastLevel = level
  const window = getLiveOverlayWindow()
  if (window !== null && overlayReady) {
    const payload: OverlayLevelPayload = { level }
    window.webContents.send(IPC_CHANNELS.overlayLevel, payload)
  }
}

/**
 * Creates the overlay window once and starts loading its renderer. Once the
 * renderer is ready the window is shown inactive and stays mapped for the app's
 * lifetime; idle content is fully transparent. Keeping the window mapped makes
 * the Listening transition a compositor update instead of a ShowWindow call,
 * which measured roughly 150 ms slower on Windows.
 */
export function initializeOverlayWindow(): void {
  if (getLiveOverlayWindow() !== null) {
    return
  }

  // Windows: focusable: false, skipTaskbar, and setIgnoreMouseEvents below make
  // this a non-activating, click-through layer. showInactive() displays it
  // without ever becoming the foreground window, so the dictation target keeps
  // keyboard focus and the caret.
  const window = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    title: 'Murmur Overlay',
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Keep the meter CSS moving smoothly even while another window has focus.
      backgroundThrottling: false
    }
  })

  overlayWindow = window
  overlayReady = false

  // 'screen-saver' is the highest useful level: the overlay still appears above
  // maximized windows and most fullscreen apps, as designed in ARCHITECTURE §3.2.
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setIgnoreMouseEvents(true, { forward: true })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
    }
  })

  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      console.error(`[murmur] overlay renderer error: ${details.message}`)
    } else {
      console.log(details.message)
    }
  })

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[murmur] overlay preload failed at ${preloadPath}`, error)
  })

  window.webContents.once('did-finish-load', () => {
    overlayReady = true
    const liveWindow = getLiveOverlayWindow()
    if (liveWindow === null) {
      return
    }

    // Replay the latest state and level for a dictation that started while the
    // renderer was still loading.
    liveWindow.webContents.send(IPC_CHANNELS.overlayState, lastState)
    liveWindow.webContents.send(IPC_CHANNELS.overlayLevel, { level: lastLevel })

    showWhenReady(liveWindow)
    console.log('[murmur] overlay renderer loaded')
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(
      `[murmur] overlay renderer failed to load (${errorCode}): ${errorDescription} - ${validatedUrl}`
    )
  })

  window.on('closed', () => {
    if (overlayWindow === window) {
      overlayWindow = null
      overlayReady = false
    }
  })

  const repositionOnDisplayChange = (): void => {
    const liveWindow = getLiveOverlayWindow()
    if (liveWindow !== null && liveWindow.isVisible()) {
      positionOverlay(liveWindow)
    }
  }
  screen.on('display-added', repositionOnDisplayChange)
  screen.on('display-removed', repositionOnDisplayChange)
  screen.on('display-metrics-changed', repositionOnDisplayChange)

  window.once('closed', () => {
    screen.off('display-added', repositionOnDisplayChange)
    screen.off('display-removed', repositionOnDisplayChange)
    screen.off('display-metrics-changed', repositionOnDisplayChange)
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const load = devServerUrl
    ? window.loadURL(`${devServerUrl}/overlay/index.html`)
    : window.loadFile(join(__dirname, '../renderer/overlay/index.html'))

  load.catch((error: unknown) => {
    console.error('[murmur] failed to open the overlay window', error)
    if (!window.isDestroyed()) {
      window.destroy()
    }
  })
}

/**
 * Moves the pill to the display under the cursor. Called when a new utterance
 * starts, so the pill stays on the display where dictation began even if the
 * pointer wanders while whisper runs.
 */
export function positionOverlayWindow(): void {
  const window = getLiveOverlayWindow()
  if (window !== null && overlayReady) {
    positionOverlay(window)
  }
}

/**
 * Ensures the mapped overlay window is visible. The normal path is a no-op;
 * showInactive() is only needed if Windows hid the window for some reason.
 */
export function showOverlayWindow(): void {
  const window = getLiveOverlayWindow()
  if (window === null || !overlayReady) {
    return
  }

  if (!window.isVisible()) {
    showWhenReady(window)
  }
}

export function sendOverlayState(payload: OverlayStatePayload): void {
  sendState(payload)
}

export function sendOverlayLevel(level: number): void {
  sendLevel(level)
}

/** Destroys the overlay window during app shutdown. */
export function destroyOverlayWindow(): void {
  const window = getLiveOverlayWindow()
  overlayWindow = null
  overlayReady = false

  if (window !== null) {
    window.destroy()
  }
}
