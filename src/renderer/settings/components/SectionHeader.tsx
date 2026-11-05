interface SectionHeaderProps {
  readonly title: string
  readonly description: string
}

/** Title and description above a section's settings card. */
function SectionHeader({ title, description }: SectionHeaderProps): React.JSX.Element {
  return (
    <header className="section-header">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  )
}

export default SectionHeader
