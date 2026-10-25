/**
 * Pure transcript post-processing shared by the whisper runner and the
 * dictation controller. Keeping these transformations free of Electron and
 * filesystem access makes the exact cleanup rules easy to test and reason about.
 */
export interface TranscriptPreferences {
  /** Drop "um", "uh", and their elongated spellings. */
  readonly removeFillerWords: boolean
  /** Turn spoken punctuation and line-break words into the real characters. */
  readonly spokenCommands: boolean
}

/** Whisper's non-speech annotations, for example `[BLANK_AUDIO]` or `(music)`. */
const ARTIFACT_PATTERNS: readonly RegExp[] = [
  /\[(?:blank[ _]?audio|silence|noise|music(?: playing)?|sound|inaudible|applause|laughter|static|beep)\]/gi,
  /\((?:music(?: playing)?|silence|noise|inaudible|applause|laughter|static|beep|wind|background noise)\)/gi,
  /[\u266A\u266B]/g
]

/**
 * Whisper commonly transcribes the silence around a short utterance as one of
 * these phrases. Only an exact full-transcript match is removed, so a sentence
 * that merely starts with "Thank you" is left alone.
 */
const SILENCE_HALLUCINATIONS: ReadonlySet<string> = new Set([
  'thank you',
  'thank you thank you',
  'thank you very much',
  'thanks for watching',
  'thanks for watching thanks for watching',
  'thanks for watching everyone',
  'thank you for watching',
  'thank you for watching everyone',
  'thank you for watching please subscribe',
  'thanks for watching please subscribe',
  'please subscribe',
  'like and subscribe',
  'subscribe to my channel'
])

const FILLER_MARKER = '\uE000'
// `um+` covers "um" and "umm"; the boundary and lookahead keep "umbrella" and
// "uh-huh" intact.
const FILLER_PATTERN = /\b(?:um+|uh+)\b[,.!?;:]*(?!-)/gi

const COMMAND_MARKERS = {
  period: '\uE001',
  comma: '\uE002',
  question: '\uE003'
} as const

/**
 * Order matters: spoken punctuation is replaced first, then line breaks, so a
 * phrase such as "hello period new line world" becomes "Hello.\nWorld".
 */
const SPOKEN_COMMANDS: ReadonlyArray<{
  readonly pattern: RegExp
  readonly replacement: string
}> = [
  {
    pattern: /[ \t]*(?:[.,!?;:][ \t]*)?\bperiod\b[.,!?;:]*/gi,
    replacement: COMMAND_MARKERS.period
  },
  {
    pattern: /[ \t]*(?:[.,!?;:][ \t]*)?\bcomma\b[.,!?;:]*/gi,
    replacement: COMMAND_MARKERS.comma
  },
  {
    pattern: /[ \t]*(?:[.,!?;:][ \t]*)?\bquestion\s+mark\b[.,!?;:]*/gi,
    replacement: COMMAND_MARKERS.question
  },
  { pattern: /[ \t]*\bnew\s+paragraph\b[.,!?;:]*/gi, replacement: '\n\n' },
  { pattern: /[ \t]*\bnew\s+line\b[.,!?;:]*/gi, replacement: '\n' }
]

function hasContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

function tidyTranscript(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+([.,!?;:])/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Removes whisper's bracketed/parenthesised sound labels and music notes. */
export function stripWhisperArtifacts(text: string): string {
  let result = text
  for (const pattern of ARTIFACT_PATTERNS) {
    result = result.replace(pattern, ' ')
  }
  return result.replace(/\s+/g, ' ').trim()
}

/** True when the whole transcript is a known silent-audio hallucination. */
export function isKnownSilenceTranscript(text: string): boolean {
  const normalized = normalizeForComparison(text)
  return normalized !== '' && SILENCE_HALLUCINATIONS.has(normalized)
}

/**
 * Removes non-speech annotations and replaces an all-hallucination transcript
 * with an empty string. An empty result means "nothing worth inserting".
 */
export function cleanTranscriptArtifacts(text: string): string {
  const stripped = stripWhisperArtifacts(text)
  return stripped === '' || !hasContent(stripped) || isKnownSilenceTranscript(stripped)
    ? ''
    : stripped
}

/** Drops whole-word filler sounds while preserving the sentence around them. */
export function removeFillerWords(text: string): string {
  let result = text.replace(FILLER_PATTERN, FILLER_MARKER)

  // If a filler opened the transcript or followed sentence punctuation, the
  // next word must keep its capital letter.
  result = result.replace(
    /(^|[.!?]\s+)([ \t]*\uE000[ \t]*)([a-z])/gi,
    (_match: string, prefix: string, _filler: string, letter: string) =>
      `${prefix}${letter.toUpperCase()}`
  )
  result = result.replace(/[ \t]*\uE000[ \t]*/g, ' ')
  return tidyTranscript(result)
}

/** Converts spoken punctuation and line-break commands into real characters. */
export function applySpokenCommands(text: string): string {
  let result = text
  for (const command of SPOKEN_COMMANDS) {
    result = result.replace(command.pattern, command.replacement)
  }

  // A word following an inserted question mark or period starts a new sentence.
  result = result.replace(
    /([\uE001\uE003])[ \t]+([a-z])/g,
    (_match: string, punctuation: string, letter: string) =>
      `${punctuation} ${letter.toUpperCase()}`
  )
  result = result
    .replaceAll(COMMAND_MARKERS.period, '.')
    .replaceAll(COMMAND_MARKERS.comma, ',')
    .replaceAll(COMMAND_MARKERS.question, '?')
  return tidyTranscript(result)
}

/**
 * Applies the user's cleanup preferences to one cleaned transcript. Returns an
 * empty string when nothing should be pasted (silence hallucination or only
 * filler sounds were recognized).
 */
export function applyTranscriptPreferences(
  text: string,
  preferences: TranscriptPreferences
): string {
  let result = cleanTranscriptArtifacts(text)
  if (result === '') {
    return result
  }

  if (preferences.removeFillerWords) {
    result = removeFillerWords(result)
  }
  if (preferences.spokenCommands) {
    result = applySpokenCommands(result)
  }

  result = tidyTranscript(result)
  return !hasContent(result) || isKnownSilenceTranscript(result) ? '' : result
}
