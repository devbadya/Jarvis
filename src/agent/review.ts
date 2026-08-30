import type { ChatTurn } from '@/llm/protocol'
import { localClockInResult } from '@/tools/clock'

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
export type ReviewCheck = 'wrong-number' | 'invented-source' | 'missing-source'

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

interface ClockTime {
  hour: number
  minute: number
}

function padTime(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Whether the answer stated a clock time at all.
 *
 * A year, a day of the month, or a German date like `27.08.2026` is not a
 * time. A dotted pair counts only when it is not the start of `dd.mm.yyyy`.
 * ISO `T20:40` counts — that is the UTC hour the model copied off the old
 * instant line.
 */
function statesAClockTime(answer: string): boolean {
  return (
    /(?:^|[^\d])(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(answer) ||
    // `27.08.2026` is a date; a dotted time has to be a real hour and not
    // sit in front of `.yyyy`.
    /(?<![\d.])(?:[01]?\d|2[0-3])\.[0-5]\d(?!\.\d)/.test(answer) ||
    /\b(?:[01]?\d|2[0-3])\s*Uhr\b/i.test(answer)
  )
}

function convertsMeridiem(answer: string, local: ClockTime): boolean {
  const meridiem = /(?:^|[^\d])(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/gi
  for (const match of answer.matchAll(meridiem)) {
    const hour = Number(match[1])
    const minute = Number(match[2])
    const afternoon = /^p/i.test(match[3] ?? '')
    if (minute !== local.minute || hour < 1 || hour > 12) continue
    const converted = afternoon ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour
    if (converted === local.hour) return true
  }
  return false
}

function statesLocalClock(answer: string, local: ClockTime): boolean {
  if (convertsMeridiem(answer, local)) return true

  const hours = [String(local.hour), padTime(local.hour)]
  const minutes = [String(local.minute), padTime(local.minute)]

  for (const hour of hours) {
    for (const minute of minutes) {
      if (new RegExp(`(?:^|[^\\d])${hour}:${minute}\\b`).test(answer)) return true
      if (new RegExp(`(?<![\\d.])${hour}\\.${minute}(?!\\.\\d)`).test(answer)) return true
      if (new RegExp(`\\b${hour}\\s*Uhr\\s*${minute}\\b`, 'i').test(answer)) return true
    }
    if (new RegExp(`\\b${hour}\\s*Uhr\\b`, 'i').test(answer)) return true
  }

  return false
}

function latestClock(evidence: ReviewEvidence): ClockTime | null {
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'current_time') continue
    const clock = localClockInResult(result)
    if (clock) return clock
  }
  return null
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
    findings.push({
      check: 'wrong-number',
      instruction: `The calculator returned ${missed.expression} = ${missed.value}. Give that number, exactly as it came back.`,
    })
  } else {
    // Shy when the reply states no time at all — "It is 2026" is a correct
    // year answer after a clock call. Fire only when it did quote an hour and
    // that hour is not the local one the tool put first.
    const clock = latestClock(evidence)
    if (clock && statesAClockTime(draft) && !statesLocalClock(draft, clock)) {
      const local = `${padTime(clock.hour)}:${padTime(clock.minute)}`
      findings.push({
        check: 'wrong-number',
        instruction: `The clock returned ${local} as the local time. Quote that hour and minute; do not convert them or use a UTC hour from the same moment.`,
      })
    }
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
