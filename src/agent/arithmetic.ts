import type { Tool } from '@/tools/types'
import { evaluateExpression } from '@/tools/calculator'
import { replyLanguageFor, type ReplyLanguage } from './language'
import type { ReviewEvidence } from './review'
import type { ParsedToolCall } from './parse'

/**
 * The arithmetic skill's name. Routing already decided this turn is a sum;
 * what follows only runs when that skill won and `calculator` is actually there.
 */
export const ARITHMETIC_SKILL = 'arithmetic'

interface SkillTools {
  skill: { name: string }
  tools: Tool[]
}

/**
 * Turn the ways people ask for a sum into something `calculator` can evaluate.
 *
 * Word problems the skill claims — *18 percent of 2450*, *2 to the power of
 * 20*, *18 Prozent von 2450* — never contain an operator, so a scan for `+`
 * would miss exactly the questions the model used to invent an answer for.
 * Phrases are rewritten first; the scan then keeps the longest slice the
 * calculator accepts.
 */
function normalizeArithmetic(input: string): string {
  let text = input.replace(/[×⋅∙]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').replace(/\*\*/g, '^')

  // `1,000` is a thousands separator; `3,5` is a German decimal. A comma
  // followed by exactly three digits is the first, and one followed by one
  // or two digits is the second. Dots stay decimal points.
  while (/(\d),(?=\d{3}(?!\d))/.test(text)) {
    text = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
  }
  text = text.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')

  text = text.replace(/\bto the power of\b/gi, '^')
  text = text.replace(/\bhoch\b/gi, '^')
  text = text.replace(/\bmultiplied by\b/gi, '*')
  text = text.replace(/\btimes\b/gi, '*')
  text = text.replace(/\bgeteilt durch\b/gi, '/')
  text = text.replace(/\bdivided by\b/gi, '/')
  text = text.replace(/\bmal\b/gi, '*')
  text = text.replace(/\bplus\b/gi, '+')
  text = text.replace(/\bminus\b/gi, '-')
  text = text.replace(/\bmodulo\b/gi, '%')
  text = text.replace(/(?<=\d)\s*x\s*(?=\d)/gi, ' * ')

  text = text.replace(
    /(\d+(?:\.\d+)?)\s*(?:percent|per cent|prozent|%)\s*(?:of|von)\s*(\d+(?:\.\d+)?)/gi,
    '($2 * $1 / 100)',
  )
  text = text.replace(
    /(\d+(?:\.\d+)?)\s*(?:percent|per cent|prozent|%)\s*off\s*(\d+(?:\.\d+)?)/gi,
    '($2 * (100 - $1) / 100)',
  )
  text = text.replace(
    /(?:square root of|sqrt of|quadratwurzel von|wurzel aus)\s*(\d+(?:\.\d+)?)/gi,
    'sqrt($1)',
  )
  text = text.replace(/(\d+(?:\.\d+)?)\s*squared\b/gi, '($1 ^ 2)')
  text = text.replace(/(\d+(?:\.\d+)?)\s*cubed\b/gi, '($1 ^ 3)')
  text = text.replace(/(\d+(?:\.\d+)?)\s*(?:im quadrat|zum quadrat)\b/gi, '($1 ^ 2)')
  text = text.replace(
    /\b(?:add|addiere)\s+(\d+(?:\.\d+)?)\s+(?:and|to|und|zu)\s+(\d+(?:\.\d+)?)/gi,
    '($1 + $2)',
  )

  return text
}

const EXPRESSION_CHAR = /[\d\s.+\-*/^%(),a-z]/i

function isExpressionStart(text: string, index: number): boolean {
  if (index > 0 && /[A-Za-z0-9.]/.test(text[index - 1]!)) return false
  const rest = text.slice(index)
  return (
    /^(?:sqrt|abs|ln|log|sin|cos|tan|round|floor|ceil|pi)\b/i.test(rest) ||
    /^\d/.test(rest) ||
    rest.startsWith('(') ||
    /^-\d/.test(rest) ||
    rest.startsWith('-(')
  )
}

/** A bare number is not a sum. Division by zero still is — the tool reports it. */
function acceptableExpression(slice: string): boolean {
  try {
    evaluateExpression(slice)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return message === 'Division by zero' || message === 'Result is not a finite number'
  }
}

function looksLikeMath(expression: string): boolean {
  return /[+\-*/^%]|\b(?:sqrt|abs|ln|log|sin|cos|tan|round|floor|ceil)\s*\(/i.test(expression)
}

/**
 * The calculator expression in this message, or null when there isn't one.
 *
 * Null is a real outcome: the arithmetic skill also claims the bare word
 * *calculate*, and *calculate the tip* has nothing to evaluate. Those turns
 * stay with the model. A question that does contain a sum does not.
 */
export function arithmeticExpression(message: string): string | null {
  const text = normalizeArithmetic(message)
  let best: string | null = null

  for (let start = 0; start < text.length; start++) {
    if (!isExpressionStart(text, start)) continue
    let end = start + 1
    while (end < text.length && EXPRESSION_CHAR.test(text[end]!)) end += 1

    for (let stop = end; stop > start + 1; stop--) {
      const slice = text
        .slice(start, stop)
        .trim()
        .replace(/[?.!,;:]+$/g, '')
        .trim()
      if (!looksLikeMath(slice) || !acceptableExpression(slice)) continue
      const compact = slice.replace(/\s+/g, ' ')
      if (!best || compact.length > best.length) best = compact
      break
    }
  }

  return best
}

/** The forced `calculator` call, or null when this turn is not that skill or has no sum. */
export function arithmeticSeed(activation: SkillTools | null, message: string): ParsedToolCall | null {
  if (activation?.skill.name !== ARITHMETIC_SKILL) return null
  if (!activation.tools.some((tool) => tool.schema.function.name === 'calculator')) return null
  const expression = arithmeticExpression(message)
  if (!expression) return null
  return { name: 'calculator', arguments: { expression } }
}

const CALCULATION = /^(.+) = (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i

const PERCENT_OF = /(\d+(?:[.,]\d+)?)\s*(?:%|prozent|percent|per cent)\s*(?:von|of)\s*(\d+(?:[.,]\d+)?)/i

function formatNumber(value: number, language: ReplyLanguage): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return String(value)
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 10 }).format(
    value,
  )
}

