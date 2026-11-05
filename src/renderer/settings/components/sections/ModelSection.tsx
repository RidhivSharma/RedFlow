import { formatBytes, type ModelChoice } from '../../settingsModels'
import SectionHeader from '../SectionHeader'
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
      <SectionHeader title="Model & language" description="Whisper runs locally on this machine." />

      <div className="card">
        <div className="setting-row">
          <label className="setting-copy" htmlFor="model">
            <span className="setting-label">Whisper model</span>
            <span className="setting-hint">
              The `.bin` files found in Redflow&rsquo;s models folder.
            </span>
          </label>
          <select
            id="model"
            className="select"
            value={selectedModel}
            disabled={capturing || modelChoices.length === 0}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {modelChoices.map((choice) => (
              <option key={choice.file} value={choice.file}>
                {choice.file}
                {choice.sizeBytes === null ? ' (not found)' : ` — ${formatBytes(choice.sizeBytes)}`}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <label className="setting-copy" htmlFor="language">
            <span className="setting-label">Language</span>
            <span className="setting-hint">Auto-detect works best with a multilingual model.</span>
          </label>
          <select
            id="language"
            className="select"
            value={language}
            disabled={capturing}
            onChange={(event) => onLanguageChange(event.target.value)}
          >
            <option value="en">English</option>
            <option value="auto">Auto-detect</option>
          </select>
        </div>

        {language === 'auto' ? (
          <p className="note">
            The bundled base.en model is English-only. Pick a multilingual model above to transcribe
            other languages.
          </p>
        ) : null}
      </div>
    </section>
  )
}

export default ModelSection
