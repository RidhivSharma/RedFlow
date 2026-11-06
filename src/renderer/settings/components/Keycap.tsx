import type { ReactNode } from 'react'

interface KeycapProps {
  readonly children: ReactNode
}

/** One physical key in a hotkey binding. */
function Keycap({ children }: KeycapProps): React.JSX.Element {
  return <span className="keycap">{children}</span>
}

export default Keycap
