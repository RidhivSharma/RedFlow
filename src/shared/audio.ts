/**
 * The recorder's canonical audio format, shared by the hidden renderer (which
 * encodes the WAV) and the main process (which validates it before writing it
 * to disk). Keeping the numbers in one place means the header and the checks
 * can never drift apart.
 */
export const RECORDER_SAMPLE_RATE = 16000
export const RECORDER_CHANNEL_COUNT = 1
export const RECORDER_BITS_PER_SAMPLE = 16
export const RECORDER_BLOCK_ALIGN = (RECORDER_CHANNEL_COUNT * RECORDER_BITS_PER_SAMPLE) / 8
export const RECORDER_BYTES_PER_SECOND = RECORDER_SAMPLE_RATE * RECORDER_BLOCK_ALIGN
export const WAV_HEADER_BYTES = 44

/** Hard safety cap for one utterance, independent of the settings file. */
export const RECORDER_MAX_UTTERANCE_MS = 120_000

export interface Pcm16WavInfo {
  readonly sampleRate: number
  readonly channels: number
  readonly bitsPerSample: number
  readonly dataBytes: number
  readonly durationMs: number
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let text = ''
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index))
  }
  return text
}

/**
 * Wraps mono Int16 samples in a 44-byte RIFF/WAVE header. Every chunk is a
 * consecutive slice of the utterance, so their lengths add up to the frame
 * count.
 */
export function encodePcm16Wav(chunks: readonly Int16Array[]): ArrayBuffer {
  let frames = 0
  for (const chunk of chunks) {
    frames += chunk.length
  }

  const dataBytes = frames * RECORDER_BLOCK_ALIGN
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, RECORDER_CHANNEL_COUNT, true)
  view.setUint32(24, RECORDER_SAMPLE_RATE, true)
  view.setUint32(28, RECORDER_BYTES_PER_SECOND, true)
  view.setUint16(32, RECORDER_BLOCK_ALIGN, true)
  view.setUint16(34, RECORDER_BITS_PER_SAMPLE, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = WAV_HEADER_BYTES
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(offset, sample, true)
      offset += 2
    }
  }

  return buffer
}

/**
 * Verifies that a buffer is exactly the WAV Murmur's recorder promised:
 * 44-byte canonical header, PCM, 16 kHz, mono, 16-bit, uncompressed. Returns
 * `null` for anything else so the main process never writes a malformed file.
 */
export function readPcm16WavInfo(wav: ArrayBuffer): Pcm16WavInfo | null {
  if (wav.byteLength < WAV_HEADER_BYTES) {
    return null
  }

  const view = new DataView(wav)
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    return null
  }

  if (readAscii(view, 12, 4) !== 'fmt ') {
    return null
  }

  const formatSize = view.getUint32(16, true)
  const audioFormat = view.getUint16(20, true)
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const byteRate = view.getUint32(28, true)
  const blockAlign = view.getUint16(32, true)
  const bitsPerSample = view.getUint16(34, true)

  if (
    formatSize !== 16 ||
    audioFormat !== 1 ||
    channels !== RECORDER_CHANNEL_COUNT ||
    sampleRate !== RECORDER_SAMPLE_RATE ||
    byteRate !== RECORDER_BYTES_PER_SECOND ||
    blockAlign !== RECORDER_BLOCK_ALIGN ||
    bitsPerSample !== RECORDER_BITS_PER_SAMPLE
  ) {
    return null
  }

  if (readAscii(view, 36, 4) !== 'data') {
    return null
  }

  const dataBytes = view.getUint32(40, true)
  if (dataBytes % RECORDER_BLOCK_ALIGN !== 0) {
    return null
  }

  if (dataBytes !== wav.byteLength - WAV_HEADER_BYTES) {
    return null
  }

  if (view.getUint32(4, true) !== 36 + dataBytes) {
    return null
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationMs: (dataBytes / RECORDER_BYTES_PER_SECOND) * 1000
  }
}
