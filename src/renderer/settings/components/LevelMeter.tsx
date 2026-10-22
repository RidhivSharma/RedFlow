interface LevelMeterProps {
  /** Normalized 0–1 microphone level from the recorder renderer. */
  readonly level: number
  readonly active: boolean
}

const BAR_COUNT = 20

/** Segmented input meter used by the settings window's Test microphone button. */
function LevelMeter({ level, active }: LevelMeterProps): React.JSX.Element {
  const litBars = active ? Math.round(Math.min(1, Math.max(0, level)) * BAR_COUNT) : 0

  return (
    <div
      className={`level-meter${active ? ' is-active' : ''}`}
      role="meter"
      aria-label="Microphone input level"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={active ? level : 0}
    >
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span
          key={index}
          className={`level-bar${index < litBars ? ' is-lit' : ''}`}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

export default LevelMeter
