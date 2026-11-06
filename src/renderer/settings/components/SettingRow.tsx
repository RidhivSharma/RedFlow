import type { ReactNode } from 'react'

interface SettingRowProps {
  readonly label: string
  readonly description?: string
  /** Associates the text column with a form control such as a select. */
  readonly htmlFor?: string
  /** Render the row itself as a label, so the whole row toggles its control. */
  readonly as?: 'div' | 'label'
  readonly className?: string
  readonly children: ReactNode
}

/**
 * The shared two-column row: label and description on the left, the control on
 * the right. The text column never takes less than half of the row.
 */
function SettingRow({
  label,
  description,
  htmlFor,
  as = 'div',
  className,
  children
}: SettingRowProps): React.JSX.Element {
  const rowClassName = className === undefined ? 'setting-row' : `setting-row ${className}`
  const copy = (
    <>
      <span className="setting-label">{label}</span>
      {description !== undefined ? <span className="setting-hint">{description}</span> : null}
    </>
  )

  if (as === 'label') {
    return (
      <label className={rowClassName} htmlFor={htmlFor}>
        <span className="setting-copy">{copy}</span>
        {children}
      </label>
    )
  }

  if (htmlFor !== undefined) {
    return (
      <div className={rowClassName}>
        <label className="setting-copy" htmlFor={htmlFor}>
          {copy}
        </label>
        {children}
      </div>
    )
  }

  return (
    <div className={rowClassName}>
      <span className="setting-copy">{copy}</span>
      {children}
    </div>
  )
}

export default SettingRow
