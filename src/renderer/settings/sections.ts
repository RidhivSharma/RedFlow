/** The five settings sections, in sidebar order. */
export const SECTION_IDS = ['dictation', 'cleanup', 'microphone', 'model', 'system'] as const

export type SectionId = (typeof SECTION_IDS)[number]

export function tabId(section: SectionId): string {
  return `tab-${section}`
}

export function panelId(section: SectionId): string {
  return `panel-${section}`
}
