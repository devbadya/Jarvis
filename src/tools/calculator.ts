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

export function evaluateExpression(input: string): number {
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
      if (!fn) throw new Error(`Unknown function or constant: ${word[0]}`)
      if (!consume('(')) throw new Error(`Expected "(" after ${name}`)
      const argument = parseExpression()
      if (!consume(')')) throw new Error('Missing closing parenthesis')
      return fn(argument)
    }

    throw new Error(`Unexpected character at position ${position}`)
  }

  const result = parseExpression()
  skipSpace()
  if (position !== input.length) throw new Error(`Unexpected trailing input: "${input.slice(position)}"`)
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number')
  return result
}
