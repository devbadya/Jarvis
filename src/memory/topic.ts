import { isFollowUp } from '@/skills/route'
import { placeCandidates as clockPlaceCandidates, placeFromClockResult } from '@/tools/clock'
import { placeCandidates as weatherPlaceCandidates } from '@/tools/weather'
import { tokenize } from './text'

/**
 * Working memory: the one subject this conversation has already resolved.
 *
 * Durable memory is IndexedDB. Working memory is the transcript — except a
 * 0.8B model does not reliably read earlier turns, so the one fact worth
 * keeping (the last place a weather or clock call resolved) is pinned into the
 * system prompt the same way recall is. Nothing here is written down.
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

/** A later question that is still about the place, without naming it again. */
const REFERS_BACK =
  /\b(dort|da|davon|darüber|dabei|hier|the (mayor|weather|forecast|city|airport)|der bürgermeister|die bürgermeisterin|die stadt|that (city|place|town)|there)\b/i

const FOLLOW_UP_PREFIX = /^\s*(and|und|auch|also|plus|what about|how about|was ist mit|oh and)\b/i

const AFTER_PREPOSITION = /\b(?:in|at|for|near|around|f(?:ü|ue)r|um)\s+(.+)$/i

const WEATHER_HINT =
  /(?<![\w./])(un)?wetter|\b(weather|forecast|temperatur|temperature|regnet|schneit|rain|snow)\b/i

const CLOCK_HINT = /\b(time|date|clock|uhrzeit|weltuhr|zeitzone|timezone|wie sp(ä|ae)t)\b/i

const TEMPORAL =
  /^(today|tonight|tomorrow|now|right now|currently|heute|morgen|jetzt|gerade|aktuell|abend|nachmittag|later|dann|danach|the day after)$/i

/**
 * The city a weather or clock call actually resolved, or the one a question named.
 *
 * Tool arguments win: they are what the model asked for. The result header is
 * next — `Frankfurt, Germany — 15:45 local` — and a shaped user turn is last,
 * so an eval history that only has prose still has something to pin.
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

/**
 * One short line, or an empty string when this turn is not owed the place.
 *
 * Empty when nothing was established, when the question already names that
 * place, when it names a different one, or when it is asking something new.
 */
export function conversationTopic(
  query: string,
  prior: readonly TopicTurn[],
  options: { skill?: string | null } = {},
): string {
  const place = lastEstablishedPlace(prior)
  if (!place) return ''
  if (mentionsPlace(query, place)) return ''

  const named = placeNamedInQuery(query)
  if (named && !samePlace(named, place)) return ''

  if (
    options.skill === 'weather' ||
    options.skill === 'world-clock' ||
    isFollowUp(query) ||
    REFERS_BACK.test(query)
  ) {
    return renderTopicBlock(place)
  }
  return ''
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

function mentionsPlace(text: string, place: string): boolean {
  const asked = new Set(tokenize(text))
  const words = tokenize(place)
  return words.length > 0 && words.every((word) => asked.has(word))
}

function samePlace(a: string, b: string): boolean {
  return mentionsPlace(a, b) || mentionsPlace(b, a)
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
