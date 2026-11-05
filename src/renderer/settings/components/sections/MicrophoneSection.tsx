import type { MicrophoneDevice } from '@shared/ipc'
import LevelMeter from '../LevelMeter'
import SectionHeader from '../SectionHeader'
import { panelId, tabId } from '../../sections'

interface MicrophoneSectionProps {
  readonly hidden: boolean
  readonly microphones: readonly MicrophoneDevice[]
  readonly selectedMicrophone: string
  readonly microphoneMissing: boolean
  readonly capturing: boolean
  readonly testing: boolean
  readonly level: number
  readonly onMicrophoneChange: (value: string) => void
  readonly onTestMicrophone: () => void
}

function MicrophoneSection({
  hidden,
  microphones,
  selectedMicrophone,
  microphoneMissing,
  capturing,
  testing,
  level,
  onMicrophoneChange,
  onTestMicrophone
}: MicrophoneSectionProps): React.JSX.Element {
  return (
    <section
      className="settings-panel"
      id={panelId('microphone')}
      role="tabpanel"
      aria-labelledby={tabId('microphone')}
      hidden={hidden}
    >
      <SectionHeader
        title="Microphone"
        description="The input Redflow keeps warm between utterances."
      />

      <div className="card">
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
            onChange={(event) => onMicrophoneChange(event.target.value)}
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
              onClick={onTestMicrophone}
              disabled={capturing}
            >
              {testing ? 'Stop test' : 'Test microphone'}
            </button>
            <LevelMeter level={level} active={testing} />
            <span className="test-caption">
              {testing ? 'Listening…' : microphones.length === 0 ? 'No microphones found' : 'Idle'}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

export default MicrophoneSection
