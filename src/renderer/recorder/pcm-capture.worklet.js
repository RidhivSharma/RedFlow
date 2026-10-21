/* global AudioWorkletProcessor, registerProcessor */

/**
 * Murmur's capture worklet.
 *
 * The AudioContext is created at 16 kHz, so `process` already receives
 * 16 kHz mono float samples (the node is configured with channelCount 1).
 * This processor converts them to signed 16-bit PCM and posts 100 ms chunks
 * to the renderer. Capturing is gated by messages from the renderer so the
 * microphone stream and the audio graph can stay warm between utterances:
 * key-down only flips a flag, which is what keeps the first word intact.
 *
 * This file is loaded with Vite's `?raw` import and installed as a Blob URL,
 * so it must stay plain JavaScript (it is never transpiled).
 */

const DEFAULT_CHUNK_FRAMES = 1600 // 100 ms at 16 kHz
const INT16_MAX = 0x7fff
const INT16_NEGATIVE_SCALE = 0x8000

class MurmurPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()

    const processorOptions = options?.processorOptions ?? {}
    const requestedChunkFrames = Number(processorOptions.chunkFrames)
    this.chunkFrames =
      Number.isInteger(requestedChunkFrames) && requestedChunkFrames > 0
        ? requestedChunkFrames
        : DEFAULT_CHUNK_FRAMES

    this.capturing = false
    this.maxFrames = 0
    this.framesWritten = 0
    this.chunk = new Int16Array(this.chunkFrames)
    this.chunkOffset = 0
    this.endedPosted = false

    this.port.onmessage = (event) => this.handleMessage(event.data)
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return
    }

    if (message.type === 'start') {
      const requestedMaxFrames = Number(message.maxFrames)
      this.maxFrames =
        Number.isFinite(requestedMaxFrames) && requestedMaxFrames > 0
          ? Math.floor(requestedMaxFrames)
          : 0
      this.framesWritten = 0
      this.chunk = new Int16Array(this.chunkFrames)
      this.chunkOffset = 0
      this.endedPosted = false
      this.capturing = this.maxFrames > 0
      return
    }

    if (message.type === 'stop') {
      if (!this.capturing) {
        return
      }

      this.capturing = false
      this.flushChunk()
      this.postEnded(false)
      return
    }

    if (message.type === 'cancel') {
      this.capturing = false
      this.framesWritten = 0
      this.chunkOffset = 0
      this.chunk = new Int16Array(this.chunkFrames)
      this.endedPosted = false
    }
  }

  process(inputs) {
    if (!this.capturing) {
      return true
    }

    const input = inputs[0]
    const channel = input && input.length > 0 ? input[0] : undefined
    if (!channel) {
      return true
    }

    let index = 0
    while (index < channel.length && this.capturing) {
      const remainingFrames = this.maxFrames - this.framesWritten
      if (remainingFrames <= 0) {
        this.finishAtCap()
        break
      }

      const available = Math.min(channel.length - index, remainingFrames)
      for (let offset = 0; offset < available; offset += 1) {
        const sample = channel[index + offset]
        const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
        this.chunk[this.chunkOffset] =
          clamped < 0 ? clamped * INT16_NEGATIVE_SCALE : clamped * INT16_MAX
        this.chunkOffset += 1
        this.framesWritten += 1

        if (this.chunkOffset >= this.chunkFrames) {
          this.flushChunk()
        }
      }

      index += available

      if (this.framesWritten >= this.maxFrames) {
        this.finishAtCap()
      }
    }

    return true
  }

  finishAtCap() {
    if (!this.capturing) {
      return
    }

    this.capturing = false
    this.flushChunk()
    this.postEnded(true)
  }

  flushChunk() {
    if (this.chunkOffset === 0) {
      return
    }

    const samples = this.chunk.slice(0, this.chunkOffset)
    this.chunk = new Int16Array(this.chunkFrames)
    this.chunkOffset = 0
    this.port.postMessage({ type: 'chunk', samples: samples.buffer }, [samples.buffer])
  }

  postEnded(capReached) {
    if (this.endedPosted) {
      return
    }

    this.endedPosted = true
    this.port.postMessage({
      type: 'ended',
      frames: this.framesWritten,
      capReached
    })
  }
}

registerProcessor('murmur-pcm-capture', MurmurPcmCaptureProcessor)
