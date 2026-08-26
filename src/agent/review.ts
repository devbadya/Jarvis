import type { ChatTurn } from '@/llm/protocol'

/**
 * Checking an answer before it is shown.
 *
 * Every check here is deterministic, and that is the whole design. Asking the
 * model to re-read its own answer and grade it spends exactly the capacity the
 * answer needed, and intrinsic self-correction — re-grading with no new
 * information — makes reasoning worse rather than better (arXiv:2310.01798).
 * What does work is external feedback, so each check compares the draft against
 * something already in the context: a tool result, or a URL somebody supplied.
 * The model is then told what to change rather than asked to look for it.
 *
 * The checks are also deliberately shy. A check that fires on a correct answer
 * costs a second generation and teaches the user to ignore the whole mechanism,
 * so every one of them prefers to miss a mistake over inventing one.
 */
export type ReviewCheck = 'wrong-number' | 'invented-source' | 'missing-source' | 'wrong-language'

export interface ReviewFinding {
  check: ReviewCheck
  /** Handed to the model verbatim, so it states the fix and nothing else. */
  instruction: string
}

export interface ReviewOutcome {
  /** What the check found in the first draft. Empty when the draft passed. */
  found: ReviewCheck[]
  /** True when a corrected answer replaced the draft. */
  corrected: boolean
}

export interface ReviewEvidence {
  /** Results this turn's tool calls returned, in the order they came back. */
  toolResults: { tool: string; result: string }[]
  /**
   * URLs already in play: the ones the user wrote and the ones earlier replies
   * cited. A follow-up question runs no tools, and repeating the source of the
   * answer above must not read as an invention.
   */
  knownUrls: string[]
  /** What the user asked, which is what the answer's language is checked against. */
  question: string
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/g
const TRAILING_PUNCTUATION = /[.,;:!?]+$/

export function findUrls(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map((match) => match[0].replace(TRAILING_PUNCTUATION, ''))
}

/** Evidence as it stands before the first tool has run. */
export function collectEvidence(turns: ChatTurn[]): ReviewEvidence {
  return {
    toolResults: [],
    knownUrls: turns
      .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
      .flatMap((turn) => findUrls(turn.content)),
    // The last real user turn, which is the one being answered. Exemplar turns a
    // skill contributed sit ahead of it and are written in the skill's language,
    // not the user's.
    question: turns.findLast((turn) => turn.role === 'user')?.content ?? '',
  }
}

interface Located {
  host: string
  path: string
}

function locate(url: string): Located | null {
  try {
    const parsed = new URL(url)
    return { host: parsed.host.toLowerCase(), path: parsed.pathname.replace(/\/+$/, '').toLowerCase() }
  } catch {
    return null
  }
}

/**
 * Same host, and one path a prefix of the other by whole segments.
 *
 * Lenient on purpose: citing the site when the tool returned a page on it is
 * close enough. A different host, or an invented path on the right one, is not.
 */
function isGrounded(cited: Located, known: Located[]): boolean {
  return known.some(
    (source) =>
      source.host === cited.host &&
      (`${cited.path}/`.startsWith(`${source.path}/`) || `${source.path}/`.startsWith(`${cited.path}/`)),
  )
}

/**
 * The shape both computing tools return: `expression = value`, with a unit after
 * the value where `convert` produced it — `5 mi = 8.04672 km`.
 */
const CALCULATION = /^(.+) = (-?\d[\d.]*(?:e[+-]?\d+)?)(?:\s+\S{1,10})?$/i

/** The tools whose result is a number the answer is then expected to state. */
const COMPUTED = new Set(['calculator', 'convert'])

function calculations(evidence: ReviewEvidence): { tool: string; expression: string; value: number }[] {
  const found: { tool: string; expression: string; value: number }[] = []
  for (const { tool, result } of evidence.toolResults) {
    if (!COMPUTED.has(tool)) continue
    const match = CALCULATION.exec(result.trim())
    if (!match?.[1] || !match[2]) continue
    const value = Number(match[2])
    if (Number.isFinite(value)) found.push({ tool, expression: match[1], value })
  }
  return found
}

/** Model output puts thousands separators in unpredictable places. */
const SEPARATORS = /[,\s_'’]/g

/**
 * Every rendering of a number the answer may use.
 *
 * Quoting a long decimal to fewer places is not an error, so each precision the
 * model might have rounded to counts as a match. Integers are not rounded in
 * turn: it would make `0` an acceptable rendering of `0.4` and then match the
 * first zero anywhere in the answer.
 */
function renderings(value: number): string[] {
  const exact = String(value)
  if (exact.includes('e')) return [exact]

  const all = new Set([exact])
  if (!Number.isInteger(value)) {
    for (let places = 1; places <= 6; places += 1) all.add(value.toFixed(places))
  }
  return [...all]
}

function statesNumber(answer: string, value: number): boolean {
  const digits = answer.replace(SEPARATORS, '')
  return renderings(value).some((rendering) => digits.includes(rendering))
}

/**
 * Which language a turn is written in, or nothing.
 *
 * The system prompt asks for the language the user wrote in, and a 0.8B model
 * drifts back to English mid-conversation — the most visible way this app is
 * wrong, and the one thing a check can settle without a model: the evidence is
 * the user's own message.
 *
 * Two languages, because those are the two the app is used in and the two whose
 * function words are worth listing. A question in a third language leaves both
 * scores low, `detectLanguage` answers `null`, and the check stands down rather
 * than guessing — the same shyness every check here has.
 */
const GERMAN_LETTERS = /[äöüß]/i

const GERMAN_WORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'ein',
  'eine',
  'und',
  'oder',
  'aber',
  'nicht',
  'ist',
  'sind',
  'war',
  'waren',
  'hat',
  'haben',
  'wird',
  'werden',
  'kann',
  'ich',
  'du',
  'wir',
  'ihr',
  'mit',
  'auf',
  'aus',
  'bei',
  'nach',
  'von',
  'vor',
  'zum',
  'zur',
  'wie',
  'was',
  'wer',
  'wann',
  'warum',
  'auch',
  'noch',
  'schon',
  'sehr',
  'etwa',
  'ungefähr',
  'heute',
  'morgen',
  'liegt',
  'beträgt',
  'derzeit',
  'quelle',
])

