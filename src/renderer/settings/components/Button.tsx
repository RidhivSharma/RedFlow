import type { ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps {
  readonly children: ReactNode
  readonly variant?: ButtonVariant
  readonly active?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}

function buttonClassName(variant: ButtonVariant, active: boolean): string {
  const variantClass =
    variant === 'primary' ? ' button-primary' : variant === 'ghost' ? ' button-ghost' : ''

  return `button${variantClass}${active ? ' button-active' : ''}`
}

/** Shared action button. Secondary is the default; primary is the filled variant. */
function Button({
  children,
  variant = 'secondary',
  active = false,
  disabled = false,
  onClick
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={buttonClassName(variant, active)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export default Button
