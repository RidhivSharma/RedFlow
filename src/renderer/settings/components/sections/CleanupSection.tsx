import Card from '../Card'
import SectionHeader from '../SectionHeader'
import Toggle from '../Toggle'
import { panelId, tabId } from '../../sections'

interface CleanupSectionProps {
  readonly hidden: boolean
  readonly removeFillerWords: boolean
  readonly spokenCommands: boolean
  readonly disabled: boolean
  readonly onRemoveFillerWordsChange: (checked: boolean) => void
  readonly onSpokenCommandsChange: (checked: boolean) => void
}

function CleanupSection({
  hidden,
  removeFillerWords,
  spokenCommands,
  disabled,
  onRemoveFillerWordsChange,
  onSpokenCommandsChange
}: CleanupSectionProps): React.JSX.Element {
  return (
    <section
      className="settings-panel"
      id={panelId('cleanup')}
      role="tabpanel"
      aria-labelledby={tabId('cleanup')}
      hidden={hidden}
    >
      <SectionHeader
        title="Text cleanup"
        description="Tidy the transcript before it is inserted."
      />

      <Card>
        <Toggle
          label="Remove filler words"
          description="Drops sounds like “um” and “uh”, including their longer spellings."
          checked={removeFillerWords}
          disabled={disabled}
          onChange={onRemoveFillerWordsChange}
        />

        <Toggle
          label="Spoken commands"
          description="Say “new line”, “new paragraph”, “period”, “comma” or “question mark” to insert line breaks and punctuation."
          checked={spokenCommands}
          disabled={disabled}
          onChange={onSpokenCommandsChange}
        />
      </Card>
    </section>
  )
}

export default CleanupSection
