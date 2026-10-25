import { useCallback, useEffect, useRef, useState } from 'react'
import type { HotkeyBinding } from '@shared/hotkey'
import type { AppInfo, MicrophoneDevice, SettingsSnapshot } from '@shared/ipc'
import type { MurmurSettings, SettingsPatch } from '@shared/settings'
import HotkeyPicker from './components/HotkeyPicker'
import LevelMeter from './components/LevelMeter'
import Toggle from './components/Toggle'

interface ModelChoice {
  readonly file: string
  readonly sizeBytes: number | null
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}

function modelChoicesFor(snapshot: SettingsSnapshot): ModelChoice[] {
  const choices: ModelChoice[] = snapshot.models.map((model) => ({
    file: model.file,
    sizeBytes: model.sizeBytes
  }))
  const selected = snapshot.settings.modelPath ?? snapshot.defaultModelFile
  if (!choices.some((choice) => choice.file === selected)) {
    choices.unshift({ file: selected, sizeBytes: null })
  }
  return choices
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null)
  const [microphones, setMicrophones] = useState<readonly MicrophoneDevice[]>([])
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const noticeTimer = useRef<number | null>(null)

  useEffect(() => {
    let active = true

    void Promise.all([window.murmur.getSettings(), window.murmur.getAppInfo()])
      .then(([initial, info]) => {
        if (!active) {
          return
        }
        setSnapshot(initial)
        setMicrophones(initial.microphones)
        setAppInfo(info)
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(errorMessage(reason))
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const offSettings = window.murmur.onSettingsChanged((settings: MurmurSettings) => {
      setSnapshot((previous) => (previous === null ? previous : { ...previous, settings }))
    })
    const offDevices = window.murmur.onMicrophonesChanged((devices) => {
      setMicrophones(devices)
    })
    const offLevel = window.murmur.onMicLevel((value) => {
      setLevel(value)
    })
    const offError = window.murmur.onSettingsError((message) => {
      setError(message)
    })

    return () => {
      offSettings()
      offDevices()
      offLevel()
      offError()
    }
  }, [])

  useEffect(() => {
    return () => {
      // Closing the window must never leave the recorder streaming test levels.
      void window.murmur.stopMicTest()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current)
      }
    }
  }, [])

  const showNotice = useCallback((message: string): void => {
    setNotice(message)
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current)
    }
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null
      setNotice(null)
    }, 1800)
  }, [])

  const applyPatch = useCallback(
    async (patch: SettingsPatch): Promise<boolean> => {
      setSaving(true)
      setError(null)

      try {
        const result = await window.murmur.updateSettings(patch)
        if (!result.ok) {
          setError(result.message)
          return false
        }

        setSnapshot((previous) =>
          previous === null ? previous : { ...previous, settings: result.settings }
        )
        showNotice('Saved')
        return true
      } catch (reason) {
        setError(errorMessage(reason))
        return false
      } finally {
        setSaving(false)
      }
    },
    [showNotice]
  )

  const handleStartCapture = useCallback((): void => {
    setCapturing(true)
    setError(null)

    void window.murmur
      .captureHotkey()
      .then((binding: HotkeyBinding | null) => {
        if (binding === null) {
          showNotice('Hotkey unchanged')
          return
        }
        return applyPatch({
          hotkey: binding.key,
          hotkeyModifiers: binding.modifiers
        }).then(() => undefined)
      })
      .catch((reason: unknown) => {
        setError(errorMessage(reason))
      })
      .finally(() => {
        setCapturing(false)
      })
  }, [applyPatch, showNotice])

  const handleCancelCapture = useCallback((): void => {
    void window.murmur.cancelHotkeyCapture()
  }, [])

  const handleTestMicrophone = useCallback((): void => {
    if (testing) {
      setTesting(false)
      setLevel(0)
      void window.murmur.stopMicTest().catch((reason: unknown) => {
        setError(errorMessage(reason))
      })
      return
    }

    setTesting(true)
    setError(null)
    void window.murmur.startMicTest().catch((reason: unknown) => {
      setTesting(false)
      setError(errorMessage(reason))
    })
  }, [testing])

  if (snapshot === null) {
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
          {error !== null ? (
            <p className="status-error">Could not load settings: {error}</p>
          ) : (
            <p>Loading settings…</p>
          )}
        </main>
      </div>
    )
  }

  const { settings } = snapshot
  const selectedMicrophone = settings.microphoneId ?? ''
  const microphoneMissing =
    selectedMicrophone !== '' &&
    !microphones.some((device) => device.deviceId === selectedMicrophone)
  const modelChoices = modelChoicesFor(snapshot)
  const selectedModel = settings.modelPath ?? snapshot.defaultModelFile
  const hotkeyBinding: HotkeyBinding = {
    key: settings.hotkey,
    modifiers: settings.hotkeyModifiers
  }

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

      <main className="settings">
        <section className="card">
          <div className="card-heading">
            <h2>Dictation</h2>
            <p>How Murmur listens and inserts text.</p>
          </div>

          <div className="setting-row">
            <div className="setting-copy">
              <span className="setting-label">Push-to-talk hotkey</span>
              <span className="setting-hint">
                Hold this key anywhere in Windows, speak, then release.
              </span>
            </div>
            <HotkeyPicker
              binding={hotkeyBinding}
              capturing={capturing}
              disabled={saving}
              onStartCapture={handleStartCapture}
              onCancelCapture={handleCancelCapture}
            />
          </div>

          <Toggle
            label="Trailing space"
            description="Add one space after each transcript so back-to-back dictations do not run together."
            checked={settings.trailingSpace}
            onChange={(checked) => {
              void applyPatch({ trailingSpace: checked })
            }}
          />
        </section>

        <section className="card">
          <div className="card-heading">
            <h2>Text cleanup</h2>
            <p>Shape the transcript before Murmur pastes it.</p>
          </div>

          <Toggle
            label="Remove filler words"
            description="Drop sounds such as “um” and “uh”, including their longer spellings."
            checked={settings.removeFillerWords}
            disabled={capturing}
            onChange={(checked) => {
              void applyPatch({ removeFillerWords: checked })
            }}
          />

          <Toggle
            label="Spoken commands"
            description="Turn “new line”, “new paragraph”, “period”, “comma”, and “question mark” into punctuation and line breaks."
            checked={settings.spokenCommands}
            disabled={capturing}
            onChange={(checked) => {
              void applyPatch({ spokenCommands: checked })
            }}
          />
        </section>

        <section className="card">
          <div className="card-heading">
            <h2>Microphone</h2>
            <p>The input Murmur keeps warm between utterances.</p>
          </div>

          <div className="setting-row">
            <label className="setting-copy" htmlFor="microphone">
              <span className="setting-label">Input device</span>
              <span className="setting-hint">
                System default follows the device Windows currently uses.
              </span>
            </label>
            <select
              id="microphone"
              className="select"
              value={selectedMicrophone}
              disabled={capturing}
              onChange={(event) => {
                const value = event.target.value
                void applyPatch({ microphoneId: value === '' ? null : value })
              }}
            >
              <option value="">System default</option>
              {microphoneMissing ? (
                <option value={selectedMicrophone}>Selected microphone (not detected)</option>
              ) : null}
              {microphones.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-row test-row">
            <div className="setting-copy">
              <span className="setting-label">Test microphone</span>
              <span className="setting-hint">
                Speak normally and watch the meter. Changes to the input device apply immediately.
              </span>
            </div>
            <div className="test-controls">
              <button
                type="button"
                className={`button${testing ? ' button-active' : ''}`}
                onClick={handleTestMicrophone}
                disabled={capturing}
              >
                {testing ? 'Stop test' : 'Test microphone'}
              </button>
              <LevelMeter level={level} active={testing} />
              <span className="test-caption">
                {testing
                  ? 'Listening…'
                  : microphones.length === 0
                    ? 'No microphones found'
                    : 'Idle'}
              </span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-heading">
            <h2>Model &amp; language</h2>
            <p>Whisper runs locally on this machine.</p>
          </div>

          <div className="setting-row">
            <label className="setting-copy" htmlFor="model">
              <span className="setting-label">Whisper model</span>
              <span className="setting-hint">
                The `.bin` files found in Murmur&rsquo;s models folder.
              </span>
            </label>
            <select
              id="model"
              className="select"
              value={selectedModel}
              disabled={capturing || modelChoices.length === 0}
              onChange={(event) => {
                const value = event.target.value
                void applyPatch({
                  modelPath: value === snapshot.defaultModelFile ? null : value
                })
              }}
            >
              {modelChoices.map((choice) => (
                <option key={choice.file} value={choice.file}>
                  {choice.file}
                  {choice.sizeBytes === null
                    ? ' (not found)'
                    : ` — ${formatBytes(choice.sizeBytes)}`}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-row">
            <label className="setting-copy" htmlFor="language">
              <span className="setting-label">Language</span>
              <span className="setting-hint">
                Auto-detect works best with a multilingual model.
              </span>
            </label>
            <select
              id="language"
              className="select"
              value={settings.language}
              disabled={capturing}
              onChange={(event) => {
                const language = event.target.value
                void applyPatch({ language: language === 'auto' ? 'auto' : 'en' })
              }}
            >
              <option value="en">English</option>
              <option value="auto">Auto-detect</option>
            </select>
          </div>

          {settings.language === 'auto' ? (
            <p className="note">
              The bundled base.en model is English-only. Pick a multilingual model above to
              transcribe other languages.
            </p>
          ) : null}
        </section>

        <section className="card compact">
          <Toggle
            label="Start with Windows"
            description="Launch Murmur quietly in the system tray when you sign in."
            checked={settings.autostart}
            disabled={capturing}
            onChange={(checked) => {
              void applyPatch({ autostart: checked })
            }}
          />
        </section>
      </main>

      <footer className="status" aria-live="polite">
        {error !== null ? (
          <span className="status-error">{error}</span>
        ) : notice !== null ? (
          <span className="status-ok">{notice}</span>
        ) : saving ? (
          <span>Saving…</span>
        ) : appInfo !== null ? (
          <span>
            Murmur {appInfo.version} · Electron {appInfo.electronVersion} · Changes apply instantly
          </span>
        ) : (
          <span />
        )}
      </footer>
    </div>
  )
}

export default App
