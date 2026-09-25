import {
  conversationTopic,
  isPronounFollowUp,
  lastEstablished,
  lastResearchedPerson,
  type TopicTurn,
} from '@/memory/topic'
import { tokenize } from '@/memory/text'
import { INFORMAL_ASK, RESEARCH_SKILL, isFactAsk, isFramedQuestion } from '@/skills/researchable'
import { asksAge } from '@/tools/research'
import type { Tool } from '@/tools/types'
import { arithmeticSeed } from './arithmetic'
import { clockSeed, CURRENT_DATE_SKILL, WORLD_CLOCK_SKILL } from './clock'
import { openSeed } from './device'
import { capitalize, replyLanguageFor, type ReplyLanguage } from './language'
import { findUrls, researchedAnswer, type ReviewEvidence } from './review'
import type { ParsedToolCall } from './parse'
import { CONVERSATION_SKILL } from './smalltalk'
import { WEATHER_SKILL, weatherSeed } from './weather'

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
      // *Und wie alt ist er?* was searched as `Friedrich Merz Und wie alt`.
      const focus = pronounFollowUpFocus(text.replace(FOLLOW_UP_STRIP, ''))
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

const QUOTED_PASSAGE = /^\s{3}"(.+)"\s*$/gm

const RESEARCHED_FOR = /^Researched \d{4}-\d{2}-\d{2} for "([^"]+)"/m

/** Whether any passage `research` quoted shares a term with the query it ran. */
function digestOnTopic(evidence: ReviewEvidence): boolean {
  for (const { tool, result } of evidence.toolResults) {
    if (tool !== 'research') continue
    const asked = tokenize(RESEARCHED_FOR.exec(result)?.[1] ?? '')
    for (const match of result.matchAll(QUOTED_PASSAGE)) {
      if (asked.length === 0) return true
      const said = new Set(tokenize(match[1] ?? ''))
      if (asked.some((token) => said.has(token))) return true
    }
  }
  return false
}

const ADVERB_DE = /^(aktuell|derzeit|momentan|gerade|jetzt|heute|zurzeit|im moment)\s+/i
const TRAILING_ADVERB_DE = /\s+(aktuell|derzeit|momentan|gerade|jetzt|heute|zurzeit|im moment)$/i
const ADVERB_EN = /^(currently|now|right now|today|at the moment)\s+/i
const TRAILING_ADVERB_EN = /\s+(currently|now|right now|today|at the moment)$/i

const FIGURE_SUBJECT = /\b(einwohnerzahl|bev(ö|oe)lkerung|preis|kosten)\b/i

/** Subject, then verb, then answer — with an adverb like *aktuell* moved after the verb. */
function copula(subject: string, verb: string, answer: string, language: ReplyLanguage): string {
  const leading = language === 'de' ? ADVERB_DE : ADVERB_EN
  const trailing = language === 'de' ? TRAILING_ADVERB_DE : TRAILING_ADVERB_EN
  let adverb = ''
  let rest = subject
  const front = leading.exec(rest)
  if (front?.[1]) {
    adverb = front[1]
    rest = rest.slice(front[0].length)
  }
  const back = trailing.exec(rest)
  if (back?.[1]) {
    adverb = adverb || back[1]
    rest = rest.slice(0, back.index)
  }
  const middle = adverb ? `${verb} ${adverb.toLowerCase()}` : verb
  return `${capitalize(rest.trim())} ${middle} ${answer}.`
}

/**
 * The extract said as a sentence that answers the question asked.
 *
 * *Wer ist der Bundeskanzler von Deutschland?* reads *Der Bundeskanzler von
 * Deutschland ist Friedrich Merz.* rather than a bare *Friedrich Merz.* The
 * words are the user's own, moved around; a shape not listed here keeps the
 * extract on its own rather than risk a sentence that is not German.
 */
