interface SwitchProps {
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}

/** A real checkbox drawn as a switch, with a visible On/Off state label. */
function Switch({ checked, disabled = false, onChange }: SwitchProps): React.JSX.Element {
  return (
    <span className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-state" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
    </span>
  )
}

export default Switch
