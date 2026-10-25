import './styles.css'
import type { OverlayState, OverlayStatePayload } from '@shared/ipc'

const METER_SEGMENTS = 14

const LABELS: Readonly<Record<OverlayState, string>> = {
  idle: '',
  listening: 'Listening',
  transcribing: 'Transcribing\u2026',
  done: 'Inserted',
  notice: 'Copied',
  error: "Couldn't dictate"
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element === null) {
    throw new Error(`Murmur overlay: #${id} is missing from index.html`)
  }
  return element
}

const overlay = requireElement('overlay')
const label = requireElement('overlay-label')
const detail = requireElement('overlay-detail')
const meter = requireElement('overlay-meter')

const segments: HTMLElement[] = []
for (let index = 0; index < METER_SEGMENTS; index += 1) {
  const segment = document.createElement('span')
  segment.className = 'meter-segment'
  meter.append(segment)
  segments.push(segment)
}

let displayedLevel = 0

function setMeter(level: number): void {
  const lit = Math.round(level * METER_SEGMENTS)
  for (let index = 0; index < segments.length; index += 1) {
    segments[index]?.classList.toggle('lit', index < lit)
  }
}

function renderState(payload: OverlayStatePayload): void {
  overlay.dataset['state'] = payload.state
  label.textContent = LABELS[payload.state]
  detail.textContent =
    payload.state === 'error' || payload.state === 'notice'
      ? (payload.detail ?? 'Dictation finished with a notice.')
      : ''
  displayedLevel = 0
  setMeter(0)
  console.log(`[murmur overlay] state: ${payload.state}`)
}

/**
 * A 15 fps sample stream would look steppy, so the displayed level rises
 * immediately and falls with a little inertia. CSS transitions smooth the rest.
 */
function updateLevel(level: number): void {
  const target = Math.min(1, Math.max(0, level))
  displayedLevel = target >= displayedLevel ? target : displayedLevel * 0.55 + target * 0.45
  setMeter(displayedLevel)
}

window.murmurOverlay.onState(renderState)
window.murmurOverlay.onLevel((payload) => {
  if (overlay.dataset['state'] === 'listening') {
    updateLevel(payload.level)
  }
})

renderState({ state: 'idle' })
