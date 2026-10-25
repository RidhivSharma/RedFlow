export type InsertionErrorCode =
  | 'empty-text'
  | 'modifiers-held'
  | 'own-window-focused'
  | 'clipboard-failed'
  | 'paste-failed'
  | 'restore-failed'
  | 'cancelled'

export class InsertionError extends Error {
  readonly code: InsertionErrorCode

  constructor(code: InsertionErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'InsertionError'
    this.code = code
  }
}
