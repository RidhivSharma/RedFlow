import type { ReactNode } from 'react'

interface IconProps {
  readonly size?: number
}

interface IconFrameProps extends IconProps {
  readonly children: ReactNode
}

const DEFAULT_ICON_SIZE = 18

function IconFrame({ size = DEFAULT_ICON_SIZE, children }: IconFrameProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function KeyboardIcon({ size }: IconProps): React.JSX.Element {
  return (
    <IconFrame size={size}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01" />
      <path d="M10 14h4" />
    </IconFrame>
  )
}

export function SparkleIcon({ size }: IconProps): React.JSX.Element {
  return (
    <IconFrame size={size}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    </IconFrame>
  )
}

export function MicrophoneIcon({ size }: IconProps): React.JSX.Element {
  return (
    <IconFrame size={size}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3M8 22h8" />
    </IconFrame>
  )
}

export function ChipIcon({ size }: IconProps): React.JSX.Element {
  return (
    <IconFrame size={size}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </IconFrame>
  )
}

export function PowerIcon({ size }: IconProps): React.JSX.Element {
  return (
    <IconFrame size={size}>
      <path d="M12 3v9" />
      <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />
    </IconFrame>
  )
}

export function ChevronDownIcon({ size }: IconProps): React.JSX.Element {
  return (
    <IconFrame size={size}>
      <path d="m6 9 6 6 6-6" />
    </IconFrame>
  )
}
