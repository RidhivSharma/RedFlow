import type { MicrophoneDevice } from '@shared/ipc'
import Button from '../Button'
import Card from '../Card'
import LevelMeter from '../LevelMeter'
import SectionHeader from '../SectionHeader'
import Select from '../Select'
import SettingRow from '../SettingRow'
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
        description="Choose and test the input Redflow listens to."
      />

      <Card>
        <SettingRow
          label="Input device"
          description="System default follows the device Windows currently uses."
          htmlFor="microphone"
        >
          <Select
            id="microphone"
            value={selectedMicrophone}
            disabled={capturing}
            onChange={onMicrophoneChange}
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
          </Select>
        </SettingRow>

        <SettingRow
          className="test-row"
          label="Test microphone"
          description="Speak normally and watch the meter. Input device changes apply immediately."
        >
          <div className="test-controls">
            <Button active={testing} onClick={onTestMicrophone} disabled={capturing}>
              {testing ? 'Stop test' : 'Test microphone'}
            </Button>
            <LevelMeter level={level} active={testing} />
            <span className={`test-status${testing ? ' is-active' : ''}`}>
              <span className="test-status-dot" aria-hidden="true" />
              <span>
                {testing
                  ? 'Listening…'
                  : microphones.length === 0
                    ? 'No microphones found'
                    : 'Idle'}
              </span>
            </span>
          </div>
        </SettingRow>
      </Card>
    </section>
  )
}

export default MicrophoneSection