export function researchSentence(question: string, extracted: string, language: ReplyLanguage): string {
  const answer = extracted.replace(/[.\s]+$/, '')
  const text = question
    .trim()
    .replace(/[?!.\s]+$/, '')
    .replace(/\s+/g, ' ')
  let match: RegExpExecArray | null

  if (language === 'de') {
    if ((match = /^wer (ist|war|sind|waren) (.+)$/i.exec(text)) && match[1] && match[2]) {
      return copula(match[2], match[1].toLowerCase(), answer, language)
    }
    if (
      (match =
        /^wer hat (.+) (geschrieben|erfunden|gegr(?:ü|ue)ndet|entdeckt|komponiert|gebaut|entwickelt|gemalt|gewonnen|gedreht|erschaffen)$/i.exec(
          text,
        )) &&
      match[1] &&
      match[2]
    ) {
      return `${answer} hat ${match[1]} ${match[2].toLowerCase()}.`
    }
    if ((match = /^wie hei(?:ß|ss)t (.+)$/i.exec(text)) && match[1]) {
      return copula(match[1], 'heißt', answer, language)
    }
    if ((match = /^wie viele einwohner hat (.+)$/i.exec(text)) && match[1]) {
      const unit = /einwohner/i.test(answer) ? '' : ' Einwohner'
      return `${capitalize(match[1])} hat ${answer}${unit}.`
    }
    if ((match = /^(?:was|wie viel) kostet (.+)$/i.exec(text)) && match[1]) {
      return `${capitalize(match[1])} kostet ${answer}.`
    }
    if ((match = /^was (ist|sind|war|waren) ((?:der|die|das) .+)$/i.exec(text)) && match[1] && match[2]) {
      const verb =
        FIGURE_SUBJECT.test(match[2]) && match[1].toLowerCase() === 'ist' ? 'beträgt' : match[1].toLowerCase()
      return copula(match[2], verb, answer, language)
    }
    return `${answer}.`
  }

  if ((match = /^who (is|was|are|were) (.+)$/i.exec(text)) && match[1] && match[2]) {
    return copula(match[2], match[1].toLowerCase(), answer, language)
  }
  if (
    (match =
      /^who (wrote|invented|founded|discovered|created|directed|composed|painted|designed|built|won) (.+)$/i.exec(
        text,
      )) &&
    match[1] &&
    match[2]
  ) {
    return `${answer} ${match[1].toLowerCase()} ${match[2]}.`
  }
  if ((match = /^what(?:'s| is| was) (the .+)$/i.exec(text)) && match[1]) {
    const verb = /^what was/i.test(text) ? 'was' : 'is'
    return copula(match[1], verb, answer, language)
  }
  if ((match = /^how many people live in (.+)$/i.exec(text)) && match[1]) {
    return `${capitalize(answer)} live in ${match[1]}.`
  }
  if ((match = /^how much (?:does|do|did) (.+) cost$/i.exec(text)) && match[1]) {
    return `${capitalize(match[1])} costs ${answer}.`
  }
  return `${answer}.`
}

/**
 * The one-liner `research` already committed to, plus the source to cite.
 *
 * Shared with the wind-down fallback: both need the extract and must not invent
 * a second one. With the question it becomes a sentence; without it, the
 * extract stands alone.
 */
export function formatResearchedReply(
  evidence: ReviewEvidence,
  question?: string,
  chosen?: string,
): string | null {
  const extracted = researchedAnswer(evidence)
  if (!extracted) return null
  const sentence = question
    ? researchSentence(question, extracted, replyLanguageFor(question, chosen))
    : `${extracted.replace(/[.\s]+$/, '')}.`
  const sources = sourceUrls(evidence)
  return sources.length > 0 ? `${sentence}\n\nSource: ${sources.join(' ')}` : sentence
}

const DEFINITION = /^Definition:\s+(.+)$/m

const BORN = /^Born:\s+(.+),\s+(\d{4})-(\d{2})-(\d{2})$/m

const MONTH_NAMES = {
  de: [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
} as const

/**
 * An age worked out from the birth date the person's article gives.
 *
 * *Friedrich Merz hat 70 Jahre alt* was the model's sentence for a number
 * that is subtraction. The date is the article's; the arithmetic is ours.
 */
export function ageReply(
  evidence: ReviewEvidence,
  language: ReplyLanguage,
  now: Date = new Date(),
): string | null {
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'research') continue
    const match = BORN.exec(result)
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) continue
    const [year, month, day] = [Number(match[2]), Number(match[3]), Number(match[4])]
    const hadBirthday =
      now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day)
    const age = now.getUTCFullYear() - year - (hadBirthday ? 0 : 1)
    const monthName = MONTH_NAMES[language][month - 1] ?? ''
    return language === 'de'
      ? `${match[1]} ist ${age} Jahre alt (geboren am ${day}. ${monthName} ${year}).`
      : `${match[1]} is ${age} years old (born ${day} ${monthName} ${year}).`
  }
  return null
}

