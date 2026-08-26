import { describe, expect, it } from 'vitest'
import { convertQuantity, formatQuantity, readConversionRequest } from './units'

describe('convertQuantity', () => {
  it.each([
    // The prompt this tool exists for: no skill routed it, the calculator
    // refused it, and the model did it in its head.
    [{ value: '32', from: 'fahrenheit', to: 'celsius' }, '32 °F = 0 °C'],
    [{ value: '100', from: 'celsius', to: 'fahrenheit' }, '100 °C = 212 °F'],
    [{ value: '0', from: 'celsius', to: 'kelvin' }, '0 °C = 273.15 K'],
    [{ value: '5', from: 'miles', to: 'km' }, '5 mi = 8.04672 km'],
    [{ value: '200', from: 'grams', to: 'ounces' }, '200 g = 7.05479 oz'],
    [{ value: '1', from: 'inch', to: 'cm' }, '1 in = 2.54 cm'],
    [{ value: '80', from: 'kg', to: 'lbs' }, '80 kg = 176.37 lb'],
    [{ value: '100', from: 'km/h', to: 'mph' }, '100 km/h = 62.1371 mph'],
    [{ value: '2', from: 'hectares', to: 'acres' }, '2 ha = 4.94211 acre'],
    [{ value: '1', from: 'GB', to: 'MiB' }, '1 GB = 953.674 MiB'],
    [{ value: '90', from: 'minutes', to: 'hours' }, '90 min = 1.5 h'],
    [{ value: '1.5', from: 'liters', to: 'cups' }, '1.5 l = 6.34013 cup'],
  ])('converts %o to %s', (args, expected) => {
    expect(convertQuantity(args)).toBe(expected)
  })

  it.each([
    // German, because the model passes the word the user wrote straight through.
    [{ value: '5', from: 'Meilen', to: 'Kilometer' }, '5 mi = 8.04672 km'],
    [{ value: '250', from: 'Gramm', to: 'Pfund' }, '250 g = 0.551156 lb'],
    [{ value: '30', from: 'Grad Celsius', to: 'Fahrenheit' }, '30 °C = 86 °F'],
    [{ value: '2', from: 'Zoll', to: 'cm' }, '2 in = 5.08 cm'],
  ])('reads the German %o as %s', (args, expected) => {
    expect(convertQuantity(args)).toBe(expected)
  })

  it('accepts the degree sign and the word both', () => {
    expect(convertQuantity({ value: '32', from: '°F', to: '°C' })).toBe('32 °F = 0 °C')
    expect(convertQuantity({ value: '32', from: 'degrees fahrenheit', to: 'celsius' })).toBe('32 °F = 0 °C')
  })

  it('refuses a conversion that depends on something it was not given', () => {
    // Grams to cups needs to know what is in the cup. An answer here would look
    // exact and be wrong, which is worse than the round it costs to say no.
    expect(() => convertQuantity({ value: '200', from: 'grams', to: 'cups' })).toThrow(
      /mass.*volume|volume.*mass/,
    )
  })

  it('names the unit it could not place', () => {
    expect(() => convertQuantity({ value: '5', from: 'smoots', to: 'm' })).toThrow(/Unknown unit "smoots"/)
  })

  it('refuses a value that is not a number', () => {
    expect(() => convertQuantity({ value: 'some', from: 'kg', to: 'lb' })).toThrow(/must be a number/)
  })
})

/**
 * The schema asks for three arguments, and a 0.8B model routinely sends the
 * whole phrase in one of them. Each shape below was worth reading rather than
 * rejecting: a rejection spends the tool round and teaches nothing.
 */
describe('readConversionRequest', () => {
  it.each([
    [{ value: '5 miles to km' }, { value: 5, from: 'miles', to: 'km' }],
    [{ value: '32 fahrenheit in celsius' }, { value: 32, from: 'fahrenheit', to: 'celsius' }],
    [{ value: '5 Meilen nach Kilometer' }, { value: 5, from: 'Meilen', to: 'Kilometer' }],
    [
      { value: '5 miles', to: 'km' },
      { value: 5, from: 'miles', to: 'km' },
    ],
    [
      { value: '5', from: '5 miles', to: 'km' },
      { value: 5, from: 'miles', to: 'km' },
    ],
    [
      { value: '1,5', from: 'm', to: 'cm' },
      { value: 1.5, from: 'm', to: 'cm' },
    ],
  ])('reads %o as %o', (args, expected) => {
    expect(readConversionRequest(args)).toEqual(expected)
  })

  it('converts what it read back out of a phrase', () => {
    expect(convertQuantity({ value: '5 miles to km' })).toBe('5 mi = 8.04672 km')
    expect(convertQuantity({ value: '32 fahrenheit in celsius' })).toBe('32 °F = 0 °C')
  })
})

describe('formatQuantity', () => {
  it('keeps six significant digits and drops the rest', () => {
    expect(formatQuantity(8.046719999999999)).toBe('8.04672')
    expect(formatQuantity(212)).toBe('212')
    expect(formatQuantity(0.5)).toBe('0.5')
  })

  it('falls back to exponent notation where a decimal would be unreadable', () => {
    expect(formatQuantity(0.00000123)).toBe('1.2300e-6')
  })
})