/** `(240 * 15 / 100)` as `240 × 15 / 100`, with the reply language's decimal mark. */
function formatExpression(expression: string, language: ReplyLanguage): string {
  let text = expression.trim()
  while (/^\((.*)\)$/.test(text) && balanced(text.slice(1, -1))) text = text.slice(1, -1).trim()
  text = text
    .replace(/\s*\*\s*/g, ' × ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
  return language === 'de' ? text.replace(/(\d)\.(\d)/g, '$1,$2') : text
}

function balanced(text: string): boolean {
  let depth = 0
  for (const char of text) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth < 0) return false
  }
  return depth === 0
}

/** The calculator's line as the reply: `240 × 15 / 100 = 36`, or a sentence for a percentage. */
export function arithmeticReply(result: string, question: string, language: ReplyLanguage): string {
  const match = CALCULATION.exec(result.trim())
  if (!match?.[1] || !match[2]) return result.endsWith('.') ? result : `${result}.`
  const value = formatNumber(Number(match[2]), language)

  const percent = PERCENT_OF.exec(question)
  if (percent?.[1] && percent[2]) {
    const share = formatNumber(Number(percent[1].replace(',', '.')), language)
    const whole = formatNumber(Number(percent[2].replace(',', '.')), language)
    return language === 'de' ? `${share} % von ${whole} sind ${value}.` : `${share}% of ${whole} is ${value}.`
  }
  return `${formatExpression(match[1], language)} = ${value}`
}

/**
 * What the user sees after a forced calculation, without another generation.
 *
 * The tool's own line is the answer. Asking the model to copy the number is
 * how `98765 * 4321` came back wrong the times it never called the calculator.
 */
export function settleArithmetic(
  evidence: ReviewEvidence,
  question: string,
  error?: string,
  chosen?: string,
): string {
  const language = replyLanguageFor(question, chosen)
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'calculator') continue
    return arithmeticReply(result, question, language)
  }

  const german = language === 'de'
  if (error) return german ? `Das konnte ich nicht ausrechnen: ${error}` : `Calculation failed: ${error}`
  return german ? 'Dazu kann ich nichts ausrechnen.' : 'I could not calculate that.'
}
