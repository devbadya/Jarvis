import { lastEstablishedPlace, type TopicTurn } from '@/memory/topic'
import { wordPattern } from './language'

/**
 * The place a weather or clock question names, as the user wrote it.
 *
 * Two forms come back: `display` keeps the article the user used, so a German
 * reply can say *In der Schweiz* rather than *In Schweiz*, and `query` drops it,
 * because the geocoder knows *Schweiz* and not *der Schweiz*.
 */
export interface AskedPlace {
  display: string
  query: string
}

const AFTER_PREPOSITION = wordPattern('in|at|for|near|around|für|fuer', 'iu')

/**
 * Words that can follow the place and are never part of it: when, what about,
 * and the verbs a rain question ends on.
 */
const NOT_PLACE = wordPattern(
  [
    'today|tonight|tomorrow|now|right now|currently|at the moment|the day after tomorrow',
    'this (?:week|weekend|morning|afternoon|evening)',
    'heute|morgen|übermorgen|uebermorgen|jetzt|gerade|aktuell|abends?|nachmittags?|diese woche|am wochenende',
    'weather|forecast|temperature|climate|rain|snow|like',
    'wetter|vorhersage|wettervorhersage|temperatur|regen|schnee|regnen|schneien|regnet|schneit',
    'sein|werden|wird|ist|is|be|es|it',
    'time|date|clock|uhrzeit|uhr|datum|zeit|zeitzone|timezone',
    'tag|day|wochentag|weekday|woche|week|monat|month|jahr|year',
  ].join('|'),
  'giu',
)

/** What is left of a question with no preposition once its question words are gone. */
const QUESTION_WORDS = wordPattern(
  [
    "what's|whats|what|how's|hows|how|is|are|will|does|do|the|it|like|an|a|i|and|also|about|there",
    'need|umbrella|warm|hot|cold|outside|much|late|looking|going|expected|supposed',
    'wie|was|ist|wird|sind|das|der|die|es|gibt|brauche|brauch|ich|einen|ein|eine|schirm|regenschirm',
    'welche[rsn]?|und|auch|mit|dort|da|kalt|heiß|heiss|draußen|draussen|viel|spät|spaet|sieht|aus|aussehen',
    'haben|wir|we|have|bitte|please|jarvis',
  ].join('|'),
  'giu',
)

const LEADING_ARTICLE = /^(?:der|die|das|den|dem|the)\s+/i

const PLACE_WORDS = /^[\p{L}\p{M}'’.-]+(?:\s+[\p{L}\p{M}'’.-]+){0,3}$/u

function tidy(text: string): string {
  return text
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function asPlace(phrase: string): AskedPlace | null {
  const display = tidy(phrase)
  if (!display || !PLACE_WORDS.test(display) || !/\p{L}{2}/u.test(display)) return null
  const query = display.replace(LEADING_ARTICLE, '').trim()
  return query ? { display, query } : null
}

export function placeAsked(message: string): AskedPlace | null {
  const preposition = AFTER_PREPOSITION.exec(message)
  if (preposition) {
    const after = message.slice(preposition.index + preposition[0].length).trim()
    // *in Berlin in drei Tagen* — the place ends where the next `in` starts.
    // `am` is not cut on, or Frankfurt am Main would lose its river.
    const first = after.split(/\s+(?:in|at|on)\s+/i)[0] ?? after
    return asPlace(tidy(first.replace(NOT_PLACE, ' ')))
  }

  // *Wetter Berlin*, *Berlin weather?* — no preposition, so the place is what
  // survives once the subject and every question word are gone. A question
  // with nothing left, *Wie ist das Wetter?*, names no place at all.
  const rest = tidy(message.replace(NOT_PLACE, ' ').replace(QUESTION_WORDS, ' '))
  if (!rest || rest.split(' ').length > 3) return null
  return asPlace(rest)
}

/** The place asked about now, or the one this conversation already settled. */
export function placeForTurn(message: string, prior: readonly TopicTurn[]): AskedPlace | null {
  const asked = placeAsked(message)
  if (asked) return asked
  const earlier = lastEstablishedPlace(prior)
  return earlier ? asPlace(earlier) : null
}
