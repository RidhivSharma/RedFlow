import { RECORDER_BYTES_PER_SECOND, WAV_HEADER_BYTES, type Pcm16WavInfo } from '../shared/audio'

/**
 * Whole-utterance RMS below this value is treated as no speech at all, so
 * whisper is never spawned for silence. On the recorder's meter scale the
 * ambient noise floor is around -54 dBFS; this threshold is about -48 dBFS,
 * comfortably above it while still far below quiet speech.
 */
export const NEAR_SILENCE_RMS = 0.004
export const NEAR_SILENCE_DBFS = 20 * Math.log10(NEAR_SILENCE_RMS)

export interface SilenceAnalysis {
  /** Root-mean-square of the PCM samples normalized to 0–1. */
  readonly rms: number
  /** The same level in dBFS, clamped at -120 for completely silent audio. */
  readonly dbfs: number
  readonly nearlySilent: boolean
}

/**
 * Measures one validated 16 kHz mono 16-bit WAV. The header was already checked
 * by the recorder, so this only walks the PCM payload.
 */
export function analyzePcm16Wav(wav: ArrayBuffer, info: Pcm16WavInfo): SilenceAnalysis {
  const sampleCount = Math.floor(info.dataBytes / 2)
  if (sampleCount <= 0 || wav.byteLength < WAV_HEADER_BYTES + info.dataBytes) {
    return { rms: 0, dbfs: -120, nearlySilent: true }
  }

  const view = new DataView(wav)
  let sumOfSquares = 0
  const end = WAV_HEADER_BYTES + sampleCount * 2

  for (let offset = WAV_HEADER_BYTES; offset < end; offset += 2) {
    const sample = view.getInt16(offset, true) / 32768
    sumOfSquares += sample * sample
  }

  const rms = Math.sqrt(sumOfSquares / sampleCount)
  const dbfs = rms > 0 ? Math.max(-120, 20 * Math.log10(rms)) : -120
  return { rms, dbfs, nearlySilent: rms < NEAR_SILENCE_RMS }
}

/** Duration helper kept beside the analysis for consistent log messages. */
export function durationSeconds(info: Pcm16WavInfo): number {
  return info.dataBytes / RECORDER_BYTES_PER_SECOND
}