/** The opening of the article on the subject asked about, when `research` found one. */
function researchedDefinition(evidence: ReviewEvidence): string | null {
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'research') continue
    const text = DEFINITION.exec(result)?.[1]?.trim()
    if (text) return text
  }
  return null
}

/**
 * What the user sees after a forced lookup, or null when the model should
 * write it.
 *
 * An extract wins, and is written in code; so does the opening of the article
 * on exactly the thing a definition question asked about. Without either —
 * an explanation, anything that is not a name, a figure or a definition — the digest is
 * already in the conversation and the model answers from it, the same as a
 * turn in which it had called `research` itself. That used to be a refusal
 * or the first quoted passage, and the first passage for *dass oder das* was
 * about British orders of chivalry.
 */
export function settleResearch(
  evidence: ReviewEvidence,
  question: string,
  lookupError?: string,
  chosen?: string,
): string | null {
  const age = asksAge(question) ? ageReply(evidence, replyLanguageFor(question, chosen)) : null
  if (age) {
    const [source] = sourceUrls(evidence)
    return source ? `${age}\n\nSource: ${source}` : age
  }

  const extracted = formatResearchedReply(evidence, question, chosen)
  if (extracted) return extracted

  const definition = researchedDefinition(evidence)
  if (definition) {
    const [source] = sourceUrls(evidence)
    return source ? `${definition}\n\nSource: ${source}` : definition
  }

  // Off-topic pages are not something to write up — that is how a Hitler page
  // became the answer to a Macron follow-up. A digest with no passage sharing
  // a term with the query gets the refusal below instead of the model.
  if (digestOnTopic(evidence)) return null

  const german = replyLanguageFor(question, chosen) === 'de'
  if (lookupError) {
    return german
      ? `Das Nachschlagen hat nicht geklappt: ${lookupError}`
      : `The lookup failed: ${lookupError}`
  }
  return german ? 'Dazu habe ich keine verlässliche Antwort gefunden.' : 'I could not find a reliable answer.'
}

/**
 * The seeded tool call for this turn, and which answer is written in code.
 *
 * Research, arithmetic, opening, the weather and the clock all answer from the
 * tool, and small talk from the five things it can say. A sum the arithmetic skill claimed but that has no expression in it is
 * left for the model: there is nothing to evaluate, and forcing a refusal
 * would be worse than letting the exemplar try.
 */
export interface Grounding {
  seed?: ParsedToolCall[]
  groundFacts: boolean
  groundArithmetic: boolean
  groundOpen: boolean
  groundWeather: boolean
  groundClock: boolean
  groundSmallTalk: boolean
}

function hasTool(activation: ActivationLike | null, name: string): boolean {
  return activation?.tools.some((tool) => tool.schema.function.name === name) ?? false
}

export function groundingFor(
  activation: ActivationLike | null,
  message: string,
  prior: readonly TopicTurn[] = [],
): Grounding {
  const research = researchSeed(activation, message, prior)
  const arithmetic = arithmeticSeed(activation, message)
  const opened = openSeed(activation, message)
  const weather = weatherSeed(activation, message, prior)
  const clock = clockSeed(activation, message, prior)
  const seed = research ?? arithmetic ?? opened ?? weather ?? clock
  const skill = activation?.skill.name
  return {
    ...(seed ? { seed: [seed] } : {}),
    groundFacts: skill === RESEARCH_SKILL,
    groundArithmetic: arithmetic !== null,
    groundOpen: opened !== null,
    groundWeather: skill === WEATHER_SKILL && hasTool(activation, 'weather'),
    groundClock:
      (skill === WORLD_CLOCK_SKILL || skill === CURRENT_DATE_SKILL) && hasTool(activation, 'current_time'),
    groundSmallTalk: skill === CONVERSATION_SKILL,
  }
}
