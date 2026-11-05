import { useCallback, useEffect, useRef, useState } from 'react'
import type { HotkeyBinding } from '@shared/hotkey'
import type { AppInfo, MicrophoneDevice, SettingsSnapshot } from '@shared/ipc'
import type { MurmurSettings, SettingsPatch } from '@shared/settings'
import Sidebar from './components/Sidebar'
import SettingsStatus from './components/SettingsStatus'
import CleanupSection from './components/sections/CleanupSection'
import DictationSection from './components/sections/DictationSection'
import MicrophoneSection from './components/sections/MicrophoneSection'
import ModelSection from './components/sections/ModelSection'
import SystemSection from './components/sections/SystemSection'
import { modelChoicesFor } from './settingsModels'
import type { SectionId } from './sections'

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
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
  const [activeSection, setActiveSection] = useState<SectionId>('dictation')
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
      <div className="app-shell">
        <Sidebar activeSection={activeSection} onSelect={setActiveSection} appInfo={appInfo} />

        <main className="content-pane">
          <div className="content">
            <div className="panel">
              {error !== null ? (
                <p className="status-error">Could not load settings: {error}</p>
              ) : (
                <p>Loading settings…</p>
              )}
            </div>
          </div>
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
    <div className="app-shell">
      <Sidebar activeSection={activeSection} onSelect={setActiveSection} appInfo={appInfo} />

      <main className="content-pane">
        <div className="content">
          <DictationSection
            hidden={activeSection !== 'dictation'}
            hotkeyBinding={hotkeyBinding}
            capturing={capturing}
            saving={saving}
            trailingSpace={settings.trailingSpace}
            onStartCapture={handleStartCapture}
            onCancelCapture={handleCancelCapture}
            onTrailingSpaceChange={(checked) => {
              void applyPatch({ trailingSpace: checked })
            }}
          />

          <CleanupSection
            hidden={activeSection !== 'cleanup'}
            removeFillerWords={settings.removeFillerWords}
            spokenCommands={settings.spokenCommands}
            disabled={capturing}
            onRemoveFillerWordsChange={(checked) => {
              void applyPatch({ removeFillerWords: checked })
            }}
            onSpokenCommandsChange={(checked) => {
              void applyPatch({ spokenCommands: checked })
            }}
          />

          <MicrophoneSection
            hidden={activeSection !== 'microphone'}
            microphones={microphones}
            selectedMicrophone={selectedMicrophone}
            microphoneMissing={microphoneMissing}
            capturing={capturing}
            testing={testing}
            level={level}
            onMicrophoneChange={(value) => {
              void applyPatch({ microphoneId: value === '' ? null : value })
            }}
            onTestMicrophone={handleTestMicrophone}
          />

          <ModelSection
            hidden={activeSection !== 'model'}
            modelChoices={modelChoices}
            selectedModel={selectedModel}
            language={settings.language}
            capturing={capturing}
            onModelChange={(value) => {
              void applyPatch({
                modelPath: value === snapshot.defaultModelFile ? null : value
              })
            }}
            onLanguageChange={(value) => {
              void applyPatch({ language: value === 'auto' ? 'auto' : 'en' })
            }}
          />

          <SystemSection
            hidden={activeSection !== 'system'}
            autostart={settings.autostart}
            disabled={capturing}
            onAutostartChange={(checked) => {
              void applyPatch({ autostart: checked })
            }}
          />

          <SettingsStatus error={error} notice={notice} saving={saving} />
        </div>
      </main>
    </div>
  )
}

export default App
