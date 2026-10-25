import type { CaptureErrorCode } from '../shared/ipc'
import { InsertionError, type InsertionErrorCode } from './insertionError'
import { TranscriptionError, type TranscriptionErrorCode } from './whisperRunner'

/**
 * One calm sentence for the overlay and tray. Technical details stay in the log;
 * these strings are deliberately short enough to fit the two-line pill.
 */
export const NO_SPEECH_MESSAGE =
  'No speech detected. Hold the key, speak a little louder, then release.'

const CAPTURE_MESSAGES: Readonly<Record<CaptureErrorCode, string>> = {
  'permission-denied':
    'Microphone access is blocked. Allow desktop apps in Windows Settings > Privacy & security > Microphone.',
  'no-device': 'No microphone was found. Connect one, or choose another input in Murmur Settings.',
  'device-busy':
    'The microphone is in use by another app. Close it, or choose another input in Murmur Settings.',
  'capture-failed':
    'The microphone could not start. Check Windows microphone privacy, then try again.',
  'no-audio': 'No audio was captured. Check the microphone and Windows privacy settings.',
  unknown: 'The microphone ran into a problem. Try again, or restart Murmur.'
}

const TRANSCRIPTION_MESSAGES: Readonly<Record<TranscriptionErrorCode, string>> = {
  'whisper-missing':
    "Murmur's speech engine is missing. Reinstall Murmur or restore whisper-cli.exe.",
  'model-missing': 'The Whisper model is missing. Reinstall Murmur or restore the model file.',
  'snapshot-failed': 'The recording could not be prepared. Try dictating again.',
  'spawn-failed': 'The speech engine could not start. Restart Murmur and try again.',
  timeout: 'Transcription took too long. Try a shorter utterance, or restart Murmur.',
  'exit-failed': 'Transcription failed. Try again, and check the Murmur log if it keeps happening.',
  empty: 'No speech was recognized. Hold the key and speak clearly, then try again.',
  cancelled: 'Dictation was cancelled because Murmur is shutting down.'
}

const INSERTION_MESSAGES: Readonly<Record<InsertionErrorCode, string>> = {
  'empty-text': 'There was no text to insert. Try dictating again.',
  'modifiers-held': 'Release the hotkey keys before Murmur pastes the text.',
  'own-window-focused': "Murmur's own window has focus, so the text was not pasted.",
  'clipboard-failed': 'The transcribed text could not be copied to the clipboard.',
  'paste-failed':
    'The text could not be pasted. Apps running as administrator can block simulated input.',
  'restore-failed': 'The text was inserted, but the previous clipboard could not be restored.',
  cancelled: 'The text was not inserted because Murmur is shutting down.'
}

export function friendlyCaptureError(code: CaptureErrorCode): string {
  return CAPTURE_MESSAGES[code]
}

/** Maps a failed transcription/insertion to the friendly overlay message. */
export function friendlyDictationError(error: unknown): string {
  if (error instanceof TranscriptionError) {
    return TRANSCRIPTION_MESSAGES[error.code]
  }
  if (error instanceof InsertionError) {
    return INSERTION_MESSAGES[error.code]
  }
  return 'Dictation failed. Check the Murmur log for details.'
}
