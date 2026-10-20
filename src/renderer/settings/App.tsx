import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'

const PLANNED_SETTINGS = [
  'Push-to-talk hotkey',
  'Whisper model location',
  'Start with Windows',
  'Overlay position and sound cues'
] as const

function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void window.murmur
      .getAppInfo()
      .then((info) => {
        if (active) {
          setAppInfo(info)
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="app">
      <header className="masthead">
        <div className="mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">Murmur</p>
          <h1>Settings</h1>
        </div>
      </header>

      <main className="panel">
        <h2>You&rsquo;re up and running</h2>
        <p>
          Murmur is living in your system tray. This window is a placeholder while the rest of the
          dictation pipeline is built.
        </p>
        <ul className="planned">
          {PLANNED_SETTINGS.map((setting) => (
            <li key={setting}>{setting}</li>
          ))}
        </ul>
      </main>

      <footer className="status" aria-live="polite">
        {error !== null ? (
          <span className="status-error">Could not read app info: {error}</span>
        ) : appInfo !== null ? (
          <span>
            Version {appInfo.version} · Electron {appInfo.electronVersion} · {appInfo.platform}
          </span>
        ) : (
          <span>Loading…</span>
        )}
      </footer>
    </div>
  )
}

export default App
