import { isResearchable } from '@/skills/researchable'
import { isFollowUp } from '@/skills/route'
import { placeCandidates as clockPlaceCandidates, placeFromClockResult } from '@/tools/clock'
import { focusQuery } from '@/tools/research'
import { placeCandidates as weatherPlaceCandidates } from '@/tools/weather'
import { tokenize } from './text'

/**
 * Working memory: the one subject this conversation has already resolved.
 *
 * Durable memory is IndexedDB. Working memory is the transcript — except a
 * 0.8B model does not reliably read earlier turns, so the one fact worth
 * keeping is pinned into the system prompt the same way recall is. For weather
 * and the clock that is the last place. For research it is the last office or
 * question — *Bundeskanzler* — so *und der von Frankreich?* or *nein in
 * Russland* is not searched as a fragment. Nothing here is written down.
 *
 * A fresh question that names its own subject — *Wer ist Elon Musk?* — must
 * not receive it. Mixing Frankfurt into that prompt is how the model answers
 * the previous turn instead of this one.
 */

export interface TopicTurn {
  role: string
  content: string
  toolCalls?: Array<{
    name: string
    arguments?: Record<string, unknown>
    status?: string
    result?: string
  }>
}

export type Established = { kind: 'place'; text: string } | { kind: 'subject'; text: string }

/** A later question that is still about the place, without naming it again. */
const REFERS_BACK =
  /\b(dort|da|davon|darüber|dabei|hier|the (mayor|weather|forecast|city|airport)|der bürgermeister|die bürgermeisterin|die stadt|that (city|place|town)|there)\b/i

const FOLLOW_UP_PREFIX = /^\s*(and|und|auch|also|plus|what about|how about|was ist mit|oh and|nein|no)\b/i

const AFTER_PREPOSITION = /\b(?:in|at|for|near|around|f(?:ü|ue)r|um)\s+(.+)$/i

const WEATHER_HINT =
  /(?<![\w./])(un)?wetter|\b(weather|forecast|temperatur|temperature|regnet|schneit|rain|snow)\b/i

const CLOCK_HINT = /\b(time|date|clock|uhrzeit|weltuhr|zeitzone|timezone|wie sp(ä|ae)t|wie ?viel uhr)\b/i

const TEMPORAL =
  /^(today|tonight|tomorrow|now|right now|currently|heute|morgen|jetzt|gerade|aktuell|abend|nachmittag|later|dann|danach|the day after)$/i

/**
 * *und der von Frankreich?* keeps the last office and only changes the place.
 * Treating Frankreich as a new subject would drop *Bundeskanzler* and search
 * a country name.
 */
const PLACE_ONLY_FOLLOW_UP = /(?:(?:der|die|das|the)\s+)?(?:von|of|in|aus|from)\s+[\p{L}\p{M}'’-]+/iu

const RESEARCHED_FOR = /^Researched \d{4}-\d{2}-\d{2} for "([^"]+)"/m

/**
 * The most recently resolved place or research subject.
 *
 * Recency is the whole point: an older Frankfurt must not leak onto a chancellor
 * follow-up, and an older Bundeskanzler must not leak onto tomorrow's weather.
 * Tool results win over the user wording, the same way `lastEstablishedPlace`
 * already prefers the city the weather tool actually resolved.
 */
export function lastEstablished(turns: readonly TopicTurn[]): Established | null {
  for (const turn of [...turns].toReversed()) {
    for (const call of (turn.toolCalls ?? []).toReversed()) {
      if (call.status === 'error') continue

      if (call.name === 'weather') {
        const fromResult = placeFromWeatherResult(call.result ?? '')
        if (fromResult) return { kind: 'place', text: fromResult }
        const fromArgs = isolatePlace(String(call.arguments?.place ?? ''), 'weather')
        if (fromArgs && !TEMPORAL.test(fromArgs)) return { kind: 'place', text: fromArgs }
      }

      if (call.name === 'current_time') {
        const fromResult = placeFromClockResult(call.result ?? '')
        if (fromResult) return { kind: 'place', text: fromResult }
        const fromArgs = isolatePlace(String(call.arguments?.place ?? ''), 'clock')
        if (fromArgs && !TEMPORAL.test(fromArgs)) return { kind: 'place', text: fromArgs }
      }

      if (call.name === 'research') {
        const fromResult = subjectFromResearchResult(call.result ?? '')
        if (fromResult) return { kind: 'subject', text: fromResult }
        const raw = String(call.arguments?.query ?? '').trim()
        if (raw) {
          const focused = focusQuery(raw)
          if (focused) return { kind: 'subject', text: focused }
        }
      }
    }

    if (turn.role !== 'user') continue

    if (WEATHER_HINT.test(turn.content) || CLOCK_HINT.test(turn.content)) {
      const after = AFTER_PREPOSITION.exec(turn.content)?.[1]
      if (after) {
        const kind = WEATHER_HINT.test(turn.content) ? 'weather' : 'clock'
        const isolated = isolatePlace(after, kind)
        if (isolated && !TEMPORAL.test(isolated)) return { kind: 'place', text: isolated }
      }
      continue
    }

    if (isResearchable(turn.content)) {
      const focused = focusQuery(turn.content)
      if (focused.length >= 2) return { kind: 'subject', text: focused }
    }
  }

  return null
}

/**
 * The city a weather or clock call actually resolved, or the one a question named.
 *
 * Scans for a place only, so existing callers that ask "where were we" still
 * see Frankfurt after a later research turn. `conversationTopic` uses
 * `lastEstablished` instead, which is recency across both kinds.
 */
