/**
 * Recursive-descent evaluator for arithmetic expressions.
 *
 * Deliberately not `eval`/`Function`: expressions arrive from model output, which
 * is attacker-influenceable whenever the model has read an untrusted web page.
 */

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }

/**
 * What the model writes, mapped onto what the parser reads.
 *
 * A rejected expression is not a neutral outcome: the round is spent, and the
 * model that gets `Unexpected trailing input` back usually answers from its own
 * arithmetic instead — which is the failure this tool exists to prevent. Of
 * eighteen expressions a 0.8B model plausibly produces, ten were refused, and
 * none of them for a reason the user would recognise: `98,765 * 4,321`,
 * `18% of 2450`, `(17 * 23) / 4 =`, `2 x 3`, `$1200 * 1.19`.
 *
 * So the shapes below are read rather than refused. Every one of them has a
 * single arithmetic meaning; anything genuinely ambiguous is left to fail.
 */
export function normalizeExpression(input: string): string {
  return (
    input
      .trim()
      // The model often echoes the question's own equals sign.
      .replace(/\s*=\s*\??\s*$/, '')
      // Currency is a unit, and this tool has none: the number is the argument.
      .replace(/[$€£¥]/g, '')
      // Operators as they are typed or pasted rather than as ASCII.
      .replace(/[×⋅·∗]/g, '*')
      .replace(/[÷∕]/g, '/')
      .replace(/[−–]/g, '-')
      // `x` between two numbers is a multiplication sign. It cannot be anything
      // else here, since the parser has no variables to confuse it with.
      .replace(/(\d)\s*[xX]\s*(?=[\d(.])/g, '$1*')
      // A comma in groups of exactly three digits is a thousands separator; one
      // followed by one or two is the decimal comma a German-speaking model
      // writes. `2,450` is read as two thousand four hundred and fifty on that
      // rule, which is what it means in the far commoner of the two locales.
      .replace(/(\d)(?:,(\d{3}))+(?![\d,])/g, (match) => match.replace(/,/g, ''))
      .replace(/(\d),(\d{1,2})(?![\d,])/g, '$1.$2')
      // A percentage of something, in either language. Parenthesised because
      // `20% of 300 + 50` must not become `20/100*300 + 50`'s cousin with the
      // addition pulled inside the fraction.
      .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent|per cent|prozent)\s+(?:of|von)\s+/gi, '($1 / 100) * ')
      // A trailing percentage — `2450 * 18%`. Only where no operand follows, so
      // `12 % 5` is still the modulo the tool documents.
      .replace(/(\d+(?:\.\d+)?)\s*%(?!\s*[\d(a-z])/gi, '($1 / 100)')
      .trim()
  )
}

/** Appended to the two failures a model can usually act on. */
const ARITHMETIC_ONLY = 'This tool evaluates arithmetic only, so write the sum out in numbers.'

export function evaluateExpression(rawInput: string): number {
  const input = normalizeExpression(rawInput)
  let position = 0

  const skipSpace = (): void => {
    while (position < input.length && /\s/.test(input[position]!)) position += 1
  }

  const consume = (token: string): boolean => {
    skipSpace()
    if (input.startsWith(token, position)) {
      position += token.length
      return true
    }
    return false
  }

  // expression := term (('+' | '-') term)*
  const parseExpression = (): number => {
    let value = parseTerm()
    for (;;) {
      if (consume('+')) value += parseTerm()
      else if (consume('-')) value -= parseTerm()
      else return value
    }
  }

  // term := factor (('*' | '/' | '%') factor)*
  const parseTerm = (): number => {
    let value = parseFactor()
    for (;;) {
      if (consume('*')) value *= parseFactor()
      else if (consume('/')) {
        const divisor = parseFactor()
        if (divisor === 0) throw new Error('Division by zero')
        value /= divisor
      } else if (consume('%')) {
        value %= parseFactor()
      } else return value
    }
  }

  // factor := unary ('^' factor)?  — right associative
  const parseFactor = (): number => {
    const base = parseUnary()
    if (consume('^')) return base ** parseFactor()
    return base
  }

  const parseUnary = (): number => {
    if (consume('-')) return -parseUnary()
    if (consume('+')) return parseUnary()
    return parsePrimary()
  }

  const parsePrimary = (): number => {
    skipSpace()
    if (consume('(')) {
      const value = parseExpression()
      if (!consume(')')) throw new Error('Missing closing parenthesis')
      return value
    }

    const number = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(input.slice(position))
    if (number) {
      position += number[0].length
      return Number(number[0])
    }

    const word = /^[a-zA-Z]+/.exec(input.slice(position))
    if (word) {
      const name = word[0].toLowerCase()
      position += word[0].length
      if (name in CONSTANTS) return CONSTANTS[name]!
      const fn = FUNCTIONS[name]
      if (!fn) throw new Error(`Unknown function or constant: ${word[0]}. ${ARITHMETIC_ONLY}`)
      if (!consume('(')) throw new Error(`Expected "(" after ${name}`)
      const argument = parseExpression()
      if (!consume(')')) throw new Error('Missing closing parenthesis')
      return fn(argument)
    }

    throw new Error(`Unexpected character at position ${position}`)
  }

  const result = parseExpression()
  skipSpace()
  if (position !== input.length) {
    throw new Error(`Unexpected trailing input: "${input.slice(position)}". ${ARITHMETIC_ONLY}`)
  }
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number')
  return result
}
