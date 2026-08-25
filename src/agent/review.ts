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
export type ReviewCheck = 'wrong-number' | 'invented-source' | 'missing-source' | 'single-source'

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
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/g
const TRAILING_PUNCTUATION = /[.,;:!?]+$/

function findUrls(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map((match) => match[0].replace(TRAILING_PUNCTUATION, ''))
}

/** Evidence as it stands before the first tool has run. */
export function collectEvidence(turns: ChatTurn[]): ReviewEvidence {
  return {
    toolResults: [],
    knownUrls: turns
      .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
      .flatMap((turn) => findUrls(turn.content)),
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

/** The shape `calculator` returns: `expression = value`. */
const CALCULATION = /^(.+) = (-?\d[\d.]*(?:e[+-]?\d+)?)$/i

function calculations(evidence: ReviewEvidence): { expression: string; value: number }[] {
  const found: { expression: string; value: number }[] = []
  for (const { tool, result } of evidence.toolResults) {
    if (tool !== 'calculator') continue
    const match = CALCULATION.exec(result.trim())
    if (!match?.[1] || !match[2]) continue
    const value = Number(match[2])
    if (Number.isFinite(value)) found.push({ expression: match[1], value })
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
 * How many sources a turn has to have been given before citing one of them is
 * treated as citing too few.
 *
 * Three, not two, because two is the shape an ordinary search-then-read turn
 * produces: `web_search` returns a page and `read_page` opens it, and the answer
 * cites the page it read. Nagging for a second source there would fire on the
 * common case and teach the user to ignore the mechanism. `research` returns
 * five independent sources, and an answer that quotes one of them has dropped
 * the corroboration on purpose.
 */
const MIN_SOURCES_FOR_BREADTH = 3

function hostsOf(urls: string[]): Set<string> {
  return new Set(urls.flatMap((url) => locate(url)?.host ?? []))
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
    findings.push({
      check: 'wrong-number',
      instruction: `The calculator returned ${missed.expression} = ${missed.value}. Give that number, exactly as it came back.`,
    })
  }

  const source = preferredSource(evidence)
  const returned = evidence.toolResults.flatMap(({ result }) => findUrls(result))
  const known = [...evidence.knownUrls, ...returned]
    .map(locate)
    .filter((entry): entry is Located => entry !== null)

  const cited = findUrls(draft)
  const invented = cited.find((url) => {
    const located = locate(url)
    return located !== null && !isGrounded(located, known)
  })

  if (invented) {
    findings.push({
      check: 'invented-source',
      instruction: source
        ? `Nothing returned ${invented}. The source is ${source} — cite that one instead.`
        : `Nothing returned ${invented}. Drop that link; no source was fetched.`,
    })
    return findings
  }

  if (source && cited.length === 0 && !NOTHING_TO_CITE.test(draft)) {
    findings.push({
      check: 'missing-source',
      instruction: `The answer cites no source. End it with "Source: ${source}".`,
    })
    return findings
  }

  // Breadth, once grounding is settled. A turn handed five independent sources
  // and answering out of one has thrown away the only thing this app can offer
  // in place of a bigger model: the same claim, found twice.
  const offered = hostsOf(returned)
  const citedHosts = hostsOf(cited)
  if (citedHosts.size === 1 && offered.size >= MIN_SOURCES_FOR_BREADTH && !NOTHING_TO_CITE.test(draft)) {
    const second = returned.find((url) => {
      const host = locate(url)?.host
      return host !== undefined && !citedHosts.has(host)
    })
    if (second) {
      findings.push({
        check: 'single-source',
        instruction: `${offered.size} sources were returned and the answer cites one. Check it against ${second} and end with a "Sources:" line listing both.`,
      })
    }
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
