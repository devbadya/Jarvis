import { trimTrailingPunctuation } from './rich-text'

/**
 * Every skill exemplar in `src/skills` ends its answer with a bare
 * `Source: https://…`, and `reviewAnswer` checks for one, so most replies that
 * used the web carry a citation line. Left in the prose it is the least
 * readable part of the reply and the most useful, which is what a citation pill
 * is for.
 *
 * Nothing is rewritten: the line is recognised and moved, and `content` — what
 * gets copied, checked and sent back as history — is untouched.
 */
export interface CitedAnswer {
  /** The reply with its citation line lifted out, if it had one. */
  body: string
  /** The URLs that line listed, in the order the model wrote them. */
  sources: string[]
}

/** Tolerates the emphasis an instruct model puts on a label it was asked for. */
const CITATION_LABEL = /^[ \t]*\*{0,2}[ \t]*sources?[ \t]*\*{0,2}[ \t]*:[ \t]*\*{0,2}[ \t]*/i
const TRAILING_EMPHASIS = /[ \t]*\*{0,2}[ \t]*$/
const SEPARATORS = /[\s,;]+/
const NOTHING_BUT_URL = /^https?:\/\/\S+$/

export function splitSources(text: string): CitedAnswer {
  const lines = text.split('\n')
  const last = lines.findLastIndex((line) => line.trim() !== '')
  if (last === -1) return { body: text, sources: [] }

  const line = lines[last] ?? ''
  if (!CITATION_LABEL.test(line)) return { body: text, sources: [] }

  const listed = line
    .replace(CITATION_LABEL, '')
    .replace(TRAILING_EMPHASIS, '')
    .split(SEPARATORS)
    .map(trimTrailingPunctuation)
    .filter(Boolean)

  // Only a line that is nothing but URLs is a citation. "Source: the model's
  // own memory" is a sentence, and hiding a sentence behind a pill that cannot
  // be clicked would lose the answer a piece of itself.
  if (listed.length === 0 || !listed.every((url) => NOTHING_BUT_URL.test(url))) {
    return { body: text, sources: [] }
  }

  return { body: lines.slice(0, last).join('\n').trimEnd(), sources: [...new Set(listed)] }
}

/** What a citation pill says. The rest of the URL is the link. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
