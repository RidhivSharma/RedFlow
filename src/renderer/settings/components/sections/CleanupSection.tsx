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
        description="Shape the transcript before Redflow pastes it."
      />

      <div className="card">
        <Toggle
          label="Remove filler words"
          description="Drop sounds such as “um” and “uh”, including their longer spellings."
          checked={removeFillerWords}
          disabled={disabled}
          onChange={onRemoveFillerWordsChange}
        />

        <Toggle
          label="Spoken commands"
          description="Turn “new line”, “new paragraph”, “period”, “comma”, and “question mark” into punctuation and line breaks."
          checked={spokenCommands}
          disabled={disabled}
          onChange={onSpokenCommandsChange}
        />
      </div>
    </section>
  )
}

export default CleanupSection
