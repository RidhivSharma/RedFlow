import SettingRow from './SettingRow'
import Switch from './Switch'

interface ToggleProps {
  readonly label: string
  readonly description?: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}

/** A labelled settings row whose switch is a real checkbox underneath. */
function Toggle({
  label,
  description,
  checked,
  disabled = false,
  onChange
}: ToggleProps): React.JSX.Element {
  return (
    <SettingRow
      as="label"
      className={disabled ? 'toggle-row is-disabled' : 'toggle-row'}
      label={label}
      description={description}
    >
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </SettingRow>
  )
}

export default Toggle
