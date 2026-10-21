import { session, type WebContents } from 'electron'
import { isRecorderWebContents } from '../windows/recorderWindow'

/**
 * Allows only the hidden recorder window to use the microphone and denies
 * every other permission request. Chromium asks both a synchronous check and
 * an asynchronous request handler for media capture, so both are wired.
 */
export function configureSessionPermissions(): void {
  const defaultSession = session.defaultSession

  defaultSession.setPermissionRequestHandler(
    (webContents: WebContents, permission, callback, details) => {
      if (permission !== 'media' || !isRecorderWebContents(webContents)) {
        callback(false)
        return
      }

      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
      // Audio only: Murmur has no reason to request a camera, and denying video
      // here means a compromised renderer cannot turn one on.
      callback(mediaTypes === undefined || mediaTypes.every((type) => type === 'audio'))
    }
  )

  defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if (permission !== 'media' || !isRecorderWebContents(webContents)) {
      return false
    }

    return details.mediaType !== 'video'
  })
}
