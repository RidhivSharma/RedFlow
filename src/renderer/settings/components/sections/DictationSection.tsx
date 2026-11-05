import type { HotkeyBinding } from '@shared/hotkey'
import HotkeyPicker from '../HotkeyPicker'
import SectionHeader from '../SectionHeader'
import Toggle from '../Toggle'
import { panelId, tabId } from '../../sections'

interface DictationSectionProps {
  readonly hidden: boolean
  readonly hotkeyBinding: HotkeyBinding
  readonly capturing: boolean
  readonly saving: boolean
  readonly trailingSpace: boolean
  readonly onStartCapture: () => void
  readonly onCancelCapture: () => void
  readonly onTrailingSpaceChange: (checked: boolean) => void
}

function DictationSection({
  hidden,
  hotkeyBinding,
  capturing,
  saving,
  trailingSpace,
  onStartCapture,
  onCancelCapture,
  onTrailingSpaceChange
}: DictationSectionProps): React.JSX.Element {
  return (
    <section
      className="settings-panel"
      id={panelId('dictation')}
      role="tabpanel"
      aria-labelledby={tabId('dictation')}
      hidden={hidden}
    >
      <SectionHeader title="Dictation" description="How Redflow listens and inserts text." />

      <div className="card">
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
            onStartCapture={onStartCapture}
            onCancelCapture={onCancelCapture}
          />
        </div>

        <Toggle
          label="Trailing space"
          description="Add one space after each transcript so back-to-back dictations do not run together."
          checked={trailingSpace}
          onChange={onTrailingSpaceChange}
        />
      </div>
    </section>
  )
}

export default DictationSection
