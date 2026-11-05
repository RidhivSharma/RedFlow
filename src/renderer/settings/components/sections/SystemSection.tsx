import Card from '../Card'
import SectionHeader from '../SectionHeader'
import Toggle from '../Toggle'
import { panelId, tabId } from '../../sections'

interface SystemSectionProps {
  readonly hidden: boolean
  readonly autostart: boolean
  readonly disabled: boolean
  readonly onAutostartChange: (checked: boolean) => void
}

function SystemSection({
  hidden,
  autostart,
  disabled,
  onAutostartChange
}: SystemSectionProps): React.JSX.Element {
  return (
    <section
      className="settings-panel"
      id={panelId('system')}
      role="tabpanel"
      aria-labelledby={tabId('system')}
      hidden={hidden}
    >
      <SectionHeader title="System" description="How Redflow behaves with Windows." />

      <Card>
        <Toggle
          label="Start with Windows"
          description="Launch Redflow quietly in the system tray when you sign in."
          checked={autostart}
          disabled={disabled}
          onChange={onAutostartChange}
        />
      </Card>
    </section>
  )
}

export default SystemSection
