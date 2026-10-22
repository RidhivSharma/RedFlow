interface ToggleProps {
  readonly label: string
  readonly description?: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}

/** A checkbox styled as a Windows-friendly switch, wrapped in its label. */
function Toggle({
  label,
  description,
  checked,
  disabled = false,
  onChange
}: ToggleProps): React.JSX.Element {
  return (
    <label className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span className="setting-copy">
        <span className="setting-label">{label}</span>
        {description !== undefined ? <span className="setting-hint">{description}</span> : null}
      </span>
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
      </span>
    </label>
  )
}

export default Toggle
