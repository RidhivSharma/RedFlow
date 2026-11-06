interface SectionHeaderProps {
  readonly title: string
  readonly description: string
  /** Optional static badge shown next to the section title. */
  readonly badge?: string
}

/** Title, optional badge, and description above a section's settings card. */
function SectionHeader({ title, description, badge }: SectionHeaderProps): React.JSX.Element {
  return (
    <header className="section-header">
      <div className="section-heading">
        <h2>{title}</h2>
        {badge !== undefined ? <span className="section-badge">{badge}</span> : null}
      </div>
      <p>{description}</p>
    </header>
  )
}

export default SectionHeader
