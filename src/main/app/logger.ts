import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { app } from 'electron'

const LOG_DIRECTORY_NAME = 'logs'
const LOG_FILE_NAME = 'murmur.log'
const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024
const MAX_ROTATED_FILES = 3
const DEBUG_ENV_VAR = 'MURMUR_DEBUG'
const MAX_LOGGED_MESSAGE_LENGTH = 16 * 1024

type LogMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

interface ConsoleMethods {
  readonly log: (...data: unknown[]) => void
  readonly info: (...data: unknown[]) => void
  readonly warn: (...data: unknown[]) => void
  readonly error: (...data: unknown[]) => void
  readonly debug: (...data: unknown[]) => void
}

export interface LoggerOptions {
  /** Overrides `userData/logs`; used by tests so real user logs stay untouched. */
  readonly directory?: string
  /** Overrides the 2 MB rotation threshold. */
  readonly maxBytes?: number
}

let initialized = false
let logFilePath: string | null = null
let logFileBytes = 0
let maxLogBytes = DEFAULT_MAX_LOG_BYTES
let writeFailureReported = false
let originalConsole: ConsoleMethods | null = null

function buildSessionHeader(): string {
  return `${new Date().toISOString()} [info] --- Murmur ${app.getVersion()} log started ---\n`
}

function reportWriteFailure(error: unknown): void {
  if (writeFailureReported) {
    return
  }
  writeFailureReported = true
  originalConsole?.error('[murmur] the log file could not be written', error)
}

function rotateLogFile(): void {
  const filePath = logFilePath
  if (filePath === null) {
    return
  }

  try {
    rmSync(`${filePath}.${MAX_ROTATED_FILES}`, { force: true })
    for (let index = MAX_ROTATED_FILES - 1; index >= 1; index -= 1) {
      const source = `${filePath}.${index}`
      if (existsSync(source)) {
        renameSync(source, `${filePath}.${index + 1}`)
      }
    }
    if (existsSync(filePath)) {
      renameSync(filePath, `${filePath}.1`)
    }

    const header = buildSessionHeader()
    appendFileSync(filePath, header, 'utf8')
    logFileBytes = Buffer.byteLength(header, 'utf8')
  } catch (error) {
    // Rotation must never stop the app or silence later log lines.
    reportWriteFailure(error)
  }
}

function writeLine(method: LogMethod, data: readonly unknown[]): void {
  const filePath = logFilePath
  if (filePath === null) {
    return
  }

  let message = format(...data)
  if (message.length > MAX_LOGGED_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_LOGGED_MESSAGE_LENGTH)}... [truncated]`
  }

  const line = `${new Date().toISOString()} [${method}] ${message}\n`
  const bytes = Buffer.byteLength(line, 'utf8')

  try {
    if (logFileBytes + bytes > maxLogBytes) {
      rotateLogFile()
    }
    appendFileSync(filePath, line, 'utf8')
    logFileBytes += bytes
  } catch (error) {
    reportWriteFailure(error)
  }
}

function installConsoleCapture(): void {
  const originals: ConsoleMethods = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  }
  originalConsole = originals

  console.log = (...data: unknown[]): void => {
    originals.log(...data)
    writeLine('log', data)
  }
  console.info = (...data: unknown[]): void => {
    originals.info(...data)
    writeLine('info', data)
  }
  console.warn = (...data: unknown[]): void => {
    originals.warn(...data)
    writeLine('warn', data)
  }
  console.error = (...data: unknown[]): void => {
    originals.error(...data)
    writeLine('error', data)
  }
  console.debug = (...data: unknown[]): void => {
    originals.debug(...data)
    writeLine('debug', data)
  }
}

/**
 * Mirrors the main process console into `userData/logs/murmur.log` and rotates
 * the file at 2 MB with three backups. Writes are synchronous and best-effort:
 * a full or locked disk must never interrupt dictation.
 */
export function initializeLogging(options: LoggerOptions = {}): string | null {
  if (initialized) {
    return logFilePath
  }
  initialized = true

  const directory = options.directory ?? join(app.getPath('userData'), LOG_DIRECTORY_NAME)
  const filePath = join(directory, LOG_FILE_NAME)
  logFilePath = filePath
  if (options.maxBytes !== undefined && Number.isFinite(options.maxBytes)) {
    maxLogBytes = Math.max(1024, Math.floor(options.maxBytes))
  }

  try {
    mkdirSync(directory, { recursive: true })
    logFileBytes = existsSync(filePath) ? statSync(filePath).size : 0
  } catch (error) {
    logFilePath = null
    console.error('[murmur] the log directory could not be created', error)
    return null
  }

  installConsoleCapture()
  console.log(`[murmur] logging to ${filePath}`)
  return filePath
}

export function getLogFilePath(): string | null {
  return logFilePath
}

/**
 * Transcript text is sensitive; it is only written when the user explicitly
 * starts Murmur with MURMUR_DEBUG=1. Audio samples are never written to the log.
 */
export function isDebugLoggingEnabled(): boolean {
  return process.env[DEBUG_ENV_VAR] === '1'
}

export function logDebug(...data: readonly unknown[]): void {
  if (isDebugLoggingEnabled()) {
    console.debug('[murmur debug]', ...data)
  }
}
