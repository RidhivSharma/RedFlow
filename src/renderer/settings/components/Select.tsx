import type { ReactNode } from 'react'
import { ChevronDownIcon } from './icons'

interface SelectProps {
  readonly id: string
  readonly value: string
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
  readonly children: ReactNode
}

/** A native select with its chevron drawn as a decorative inline SVG. */
function Select({
  id,
  value,
  disabled = false,
  onChange,
  children
}: SelectProps): React.JSX.Element {
  return (
    <span className="select-control">
      <select
        id={id}
        className="select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <span className="select-chevron" aria-hidden="true">
        <ChevronDownIcon size={16} />
      </span>
    </span>
  )
}

export default Select
