import type { ToolCall } from '@/types'

/**
 * What a tool call did, in words.
 *
 * The function name is the honest label and a poor one to lead with: a reader
 * skimming a transcript wants to know that the agent looked something up, not
 * which identifier the model typed. The name is still shown when the call is
 * opened, because that is where a mis-routed turn gets diagnosed.
 *
 * Only the tools this app ships are listed. An MCP server's tools are named by
 * whoever wrote them, and inventing a verb for one would be a guess.
 */
const PHRASES: Record<string, { running: string; done: string }> = {
  web_search: { running: 'Searching the web', done: 'Searched the web' },
  read_page: { running: 'Reading a page', done: 'Read a page' },
  research: { running: 'Researching', done: 'Researched' },
  calculator: { running: 'Calculating', done: 'Calculated' },
  current_time: { running: 'Checking the date', done: 'Checked the date' },
  weather: { running: 'Checking the weather', done: 'Checked the weather' },
  memory: { running: 'Using memory', done: 'Used memory' },
}

export function describeTool(name: string, status: ToolCall['status']): string {
  const phrase = PHRASES[name]
  if (!phrase) return name
  return status === 'pending' || status === 'running' ? phrase.running : phrase.done
}
