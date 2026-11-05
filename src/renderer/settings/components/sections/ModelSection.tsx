import { formatBytes, type ModelChoice } from '../../settingsModels'
import Card from '../Card'
import SectionHeader from '../SectionHeader'
import Select from '../Select'
import SettingRow from '../SettingRow'
import { panelId, tabId } from '../../sections'

interface ModelSectionProps {
  readonly hidden: boolean
  readonly modelChoices: readonly ModelChoice[]
  readonly selectedModel: string
  readonly language: string
  readonly capturing: boolean
  readonly onModelChange: (value: string) => void
  readonly onLanguageChange: (value: string) => void
}

function ModelSection({
  hidden,
  modelChoices,
  selectedModel,
  language,
  capturing,
  onModelChange,
  onLanguageChange
}: ModelSectionProps): React.JSX.Element {
  return (
    <section
      className="settings-panel"
      id={panelId('model')}
      role="tabpanel"
      aria-labelledby={tabId('model')}
      hidden={hidden}
    >
      <SectionHeader
        title="Model & language"
        description="Speech recognition runs locally on this PC."
      />

      <Card>
        <SettingRow
          label="Whisper model"
          description="The .bin files found in Redflow's models folder."
          htmlFor="model"
        >
          <Select
            id="model"
            value={selectedModel}
            disabled={capturing || modelChoices.length === 0}
            onChange={onModelChange}
          >
            {modelChoices.map((choice) => (
              <option key={choice.file} value={choice.file}>
                {choice.file}
                {choice.sizeBytes === null ? ' (not found)' : ` — ${formatBytes(choice.sizeBytes)}`}
              </option>
            ))}
          </Select>
        </SettingRow>

        <SettingRow
          label="Language"
          description="Auto-detect works best with a multilingual model."
          htmlFor="language"
        >
          <Select id="language" value={language} disabled={capturing} onChange={onLanguageChange}>
            <option value="en">English</option>
            <option value="auto">Auto-detect</option>
          </Select>
        </SettingRow>

        {language === 'auto' ? (
          <p className="note">
            The bundled base.en model is English-only. Pick a multilingual model above to transcribe
            other languages.
          </p>
        ) : null}
      </Card>
    </section>
  )
}

export default ModelSection
