interface SettingsStatusProps {
  readonly error: string | null
  readonly notice: string | null
  readonly saving: boolean
}

/** Live status line below the active section. */
function SettingsStatus({ error, notice, saving }: SettingsStatusProps): React.JSX.Element {
  return (
    <footer className="content-status" aria-live="polite">
      {error !== null ? (
        <span className="status-error">{error}</span>
      ) : notice !== null ? (
        <span className="status-ok">{notice}</span>
      ) : saving ? (
        <span>Saving…</span>
      ) : (
        <span />
      )}
    </footer>
  )
}

export default SettingsStatus
