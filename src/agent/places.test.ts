import { describe, expect, it } from 'vitest'
import { placeAsked } from './places'

describe('placeAsked', () => {
  it.each([
    ['Wie ist das Wetter in Berlin?', 'Berlin', 'Berlin'],
    ['Wie ist das Wetter in der Schweiz?', 'der Schweiz', 'Schweiz'],
    ['Wird es morgen in Lissabon regnen?', 'Lissabon', 'Lissabon'],
    ['Wetter in Berlin in drei Tagen', 'Berlin', 'Berlin'],
    ['Wetter in Frankfurt am Main', 'Frankfurt am Main', 'Frankfurt am Main'],
    ['Wie spät ist es in Tokio?', 'Tokio', 'Tokio'],
    ['what time is it in the UK', 'the UK', 'UK'],
    ['Wetter Hamburg', 'Hamburg', 'Hamburg'],
    ['Berlin weather?', 'Berlin', 'Berlin'],
    ['Wie warm ist es heute in Köln?', 'Köln', 'Köln'],
  ])('finds the place in %j', (message, display, query) => {
    expect(placeAsked(message)).toEqual({ display, query })
  })

  it.each([
    'Wie ist das Wetter?',
    'Regnet es?',
    "How's the weather looking?",
    'Wie spät ist es?',
    'Welcher Tag ist heute?',
    'Welches Jahr haben wir?',
    'und morgen?',
    'Brauche ich einen Schirm?',
  ])('finds no place in %j', (message) => {
    expect(placeAsked(message)).toBeNull()
  })
})
