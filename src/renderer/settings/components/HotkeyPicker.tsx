import type { HotkeyBinding } from '@shared/hotkey'

interface HotkeyPickerProps {
  readonly binding: HotkeyBinding
  readonly capturing: boolean
  readonly disabled: boolean
  readonly onStartCapture: () => void
  readonly onCancelCapture: () => void
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  PrintScreen: 'PrtSc',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num ×',
  NumpadDivide: 'Num ÷',
  NumpadDecimal: 'Num .'
}

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key
}

/**
 * Shows the current push-to-talk binding as keycaps. Clicking Change suspends
 * the global listener in main and captures the next key or modifier combo.
 */
function HotkeyPicker({
  binding,
  capturing,
  disabled,
  onStartCapture,
  onCancelCapture
}: HotkeyPickerProps): React.JSX.Element {
  const parts = [...binding.modifiers, binding.key]

  return (
    <div className={`hotkey-picker${capturing ? ' is-capturing' : ''}`}>
      <div className="hotkey-keys" aria-live="polite">
        {parts.map((part, index) => (
          <span key={`${part}-${index}`} className="keycap">
            {keyLabel(part)}
          </span>
        ))}
      </div>

      {capturing ? (
        <div className="capture-actions">
          <span className="capture-hint">Press a key or combo…</span>
          <button type="button" className="button button-ghost" onClick={onCancelCapture}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="button" onClick={onStartCapture} disabled={disabled}>
          Change
        </button>
      )}
    </div>
  )
}

export default HotkeyPicker
