import { InsertionError } from './insertionError'

/**
 * How the foreground app compares with Murmur. Anything except `same-or-lower`
 * is treated as unsafe for synthetic input; `unknown` is deliberately treated
 * the same as a higher-integrity target so a failed query can never bypass UIPI.
 */
export type TargetIntegrity = 'same-or-lower' | 'higher' | 'unknown'

export const ADMIN_TARGET_MESSAGE =
  'Target app is running as admin - text copied, press Ctrl+V manually.'

export const UNKNOWN_TARGET_MESSAGE =
  'Could not check the target app - text copied, press Ctrl+V manually.'

export type InsertionOutcome =
  { readonly kind: 'pasted' } | { readonly kind: 'clipboard-only'; readonly message: string }

/** Small seam so the clipboard/keystroke sequence can be unit-tested without Electron. */
export interface InsertionPorts {
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
  tapPaste(): void
  delay(ms: number): Promise<void>
}

/**
 * Windows: a normal user-level process cannot send synthetic input to a window
 * owned by an elevated process (UIPI). Instead of silently doing nothing, leave
 * the transcript on the clipboard and tell the user to press Ctrl+V manually.
 *
 * In this branch we intentionally do not read or restore the previous clipboard:
 * the transcript must remain available for the manual paste. For normal targets
 * the old clipboard text is restored after the usual delay.
 */
export async function executeInsertion(
  target: TargetIntegrity,
  payload: string,
  restoreDelayMs: number,
  ports: InsertionPorts
): Promise<InsertionOutcome> {
  if (target !== 'same-or-lower') {
    try {
      await ports.writeClipboard(payload)
    } catch (error) {
      throw new InsertionError(
        'clipboard-failed',
        'The transcribed text could not be copied to the clipboard.',
        error
      )
    }

    return {
      kind: 'clipboard-only',
      message: target === 'higher' ? ADMIN_TARGET_MESSAGE : UNKNOWN_TARGET_MESSAGE
    }
  }

  let savedText: string | null = null
  let pasteError: unknown = null
  let restoreError: unknown = null

  try {
    savedText = await ports.readClipboard()
    await ports.writeClipboard(payload)
    ports.tapPaste()
    await ports.delay(restoreDelayMs)
  } catch (error) {
    pasteError = error
  } finally {
    if (savedText !== null) {
      try {
        await ports.writeClipboard(savedText)
      } catch (error) {
        restoreError = error
      }
    }
  }

  if (pasteError !== null) {
    throw new InsertionError(
      'paste-failed',
      'The transcribed text could not be pasted.',
      pasteError
    )
  }
  if (restoreError !== null) {
    throw new InsertionError(
      'restore-failed',
      'The previous clipboard text could not be restored.',
      restoreError
    )
  }

  return { kind: 'pasted' }
}
