import { conversationTopic, lastEstablished, type TopicTurn } from '@/memory/topic'
import { tokenize } from '@/memory/text'
import { RESEARCH_SKILL } from '@/skills/researchable'
import type { Tool } from '@/tools/types'
import { queryLanguage } from '@/tools/web'
import { findUrls, researchedAnswer, type ReviewEvidence } from './review'
import type { ParsedToolCall } from './parse'

/**
 * Looking a question up in code, then answering from what came back.
 *
 * `research-question` already decides that a fact must be fetched rather than
 * guessed. Leaving the fetch itself to a 0.8B model is how a turn about the
 * US president still came back as Macron and Merkel from the previous chat:
 * the skill routed, the model skipped the tool, and `reviewAnswer` had nothing
 * to check against. The call now happens here. The model is not asked to write
 * the fact.
 */

const FOLLOW_UP_STRIP =
  /^\s*(?:and|und|auch|also|plus|what about|how about|was ist mit|oh and|nein|no)\b[\s,]*/i

const LEADING_PLACE = /^(?:(?:der|die|das|the)\s+)?(?:von|of|in|aus|from)\s+/iu

const QUOTED_PASSAGE = /^\s{3}"(.+)"\s*$/m

const FALLBACK_SOURCES = 3

export interface ActivationLike {
  skill: { name: string }
  tools: Tool[]
}

function alreadyNamesSubject(text: string, subject: string): boolean {
  const asked = new Set(tokenize(text))
  const words = tokenize(subject)
  return words.length > 0 && words.every((word) => asked.has(word))
}

function followUpAddition(message: string): string {
  return message
    .replace(FOLLOW_UP_STRIP, '')
    .replace(/[?!.]+$/g, '')
    .replace(LEADING_PLACE, '')
    .trim()
}

/**
 * The query `research` should run for this turn.
 *
 * A complete question is passed through — `research` already runs `focusQuery`.
 * A follow-up that only names a place keeps the last office, so *und der von
 * Frankreich?* is looked up as `Bundeskanzler Frankreich` rather than as a
 * fragment a search engine cannot place.
 */
export function researchQuery(message: string, prior: readonly TopicTurn[] = []): string {
  const text = message.trim()
  if (!text) return text

  const established = lastEstablished(prior)
  if (established?.kind === 'subject' && conversationTopic(text, prior)) {
    const addition = followUpAddition(text)
    if (addition && !alreadyNamesSubject(addition, established.text)) {
      return `${established.text} ${addition}`.replace(/\s+/g, ' ').trim()
    }
    if (addition) return addition
    return established.text
  }

  return text
}

/** The forced `research` call, or null when this turn is not that skill. */
export function researchSeed(
  activation: ActivationLike | null,
  message: string,
  prior: readonly TopicTurn[] = [],
): ParsedToolCall | null {
  if (activation?.skill.name !== RESEARCH_SKILL) return null
  if (!activation.tools.some((tool) => tool.schema.function.name === 'research')) return null
  const query = researchQuery(message, prior)
  if (!query) return null
  return { name: 'research', arguments: { query } }
}

function sourceUrls(evidence: ReviewEvidence): string[] {
  return [...new Set(evidence.toolResults.flatMap(({ result }) => findUrls(result)))].slice(
    0,
    FALLBACK_SOURCES,
  )
}

function firstQuotedPassage(evidence: ReviewEvidence): string | null {
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'research') continue
    const match = QUOTED_PASSAGE.exec(result)
    const passage = match?.[1]?.trim()
    if (passage) return passage
  }
  return null
}

/**
 * The one-liner `research` already committed to, plus the source to cite.
 *
 * Shared with the wind-down fallback: both need the extract and must not invent
 * a second one.
 */
export function formatResearchedReply(evidence: ReviewEvidence): string | null {
  const extracted = researchedAnswer(evidence)
  if (!extracted) return null
  const sources = sourceUrls(evidence)
  return sources.length > 0 ? `${extracted}.\n\nSource: ${sources.join(' ')}` : `${extracted}.`
}

/**
 * What the user sees after a forced lookup, without another generation.
 *
 * An extract wins. A quoted passage is the next best thing — still the page's
 * words, not the model's. Nothing confident enough to show becomes a refusal
 * rather than a guess from training data.
 */
export function settleResearch(evidence: ReviewEvidence, question: string, lookupError?: string): string {
  const extracted = formatResearchedReply(evidence)
  if (extracted) return extracted

  const sources = sourceUrls(evidence)
  const passage = firstQuotedPassage(evidence)
  if (passage && sources[0]) return `${passage}\n\nSource: ${sources[0]}`

  const german = queryLanguage(question) === 'de'
  if (lookupError) {
    return german ? `Nachschlagen fehlgeschlagen: ${lookupError}` : `Lookup failed: ${lookupError}`
  }
  if (sources.length > 0) {
    const opening = german
      ? 'Dazu habe ich keine verlässliche Antwort gefunden. Diese Seiten sind dazu aufgetaucht.'
      : 'I could not find a reliable answer. These pages came up.'
    return `${opening}\n\nSource: ${sources.join(' ')}`
  }
  return german ? 'Dazu habe ich keine verlässliche Antwort gefunden.' : 'I could not find a reliable answer.'
}