export function lastEstablishedPlace(turns: readonly TopicTurn[]): string | null {
  for (const turn of [...turns].toReversed()) {
    for (const call of (turn.toolCalls ?? []).toReversed()) {
      if (call.status === 'error') continue
      if (call.name === 'weather') {
        const fromResult = placeFromWeatherResult(call.result ?? '')
        if (fromResult) return fromResult
        const fromArgs = isolatePlace(String(call.arguments?.place ?? ''), 'weather')
        if (fromArgs && !TEMPORAL.test(fromArgs)) return fromArgs
      }
      if (call.name === 'current_time') {
        const fromResult = placeFromClockResult(call.result ?? '')
        if (fromResult) return fromResult
        const fromArgs = isolatePlace(String(call.arguments?.place ?? ''), 'clock')
        if (fromArgs && !TEMPORAL.test(fromArgs)) return fromArgs
      }
    }

    if (turn.role === 'user' && (WEATHER_HINT.test(turn.content) || CLOCK_HINT.test(turn.content))) {
      const after = AFTER_PREPOSITION.exec(turn.content)?.[1]
      if (after) {
        const kind = WEATHER_HINT.test(turn.content) ? 'weather' : 'clock'
        const isolated = isolatePlace(after, kind)
        if (isolated && !TEMPORAL.test(isolated)) return isolated
      }
    }
  }
  return null
}

export function lastEstablishedSubject(turns: readonly TopicTurn[]): string | null {
  const found = lastEstablished(turns)
  return found?.kind === 'subject' ? found.text : null
}

function subjectFromResearchResult(result: string): string | null {
  const match = RESEARCHED_FOR.exec(result)
  const subject = match?.[1]?.trim()
  return subject ? subject : null
}

/**
 * One short line, or an empty string when this turn is not owed the place.
 *
 * Empty when nothing was established, when the question already names that
 * subject, when it names a different one, or when it is asking something new.
 */
export function conversationTopic(
  query: string,
  prior: readonly TopicTurn[],
  options: { skill?: string | null } = {},
): string {
  const established = lastEstablished(prior)
  if (!established) return ''
  if (mentionsTopic(query, established.text)) return ''

  if (established.kind === 'place') {
    const named = placeNamedInQuery(query)
    if (named && !samePlace(named, established.text)) return ''

    if (
      options.skill === 'weather' ||
      options.skill === 'world-clock' ||
      isFollowUp(query) ||
      REFERS_BACK.test(query)
    ) {
      return renderTopicBlock(established.text)
    }
    return ''
  }

  // A complete new question — *Wer ist Elon Musk?* after a chancellor turn —
  // is research-question too. Pinning only on a follow-up is what keeps the
  // last office out of that prompt. *und Elon Musk?* names a new person and
  // is silent for the same reason; *und der von Frankreich?* is not a person.
  if (!isFollowUp(query)) return ''
  if (namesNewResearchSubject(query, established.text)) return ''
  return renderTopicBlock(established.text)
}

export function renderTopicBlock(place: string): string {
  return `This conversation is about ${place}.`
}

/** Join recall and topic without announcing that either is empty. */
export function joinPromptNotes(...parts: string[]): string {
  return parts.filter((part) => part.trim().length > 0).join('\n\n')
}

function isolatePlace(raw: string, kind: 'weather' | 'clock' = 'weather'): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const candidates = kind === 'clock' ? clockPlaceCandidates(trimmed) : weatherPlaceCandidates(trimmed)
  return (candidates[candidates.length - 1] ?? trimmed).trim()
}

function placeFromWeatherResult(result: string): string | null {
  const head = result.split('\n')[0] ?? ''
  const beforeDash = head.split('—')[0]?.trim() ?? ''
  const city = beforeDash.split(',')[0]?.trim()
  return city || null
}

function mentionsTopic(text: string, topic: string): boolean {
  const asked = new Set(tokenize(text))
  const words = tokenize(topic)
  return words.length > 0 && words.every((word) => asked.has(word))
}

function samePlace(a: string, b: string): boolean {
  return mentionsTopic(a, b) || mentionsTopic(b, a)
}

function namesNewResearchSubject(query: string, current: string): boolean {
  if (PLACE_ONLY_FOLLOW_UP.test(query)) return false
  const rest = query
    .replace(FOLLOW_UP_PREFIX, '')
    .replace(/^[?\s,]+/, '')
    .replace(/[?!.]+$/g, '')
    .trim()
  if (!rest || mentionsTopic(rest, current) || PLACE_ONLY_FOLLOW_UP.test(rest)) return false
  return tokenize(rest).length >= 2
}

function placeNamedInQuery(query: string): string | null {
  const afterPrep = AFTER_PREPOSITION.exec(query)?.[1]
  if (afterPrep) {
    const isolated = isolatePlace(afterPrep)
    return isolated && !TEMPORAL.test(isolated) ? isolated : null
  }

  if (!isFollowUp(query)) return null

  const rest = query
    .replace(FOLLOW_UP_PREFIX, '')
    .replace(/^[?\s,]+/, '')
    .replace(/[?!.]+$/g, '')
    .trim()
  if (!rest || TEMPORAL.test(rest) || rest.split(/\s+/).length > 3) return null
  const isolated = isolatePlace(rest)
  return isolated && !TEMPORAL.test(isolated) ? isolated : null
}
