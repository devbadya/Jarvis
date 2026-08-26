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
export type ReviewCheck = 'wrong-number' | 'unsupported-figure' | 'invented-source' | 'missing-source'

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
  /**
   * The turn was routed to a skill that answers out of a source, and the answer
   * cites none. Not a finding, because no correction can fix it — a label, so
   * the reply does not pass for research it never did.
   */
  unsourced?: boolean
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
  /**
   * Figures the user themselves put in the conversation. A number they supplied
   * is not the model's invention, and asking it to justify their own figure
   * against a search result would fire on a correct answer.
   */
  knownFigures: string[]
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/g
const TRAILING_PUNCTUATION = /[.,;:!?]+$/

export function findUrls(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map((match) => match[0].replace(TRAILING_PUNCTUATION, ''))
}

/** Evidence as it stands before the first tool has run. */
export function collectEvidence(turns: ChatTurn[]): ReviewEvidence {
  const spoken = turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant')

  return {
    toolResults: [],
    knownUrls: spoken.flatMap((turn) => findUrls(turn.content)),
    // Figures come from the user's turns alone, where the URLs come from both.
    // A skill's worked example is an assistant turn, and taking figures from it
    // would whitelist the example's own numbers on every turn that skill wins.
    knownFigures: turns.filter((turn) => turn.role === 'user').flatMap((turn) => figuresIn(turn.content)),
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

const NUMBER_IN_TEXT = /\d[\d.,]*/g

/** `60 732` is one number written with a space, not a 60 next to a 732. */
const SPACED_THOUSANDS = /(\d)[\s\u00a0](?=\d{3}\b)/g

/**
 * Only a plain integer of three digits or more counts as a figure here, and
 * that narrowness is the whole point.
 *
 * This check compares against a corpus rather than against one tool result, so
 * every way a number can legitimately be written differently is a way for it to
 * fire on a correct answer — which the repository treats as a bug rather than as
 * a strict setting. So everything ambiguous is skipped:
 *
 * - **Anything with a separator or a decimal point.** `46,700` and `46.700` are
 *   the same figure, `81.6` is a fair rounding of `81.62`, and a rule that has
 *   to decide which is which will sometimes decide wrongly. A thousands group
 *   written with a space is joined up first, or `60 732` would arrive as a `60`
 *   and a `732` and the `732` would be reported as an invention.
 * - **One and two digit numbers.** An age is the clearest case: a source gives
 *   1889 and 1945 and never gives 56, so a correct age appears in no evidence.
 *   The cost is that a two-digit invention is missed; `142` is not.
 * - **Anything inside a URL**, which is a path and not a claim.
 *
 * What is left is years and the large round figures a model invents when it is
 * filling a gap, which is what this exists for.
 */
export function figuresIn(text: string): string[] {
  const prose = text.replace(URL_IN_TEXT, ' ').replace(SPACED_THOUSANDS, '$1,')

  return [...prose.matchAll(NUMBER_IN_TEXT)]
    .map((match) => match[0].replace(TRAILING_PUNCTUATION, ''))
    .filter((figure) => /^\d{3,}$/.test(figure))
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
/** Every URL the turn is entitled to cite, located for comparison. */
function groundedUrls(evidence: ReviewEvidence): Located[] {
  return [...evidence.knownUrls, ...evidence.toolResults.flatMap(({ result }) => findUrls(result))]
    .map(locate)
    .filter((entry): entry is Located => entry !== null)
}

/**
 * Whether an answer that was supposed to come from a source came from one.
 *
 * This is not a finding, and deliberately so: it cannot be corrected. The
 * correction round runs with no tools, so asking the model to go and cite
 * something would spend a generation to arrive back here. It is a label, and
 * what it labels is the case every other check is blind to — a factual question
 * answered out of the model's memory, which reaches the screen looking exactly
 * like a researched one.
 */
export function isUnsourced(answer: string, evidence: ReviewEvidence): boolean {
  const draft = answer.trim()
  if (!draft) return false

  // A clarifying question and a plain "I could not find it" are answers that
  // claim nothing, so there is nothing to have sourced.
  if (NOTHING_TO_CITE.test(draft)) return false

  // Something was fetched. Whether the answer went on to cite it is
  // `missing-source` — a different fault, with a fix, and saying "answered from
  // memory" about a turn that ran a search would simply be untrue.
  if (preferredSource(evidence) !== null) return false

  const known = groundedUrls(evidence)
  return !findUrls(draft).some((url) => {
    const cited = locate(url)
    return cited !== null && isGrounded(cited, known)
  })
}

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

  // Only where there is something to check against. With no tool result every
  // figure in the answer is unsupported, and saying so would amount to telling
  // the model off for answering — which is what `isUnsourced` reports instead.
  if (evidence.toolResults.length > 0) {
    const supported = new Set([
      ...evidence.toolResults.flatMap(({ result }) => figuresIn(result)),
      ...evidence.knownFigures,
    ])
    const unsupported = figuresIn(draft).find((figure) => !supported.has(figure))

    // Without this, the only finding on "he lived to 142" was that it cited
    // nothing — so the correction appended a real source to a made-up number,
    // which is worse than leaving it uncited.
    if (unsupported) {
      findings.push({
        check: 'unsupported-figure',
        instruction: `No source gives ${unsupported}. Drop that figure, or replace it with one the results above state.`,
      })
    }
  }

  const source = preferredSource(evidence)
  const known = groundedUrls(evidence)

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
