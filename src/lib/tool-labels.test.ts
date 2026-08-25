import { describe, expect, it } from 'vitest'
import { describeTool } from './tool-labels'

describe('describeTool', () => {
  it('speaks in the present tense while the call is in flight', () => {
    expect(describeTool('web_search', 'running')).toBe('Searching the web')
    expect(describeTool('web_search', 'pending')).toBe('Searching the web')
  })

  it('speaks in the past tense once it is over, however it ended', () => {
    expect(describeTool('read_page', 'done')).toBe('Read a page')
    expect(describeTool('read_page', 'error')).toBe('Read a page')
  })

  // The row is the only place the difference between one search and a call that
  // spends six reader requests is visible before it is opened.
  it('distinguishes researching several sources from a single search', () => {
    expect(describeTool('research', 'running')).toBe('Researching several sources')
    expect(describeTool('research', 'done')).toBe('Researched several sources')
  })

  it('leaves a tool it does not ship under its own name', () => {
    expect(describeTool('acme_create_ticket', 'done')).toBe('acme_create_ticket')
  })
})
