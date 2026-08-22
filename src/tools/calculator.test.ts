import { describe, expect, it } from 'vitest'
import { evaluateExpression } from './calculator'

describe('evaluateExpression', () => {
  it('respects operator precedence', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14)
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20)
  })

  it('treats exponentiation as right associative', () => {
    expect(evaluateExpression('2 ^ 3 ^ 2')).toBe(512)
  })

  it('handles unary minus', () => {
    expect(evaluateExpression('-4 + 10')).toBe(6)
    expect(evaluateExpression('3 * -2')).toBe(-6)
  })

  it('supports functions and constants', () => {
    expect(evaluateExpression('sqrt(16)')).toBe(4)
    expect(evaluateExpression('round(pi * 100)')).toBe(314)
  })

  it('rejects division by zero', () => {
    expect(() => evaluateExpression('1 / 0')).toThrow(/Division by zero/)
  })

  it('rejects unbalanced parentheses', () => {
    expect(() => evaluateExpression('(1 + 2')).toThrow(/closing parenthesis/)
  })

  it('refuses to execute arbitrary code', () => {
    expect(() => evaluateExpression('process.exit(1)')).toThrow()
    expect(() => evaluateExpression('globalThis')).toThrow(/Unknown function or constant/)
  })

  it('rejects trailing garbage', () => {
    expect(() => evaluateExpression('1 + 1 oops')).toThrow(/Unknown function or constant|trailing/)
  })
})
