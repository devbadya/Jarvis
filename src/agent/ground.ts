import {
  conversationTopic,
  isPronounFollowUp,
  lastEstablished,
  lastResearchedPerson,
  type TopicTurn,
} from '@/memory/topic'
import { tokenize } from '@/memory/text'
import { INFORMAL_ASK, RESEARCH_SKILL, isFactAsk, isFramedQuestion } from '@/skills/researchable'
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

const RESEARCHED_FOR = /^Researched \d{4}-\d{2}-\d{2} for "([^"]+)"/m

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
 * The attribute left once the pronoun shell is gone.
 *
 * *does he has a women?* is `women`. *how old is he?* is `how old`. Searching
 * the shell itself is how Wikipedia returned a Hitler page for a Macron
 * follow-up.
 */
export function pronounFollowUpFocus(message: string): string {
  let text = message.replace(/[?!.]+$/g, '').trim()
  text = text.replace(/^(?:what'?s|whats)\s+/i, '')
  text = text.replace(
    /^(?:does|do|did|is|are|was|were|has|have|had|can|could|ist|sind|war|waren|hat|haben|hatte|kann)\s+(?:he|she|they|er|sie|es)\s+/i,
    '',
  )
  text = text.replace(/^(?:has|have|had|hat|haben)\s+/i, '')
  text = text.replace(/\b(he|she|they|him|his|her|hers|er|sie|ihn|ihm|ihr|ihnen)\b/gi, '')
  text = text.replace(/\b(is|are|was|were|ist|sind|war|waren)\b/gi, '')
  text = text.replace(/\b(a|an|the|ein|eine|einen|der|die|das|den|dem)\b/gi, '')
  return text.replace(/\s+/g, ' ').trim()
}

const FACT_ASK_FILLER =
  /\b(has|have|had|hat|haben|hatte|a|an|the|ein|eine|einen|eine[nms]?|ne|nen|der|die|das|den|dem|if|whether|ob|of|that|dass|is|are|was|were|ist|sind|war|waren)\b/gi

/**
 * *no of macron has a wife* searched as written is a fragment Wikipedia cannot
 * place. Keep the name and the attribute.
 */
export function factAskQuery(message: string): string {
  let text = message
    .replace(INFORMAL_ASK, '')
    .replace(/[?!.]+$/g, '')
    .trim()
  text = text.replace(/^(?:does|do|did|is|are|was|were|has|have|hat|haben|ist|sind)\s+/i, '')
  text = text.replace(FACT_ASK_FILLER, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

function researchAnchor(prior: readonly TopicTurn[]): string | null {
  const person = lastResearchedPerson(prior)
  if (person) return person
  const established = lastEstablished(prior)
  return established?.kind === 'subject' ? established.text : null
}

/**
 * The query `research` should run for this turn.
 *
 * A complete question is passed through — `research` already runs `focusQuery`.
 * A follow-up that only names a place keeps the last office, so *und der von
 * Frankreich?* is looked up as `Bundeskanzler Frankreich` rather than as a
 * fragment a search engine cannot place. A follow-up whose subject is only a
 * pronoun keeps the last person, so *does he has a women?* is looked up as
 * `Emmanuel Macron women`.
 */
export function researchQuery(message: string, prior: readonly TopicTurn[] = []): string {
  const text = message.trim()
  if (!text) return text

  if (isPronounFollowUp(text)) {
    const anchor = researchAnchor(prior)
    if (anchor && !alreadyNamesSubject(text, anchor)) {
      const focus = pronounFollowUpFocus(text)
      return (focus ? `${anchor} ${focus}` : anchor).replace(/\s+/g, ' ').trim()
    }
  }

  const established = lastEstablished(prior)
  if (established?.kind === 'subject' && conversationTopic(text, prior)) {
    const addition = followUpAddition(text)
    if (addition && !alreadyNamesSubject(addition, established.text)) {
      return `${established.text} ${addition}`.replace(/\s+/g, ' ').trim()
    }
    if (addition) return addition
    return established.text
  }

  if (INFORMAL_ASK.test(text) || (isFactAsk(text) && !isFramedQuestion(text))) {
    const cleaned = factAskQuery(text)
    if (cleaned) return cleaned
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

function researchedQuery(evidence: ReviewEvidence): string | null {
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'research') continue
    const match = RESEARCHED_FOR.exec(result)
    const query = match?.[1]?.trim()
    if (query) return query
  }
  return null
}

function passageOnTopic(passage: string, evidence: ReviewEvidence): boolean {
  const query = researchedQuery(evidence)
  if (!query) return true
  const asked = tokenize(query)
  if (asked.length === 0) return true
  const said = new Set(tokenize(passage))
  return asked.some((token) => said.has(token))
}

function firstQuotedPassage(evidence: ReviewEvidence): string | null {
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'research') continue
    const match = QUOTED_PASSAGE.exec(result)
    const passage = match?.[1]?.trim()
    if (passage && passageOnTopic(passage, evidence)) return passage
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
 * words, not the model's — but only when it shares a term with the query. A
 * Hitler paragraph for *does he has a women?* is the failure that guard is
 * for. Nothing confident enough to show becomes a refusal rather than a guess.
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
  // Off-topic pages are not "these pages came up" — that is how a Hitler URL
  // became the citation for a Macron follow-up. A source that did not make the
  // passage cut has nothing the reply may point at.
  return german ? 'Dazu habe ich keine verlässliche Antwort gefunden.' : 'I could not find a reliable answer.'
}
