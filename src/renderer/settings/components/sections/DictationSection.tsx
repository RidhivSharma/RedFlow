import type { HotkeyBinding } from '@shared/hotkey'
import Card from '../Card'
import HotkeyPicker from '../HotkeyPicker'
import SectionHeader from '../SectionHeader'
import SettingRow from '../SettingRow'
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
      <SectionHeader title="Dictation" description="How Redflow listens and inserts your words." />

      <Card>
        <SettingRow
          label="Push-to-talk hotkey"
          description="Hold this key anywhere in Windows, speak, then release to insert your words."
        >
          <HotkeyPicker
            binding={hotkeyBinding}
            capturing={capturing}
            disabled={saving}
            onStartCapture={onStartCapture}
            onCancelCapture={onCancelCapture}
          />
        </SettingRow>

        <Toggle
          label="Trailing space"
          description="Adds one space after each dictation so back-to-back phrases don't run together."
          checked={trailingSpace}
          onChange={onTrailingSpaceChange}
        />
      </Card>
    </section>
  )
}

export default DictationSection