const ENGLISH_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'not',
  'is',
  'are',
  'was',
  'were',
  'has',
  'have',
  'will',
  'would',
  'can',
  'i',
  'you',
  'we',
  'they',
  'with',
  'from',
  'about',
  'into',
  'of',
  'to',
  'for',
  'how',
  'what',
  'who',
  'when',
  'why',
  'also',
  'still',
  'very',
  'roughly',
  'about',
  'today',
  'tomorrow',
  'currently',
  'source',
])

/** Enough markers to be a language rather than a coincidence. */
const MIN_LANGUAGE_MARKERS = 3

export type Language = 'de' | 'en'

export function detectLanguage(text: string): Language | null {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? []
  let german = 0
  let english = 0
  for (const word of words) {
    if (GERMAN_WORDS.has(word)) german += 1
    if (ENGLISH_WORDS.has(word)) english += 1
  }
  // An umlaut or an eszett is worth a function word on its own, which is what
  // lets a short German sentence be recognised at all.
  if (GERMAN_LETTERS.test(text)) german += 1

  if (german >= MIN_LANGUAGE_MARKERS && german > english) return 'de'
  if (english >= MIN_LANGUAGE_MARKERS && english > german) return 'en'
  return null
}

/** Handed to the model in the language it should have used. */
const LANGUAGE_INSTRUCTION: Record<Language, string> = {
  de: 'Die Frage war auf Deutsch. Antworte auf Deutsch.',
  en: 'The question was in English. Answer in English.',
}

/** A question back to the user, and a plain "I could not find it", cite nothing. */
const NOTHING_TO_CITE = /\?\s*$|\b(could ?n[o']t find|no results|don'?t know|do not know|unable to find)\b/i

/** The most recent URL a tool returned, which is the one worth citing. */
function preferredSource(evidence: ReviewEvidence): string | null {
  for (const { result } of [...evidence.toolResults].reverse()) {
    const [first] = findUrls(result)
    if (first) return first
  }
  return null
}

/**
 * Reads a draft answer against the evidence and returns what needs fixing.
 *
 * An empty list means the answer goes out as written, which is the common case.
 */
export function reviewAnswer(answer: string, evidence: ReviewEvidence): ReviewFinding[] {
  const draft = answer.trim()
  if (!draft) return []

  const findings: ReviewFinding[] = []

  // One number is enough to correct: a reply that dropped the calculator's
  // result has the same fix however many sums it dropped.
  const missed = calculations(evidence).find(({ value }) => !statesNumber(draft, value))
  if (missed) {
    const source = missed.tool === 'convert' ? 'The conversion' : 'The calculator'
    findings.push({
      check: 'wrong-number',
      instruction: `${source} returned ${missed.expression} = ${missed.value}. Give that number, exactly as it came back.`,
    })
  }

  const source = preferredSource(evidence)
  const known = [...evidence.knownUrls, ...evidence.toolResults.flatMap(({ result }) => findUrls(result))]
    .map(locate)
    .filter((entry): entry is Located => entry !== null)

  const invented = findUrls(draft).find((url) => {
    const cited = locate(url)
    return cited !== null && !isGrounded(cited, known)
  })

  if (invented) {
    findings.push({
      check: 'invented-source',
      instruction: source
        ? `Nothing returned ${invented}. The source is ${source} — cite that one instead.`
        : `Nothing returned ${invented}. Drop that link; no source was fetched.`,
    })
  } else if (source && findUrls(draft).length === 0 && !NOTHING_TO_CITE.test(draft)) {
    findings.push({
      check: 'missing-source',
      instruction: `The answer cites no source. End it with "Source: ${source}".`,
    })
  }

  // Both have to be recognisable for this to fire, so a one-line answer, a
  // number, and anything in a language this cannot read are all left alone.
  const asked = detectLanguage(evidence.question)
  const answered = detectLanguage(draft)
  if (asked && answered && asked !== answered) {
    findings.push({ check: 'wrong-language', instruction: LANGUAGE_INSTRUCTION[asked] })
  }

  return findings
}

/**
 * The turn that asks for the fix.
 *
 * It states the correction instead of inviting the model to hunt for one, and
 * everything in it comes from a tool result the model has already seen.
 */
export function correctionPrompt(findings: ReviewFinding[]): string {
  const instructions = findings.map((finding) => finding.instruction).join(' ')
  return `${instructions} Reply with the corrected answer only.`
}
