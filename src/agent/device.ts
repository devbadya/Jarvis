import type { ParsedToolCall } from './parse'
import type { ReviewEvidence } from './review'
import { queryLanguage } from '@/tools/web'

export const OPEN_SKILL = 'open-device'

interface SkillTools {
  skill: { name: string }
  tools: { schema: { function: { name: string } } }[]
}

const LEADING =
  /^\s*(?:please\s+|bitte\s+)?(?:open|launch|öffne|oeffne|starte)(?:\s+bitte)?\s+(.+?)\s*[.!?]*\s*$/i

const ARTICLE = /^(?:the|a|an|den|die|das|dem|mein|meine|meinen)\s+/i
const TRAILING = /\s+(?:app|application|programm|program|for me|für mich)$/i

/**
 * The thing an imperative "open …" is asking for, or null when the sentence
 * does not name one. "Open source" is a topic, not an application.
 */
export function openTarget(message: string): string | null {
  const match = LEADING.exec(message.trim())
  if (!match?.[1]) return null
  let target = match[1].trim().replace(ARTICLE, '').replace(TRAILING, '').trim()
  if (!target || /^source\b/i.test(target) || target.length > 200) return null
  return target
}

/** The forced `open` call, or null when this turn is not that skill or names nothing. */
export function openSeed(activation: SkillTools | null, message: string): ParsedToolCall | null {
  if (activation?.skill.name !== OPEN_SKILL) return null
  if (!activation.tools.some((tool) => tool.schema.function.name === 'open')) return null
  const target = openTarget(message)
  if (!target) return null
  return { name: 'open', arguments: { target } }
}

/** What the user sees after a forced open, without another generation. */
export function settleOpen(evidence: ReviewEvidence, question: string, error?: string): string {
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'open') continue
    return result.endsWith('.') ? result : `${result}.`
  }
  const german = queryLanguage(question) === 'de'
  if (error) return german ? `Öffnen fehlgeschlagen: ${error}` : `Could not open that: ${error}`
  return german ? 'Dazu habe ich nichts geöffnet.' : 'I did not open anything.'
}
