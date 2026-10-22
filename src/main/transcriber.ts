import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { getResourcePath } from './app/paths'
import {
  runWhisper,
  TranscriptionError,
  type ActiveWhisperRun,
  type TranscriptionResult
} from './whisperRunner'

export { TranscriptionError } from './whisperRunner'
export type { TranscriptionErrorCode, TranscriptionResult } from './whisperRunner'

export interface TranscriberOptions {
  /** A path from settings.json, or `null` to use the bundled base.en model. */
  readonly modelPath: string | null
  /** `0` means auto: logical cores minus one, with a floor of two. */
  readonly threads: number
}

export interface Transcriber {
  /**
   * Queues one WAV for transcription. Utterances run strictly in call order,
   * one whisper-cli.exe at a time, and each gets its own snapshot file so the
   * next recording can overwrite last.wav immediately.
   */
  transcribe(wavPath: string): Promise<TranscriptionResult>
  /**
   * Kills a running whisper-cli.exe and rejects queued work. Resolves only
   * after every snapshot has been removed, so app shutdown can await it.
   */
  dispose(): Promise<void>
}

function resolveThreadCount(configured: number): number {
  if (Number.isFinite(configured) && configured > 0) {
    // The settings value is user-controlled; keep it inside a sane range so a
    // typo cannot make whisper spawn thousands of threads.
    return Math.min(Math.max(Math.floor(configured), 1), 64)
  }

  // Match docs/ARCHITECTURE.md §8: auto means logical cores minus one, min 2.
  return Math.max(2, availableParallelism() - 1)
}

function getBundledExecutablePath(): string {
  return getResourcePath('whisper', 'whisper-cli.exe')
}

function getBundledModelPath(): string {
  return getResourcePath('models', 'ggml-base.en.bin')
}

function getSnapshotPath(): string {
  // Windows: %TEMP% is per-user and resolved by Electron, so the snapshot path
  // never hardcodes a drive or username. The unique suffix keeps queued
  // utterances safe while the recorder overwrites last.wav.
  return join(app.getPath('temp'), 'murmur', `utterance-${randomUUID()}.wav`)
}

async function removeSnapshot(snapshotPath: string): Promise<void> {
  try {
    await rm(snapshotPath, { force: true })
  } catch (error) {
    // Leaving one temp file behind must never turn a successful transcript into
    // a failure; the problem is still visible in the log.
    console.error(`[murmur] could not remove temp WAV ${snapshotPath}`, error)
  }
}

async function snapshotUtterance(wavPath: string): Promise<string> {
  if (!existsSync(wavPath)) {
    throw new TranscriptionError(
      'snapshot-failed',
      `The recorded audio file was not found at ${wavPath}.`
    )
  }

  const snapshotPath = getSnapshotPath()
  try {
    await mkdir(dirname(snapshotPath), { recursive: true })
    await copyFile(wavPath, snapshotPath)
    return snapshotPath
  } catch (error) {
    await removeSnapshot(snapshotPath)
    throw new TranscriptionError(
      'snapshot-failed',
      `The recording could not be prepared for transcription: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function assertExecutable(executablePath: string): void {
  if (existsSync(executablePath)) {
    return
  }

  throw new TranscriptionError(
    'whisper-missing',
    `whisper-cli.exe is missing at ${executablePath}. See README.md for the Whisper download steps.`
  )
}

function assertModel(modelPath: string, isOverride: boolean): void {
  if (existsSync(modelPath)) {
    return
  }

  const guidance = isOverride
    ? 'Fix modelPath in settings.json or remove it to use the bundled model.'
    : 'Download ggml-base.en.bin into resources/models (see README.md).'
  throw new TranscriptionError(
    'model-missing',
    `The Whisper model is missing at ${modelPath}. ${guidance}`
  )
}

/**
 * Owns whisper.cpp's queue and file lifecycle: path resolution, a unique WAV
 * snapshot per utterance, the single-process FIFO queue, friendly resource
 * errors, and temp cleanup. One instance lives for the app lifetime; `dispose`
 * stops a run that is still in flight.
 */
export function createTranscriber(options: TranscriberOptions): Transcriber {
  const bundledExecutable = getBundledExecutablePath()
  const configuredModel = options.modelPath?.trim() ?? ''
  const isModelOverride = configuredModel !== ''
  const modelPath = isModelOverride ? resolve(configuredModel) : getBundledModelPath()
  const threads = resolveThreadCount(options.threads)

  let queue: Promise<void> = Promise.resolve()
  let activeRun: ActiveWhisperRun | null = null
  let disposed = false
  let disposePromise: Promise<void> | null = null

  function transcribe(wavPath: string): Promise<TranscriptionResult> {
    if (disposed) {
      return Promise.reject(
        new TranscriptionError(
          'cancelled',
          'Transcription was cancelled because Murmur is shutting down.'
        )
      )
    }

    // Copy the WAV as soon as the utterance arrives. The actual whisper run may
    // wait behind earlier utterances, while last.wav can already be replaced.
    const snapshot = snapshotUtterance(wavPath)
    // Mark the rejection as observed now; the queue may reach this item much
    // later, and Node treats an unobserved rejection as a crash-level warning.
    void snapshot.catch(() => undefined)

    const run = queue.then(async () => {
      const snapshotPath = await snapshot
      if (disposed) {
        await removeSnapshot(snapshotPath)
        throw new TranscriptionError(
          'cancelled',
          'Transcription was cancelled because Murmur is shutting down.'
        )
      }

      try {
        assertExecutable(bundledExecutable)
        assertModel(modelPath, isModelOverride)
        return await runWhisper(bundledExecutable, modelPath, snapshotPath, threads, (active) => {
          activeRun = active
        })
      } finally {
        await removeSnapshot(snapshotPath)
      }
    })

    // Keep the chain alive after failures so one bad utterance cannot block
    // every utterance spoken after it.
    queue = run.then(
      () => undefined,
      () => undefined
    )

    return run
  }

  function dispose(): Promise<void> {
    if (disposePromise !== null) {
      return disposePromise
    }

    disposed = true
    activeRun?.cancel()
    activeRun = null
    // The queue's tail includes the active run's `finally`, so waiting for it
    // means every snapshot is gone before the app process exits.
    disposePromise = queue.then(
      () => undefined,
      () => undefined
    )
    return disposePromise
  }

  return { transcribe, dispose }
}
