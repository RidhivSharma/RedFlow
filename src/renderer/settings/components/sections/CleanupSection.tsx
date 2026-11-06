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

const SPOKEN_COMMAND_EXAMPLES = [
  'new line',
  'new paragraph',
  'period',
  'comma',
  'question mark'
] as const

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

        <ul className="example-chips" aria-label="Spoken command examples">
          {SPOKEN_COMMAND_EXAMPLES.map((phrase) => (
            <li key={phrase} className="example-chip">
              “{phrase}”
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

export default CleanupSection
