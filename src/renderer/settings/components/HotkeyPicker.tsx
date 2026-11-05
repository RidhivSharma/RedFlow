import type { HotkeyBinding } from '@shared/hotkey'
import Button from './Button'
import Keycap from './Keycap'

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
        {capturing ? (
          <span className="capture-prompt">Press a key…</span>
        ) : (
          parts.map((part, index) => <Keycap key={`${part}-${index}`}>{keyLabel(part)}</Keycap>)
        )}
      </div>

      {capturing ? (
        <div className="capture-actions">
          <Button variant="ghost" onClick={onCancelCapture}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button onClick={onStartCapture} disabled={disabled}>
          Change
        </Button>
      )}
    </div>
  )
}

export default HotkeyPicker
