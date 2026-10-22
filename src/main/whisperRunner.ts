import { spawn } from 'node:child_process'
import type { WhisperLanguage } from '../shared/settings'

/** One whisper-cli run must finish within this window or it is killed. */
const TRANSCRIBE_TIMEOUT_MS = 60_000
const MAX_CAPTURED_OUTPUT = 256 * 1024
const MAX_ERROR_DETAIL = 400

// Built dynamically so the source contains no literal control character (ESC).
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g')
const TIMESTAMP = /\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}\]\s*/g

/**
 * whisper.cpp normally writes its diagnostics to stderr, but a different build
 * can leak them to stdout. These prefixes are never part of a transcript.
 */
const NOISE_LINE_PREFIXES = [
  'read_audio_data:',
  'whisper_',
  'ggml_',
  'main:',
  'system_info:',
  'load_backend:',
  'register_backend:'
]

export type TranscriptionErrorCode =
  | 'whisper-missing'
  | 'model-missing'
  | 'snapshot-failed'
  | 'spawn-failed'
  | 'timeout'
  | 'exit-failed'
  | 'empty'
  | 'cancelled'

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode

  constructor(code: TranscriptionErrorCode, message: string) {
    super(message)
    this.name = 'TranscriptionError'
    this.code = code
  }
}

export interface TranscriptionResult {
  readonly text: string
  /** Wall time from spawning whisper-cli.exe until it exited. */
  readonly elapsedMs: number
}

export interface ActiveWhisperRun {
  readonly cancel: () => void
}

function appendCapped(current: string, chunk: string, limit: number): string {
  if (current.length >= limit) {
    return current
  }
  return (current + chunk).slice(0, limit)
}

function isNoiseLine(line: string): boolean {
  const lower = line.toLowerCase()
  return NOISE_LINE_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

/**
 * Converts whisper-cli's stdout into the single plain-text string Murmur will
 * insert. Timestamps, ANSI colours, blank lines, and diagnostic lines are
 * removed, and remaining lines are joined with single spaces.
 */
export function cleanWhisperOutput(raw: string): string {
  const withoutAnsi = raw.replace(ANSI_ESCAPE, '')
  const lines = withoutAnsi.replace(/\r\n?/g, '\n').split('\n')
  const parts: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.replace(TIMESTAMP, '').trim()
    if (line === '' || isNoiseLine(line)) {
      continue
    }
    parts.push(line)
  }

  return parts.join(' ').trim()
}

function formatFailureDetail(stderr: string): string {
  const detail = stderr.replace(/\s+/g, ' ').trim()
  if (detail === '') {
    return ''
  }
  return detail.length <= MAX_ERROR_DETAIL
    ? ` ${detail}`
    : ` ${detail.slice(0, MAX_ERROR_DETAIL)}...`
}

/**
 * Spawns one whisper-cli.exe run and resolves with cleaned stdout. Every exit
 * path settles the promise once, clears the 60 s timer, and unregisters the
 * child so `dispose` can cancel it.
 */
export function runWhisper(
  executablePath: string,
  modelPath: string,
  wavPath: string,
  language: WhisperLanguage,
  threads: number,
  registerActiveRun: (run: ActiveWhisperRun | null) => void
): Promise<TranscriptionResult> {
  return new Promise<TranscriptionResult>((resolvePromise, rejectPromise) => {
    const startedAt = Date.now()
    let settled = false
    let timedOut = false
    let cancelled = false
    let stdout = ''
    let stderr = ''
    let timeout: NodeJS.Timeout | null = null

    const finish = (): void => {
      settled = true
      if (timeout !== null) {
        clearTimeout(timeout)
        timeout = null
      }
      registerActiveRun(null)
    }

    const fail = (code: TranscriptionErrorCode, message: string): void => {
      if (settled) {
        return
      }
      finish()
      rejectPromise(new TranscriptionError(code, message))
    }

    const child = spawn(
      executablePath,
      ['-m', modelPath, '-f', wavPath, '-l', language, '-nt', '-np', '-t', String(threads)],
      {
        // Windows: hide the console window; otherwise a black window flashes on
        // every utterance while the app lives in the tray.
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    timeout = setTimeout(() => {
      timedOut = true
      console.error(
        `[murmur] whisper-cli.exe exceeded ${TRANSCRIBE_TIMEOUT_MS / 1000} s; killing it`
      )
      try {
        child.kill()
      } catch (error) {
        console.error('[murmur] could not kill the timed-out whisper process', error)
      }
    }, TRANSCRIBE_TIMEOUT_MS)

    registerActiveRun({
      cancel: () => {
        if (settled) {
          return
        }
        cancelled = true
        try {
          child.kill()
        } catch (error) {
          console.error('[murmur] could not cancel the whisper process', error)
        }
      }
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout = appendCapped(stdout, chunk, MAX_CAPTURED_OUTPUT)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = appendCapped(stderr, chunk, MAX_CAPTURED_OUTPUT)
    })

    child.once('error', (error) => {
      fail('spawn-failed', `whisper-cli.exe could not start: ${error.message}`)
    })

    child.once('close', (code) => {
      if (settled) {
        return
      }

      if (cancelled) {
        fail('cancelled', 'Transcription was cancelled because Murmur is shutting down.')
        return
      }

      if (timedOut) {
        fail(
          'timeout',
          `Transcription timed out after ${TRANSCRIBE_TIMEOUT_MS / 1000} s. Try a shorter utterance.`
        )
        return
      }

      if (code !== 0) {
        fail(
          'exit-failed',
          `whisper-cli.exe exited with code ${code ?? 'unknown'}.${formatFailureDetail(stderr)}`
        )
        return
      }

      const text = cleanWhisperOutput(stdout)
      if (text === '') {
        fail('empty', 'No speech was recognized in the recording.')
        return
      }

      finish()
      resolvePromise({ text, elapsedMs: Date.now() - startedAt })
    })
  })
}
