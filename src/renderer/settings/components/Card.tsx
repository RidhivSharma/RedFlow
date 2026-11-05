import type { ReactNode } from 'react'

interface CardProps {
  readonly children: ReactNode
}

/** A grouped settings card: one surface with hairline dividers between rows. */
function Card({ children }: CardProps): React.JSX.Element {
  return <div className="card">{children}</div>
}

export default Card
