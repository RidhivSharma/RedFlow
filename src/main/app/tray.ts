import { Menu, Tray, nativeImage } from 'electron'
import { getResourcePath } from './paths'

export interface TrayActions {
  readonly onOpenSettings: () => void
  readonly onQuit: () => void
}

let tray: Tray | null = null

/**
 * Creates the tray icon and its menu. The tray is the app's only visible
 * surface while idle, so a missing icon is a fatal startup error.
 */
export function createTray(actions: TrayActions): void {
  if (tray !== null) {
    return
  }

  const iconPath = getResourcePath('icons', 'murmur.ico')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    throw new Error(`Tray icon could not be loaded from ${iconPath}`)
  }

  const nextTray = new Tray(icon)
  nextTray.setToolTip('Murmur — push-to-talk dictation')
  nextTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Settings', click: actions.onOpenSettings },
      { type: 'separator' },
      { label: 'Quit', click: actions.onQuit }
    ])
  )

  // Windows: double-clicking a tray icon is the familiar shortcut for bringing
  // a tray-only app back to the foreground.
  nextTray.on('double-click', actions.onOpenSettings)

  tray = nextTray
  console.log('[murmur] tray icon created')
}

export function destroyTray(): void {
  if (tray === null) {
    return
  }

  tray.destroy()
  tray = null
}
