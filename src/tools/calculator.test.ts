import { describe, expect, it } from 'vitest'
import { evaluateExpression, normalizeExpression } from './calculator'

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

  it('says what the tool is for when it refuses', () => {
    // The message goes back into the model's context as the whole result of a
    // spent round, so it is the only chance to redirect the next attempt.
    expect(() => evaluateExpression('5 miles in km')).toThrow(/arithmetic only/)
  })
})

/**
 * Everything here was refused before, and every one of them is something the
 * model actually writes. A refusal costs the round and sends it back to mental
 * arithmetic, so being read correctly is the difference between an exact answer
 * and a confident wrong one.
 */
describe('expressions as the model writes them', () => {
  it.each([
    ['98,765 * 4,321', 426763565],
    ['1,234,567 + 1', 1234568],
    // The decimal comma, which is the same character in the other locale.
    ['18,5 * 2', 37],
    ['(17 * 23) / 4 =', 97.75],
    ['2 x 3', 6],
    ['7·8', 56],
    ['15 ÷ 3', 5],
    ['10 −4', 6],
    ['$1200 * 1.19', 1428],
    ['18% of 2450', 441],
    ['18 percent of 2450', 441],
    ['18 Prozent von 2450', 441],
    ['2450 * 18%', 441],
    // The addition must stay outside the fraction.
    ['20% of 300 + 50', 110],
  ])('reads %j as %d', (expression, expected) => {
    expect(evaluateExpression(expression)).toBeCloseTo(expected, 6)
  })

  it('leaves the modulo operator alone', () => {
    // `%` is documented as modulo, and only a percentage with no operand after
    // it is read as one hundredth.
    expect(evaluateExpression('12 % 5')).toBe(2)
    expect(evaluateExpression('12 % (2 + 3)')).toBe(2)
  })

  it.each([
    // A discount is not a percentage of the number beside it, and guessing
    // which would be a wrong answer rather than a refusal.
    '18% off 2450',
    // Unit conversion is not arithmetic, and no amount of reading helps.
    '5 miles in km',
    '32 fahrenheit in celsius',
  ])('still refuses %j', (expression) => {
    expect(() => evaluateExpression(expression)).toThrow()
  })
})

describe('normalizeExpression', () => {
  it('leaves an expression the parser already reads untouched', () => {
    expect(normalizeExpression('(2 + 3) * 4')).toBe('(2 + 3) * 4')
    expect(normalizeExpression('sqrt(16) ^ 2')).toBe('sqrt(16) ^ 2')
  })
})
