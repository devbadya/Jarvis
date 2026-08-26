import { describe, expect, it } from 'vitest'
import { describeTool } from './tool-labels'

describe('describeTool', () => {
  it('speaks in the present tense while the call is in flight', () => {
    expect(describeTool('web_search', 'running')).toBe('Searching the web')
    expect(describeTool('web_search', 'pending')).toBe('Searching the web')
  })

  it('speaks in the past tense once it is over, however it ended', () => {
    expect(describeTool('research', 'running')).toBe('Researching')
    expect(describeTool('research', 'done')).toBe('Researched')
  })

  it('leaves a tool it does not ship under its own name', () => {
    expect(describeTool('acme_create_ticket', 'done')).toBe('acme_create_ticket')
  })
})
