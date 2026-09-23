import { describe, expect, it } from 'vitest'
import { calculator } from '@/tools/builtins'
import { arithmeticExpression, arithmeticSeed, settleArithmetic } from './arithmetic'
import { groundingFor } from './ground'

const arithmetic = { skill: { name: 'arithmetic' }, tools: [calculator] }

describe('arithmeticExpression', () => {
  it('reads an expression out of a question', () => {
    expect(arithmeticExpression('What is 98765 * 4321?')).toBe('98765 * 4321')
    expect(arithmeticExpression('Work out (17 * 23) / 4 exactly.')).toBe('(17 * 23) / 4')
    expect(arithmeticExpression('Calculate (17 * 23) / sqrt(2)')).toBe('(17 * 23) / sqrt(2)')
  })

  it('rewrites the sums people ask for in words', () => {
    expect(arithmeticExpression('How much is 18 percent of 2450?')).toBe('(2450 * 18 / 100)')
    expect(arithmeticExpression('What is 2 to the power of 20?')).toBe('2 ^ 20')
    expect(arithmeticExpression('Berechne 18 Prozent von 2450')).toBe('(2450 * 18 / 100)')
    expect(arithmeticExpression('What is the square root of 144?')).toBe('sqrt(144)')
    expect(arithmeticExpression('add 3 and 5')).toBe('(3 + 5)')
    expect(arithmeticExpression('17 times 23')).toBe('17 * 23')
    expect(arithmeticExpression('12 percent off 80')).toBe('(80 * (100 - 12) / 100)')
  })

  it('treats a German comma as a decimal and an English comma as thousands', () => {
    expect(arithmeticExpression('Was ist 3,5 * 2?')).toBe('3.5 * 2')
    expect(arithmeticExpression('What is 1,000 * 2?')).toBe('1000 * 2')
  })

  it('keeps a division by zero so the tool can report it', () => {
    expect(arithmeticExpression('What is 1 / 0?')).toBe('1 / 0')
  })

  it('has nothing to evaluate when the question is not a sum', () => {
    expect(arithmeticExpression('calculate the tip')).toBeNull()
    expect(arithmeticExpression('What is the capital of France?')).toBeNull()
    expect(arithmeticExpression('')).toBeNull()
  })
})

describe('arithmeticSeed', () => {
  it('seeds the calculator when that skill routed and a sum is there', () => {
    expect(arithmeticSeed(arithmetic, 'What is 2 + 2?')).toEqual({
      name: 'calculator',
      arguments: { expression: '2 + 2' },
    })
  })

  it('does not seed another skill, or a question with no sum', () => {
    expect(arithmeticSeed({ skill: { name: 'weather' }, tools: [calculator] }, 'What is 2 + 2?')).toBeNull()
    expect(arithmeticSeed(arithmetic, 'calculate the tip')).toBeNull()
    expect(arithmeticSeed({ skill: { name: 'arithmetic' }, tools: [] }, 'What is 2 + 2?')).toBeNull()
  })
})

describe('settleArithmetic', () => {
  it('quotes the calculator and does not round the number itself', () => {
    expect(
      settleArithmetic(
        { toolResults: [{ tool: 'calculator', result: '98765 * 4321 = 426763565' }], knownUrls: [] },
        'What is 98765 * 4321?',
      ),
    ).toBe('98765 * 4321 = 426763565.')
  })

  it('says the calculation failed, in the language of the question', () => {
    expect(settleArithmetic({ toolResults: [], knownUrls: [] }, 'What is 1 / 0?', 'Division by zero')).toBe(
      'Calculation failed: Division by zero',
    )
    expect(settleArithmetic({ toolResults: [], knownUrls: [] }, 'Was ist 1 / 0?', 'Division by zero')).toBe(
      'Rechnung fehlgeschlagen: Division by zero',
    )
  })
})

describe('groundingFor', () => {
  it('answers arithmetic from the tool and leaves a bare calculate to the model', () => {
    const grounded = groundingFor(arithmetic, 'What is 98765 * 4321?')
    expect(grounded.groundArithmetic).toBe(true)
    expect(grounded.groundFacts).toBe(false)
    expect(grounded.seed).toEqual([{ name: 'calculator', arguments: { expression: '98765 * 4321' } }])

    const open = groundingFor(arithmetic, 'calculate the tip')
    expect(open.groundArithmetic).toBe(false)
    expect(open.seed).toBeUndefined()
  })

  it('still grounds a research question', () => {
    const research = {
      skill: { name: 'research-question' },
      tools: [{ schema: { function: { name: 'research' } } }],
    }
    const grounded = groundingFor(research as never, 'Who wrote Dune?')
    expect(grounded.groundFacts).toBe(true)
    expect(grounded.groundArithmetic).toBe(false)
    expect(grounded.seed?.[0]?.name).toBe('research')
  })
})
