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

  // A reply that is nothing but its citation keeps it. Lifting the only line
  // out would leave a row of pills where the answer should be.
  const body = lines.slice(0, last).join('\n').trimEnd()
  if (!body) return { body: text, sources: [] }

  return { body, sources: [...new Set(listed)] }
}

/** What a citation pill says. The rest of the URL is the link. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The last meaningful piece of the path, for telling two pages on one site apart. */
function pageOf(url: string): string {
  try {
    const { pathname, search } = new URL(url)
    const segment = pathname.split('/').filter(Boolean).at(-1)
    return segment ?? search.replace(/^\?/, '')
  } catch {
    return ''
  }
}

export interface SourceLabel {
  url: string
  label: string
}

/**
 * Names each citation.
 *
 * The site alone is what a reader wants, right up to the point where a turn
 * read three pages of the same one — then three links called "example.com" tell
 * them nothing and give a screen reader nothing to distinguish either. The page
 * is added only where the site does not already say it, so the common case
 * stays short.
 */
export function labelSources(urls: string[]): SourceLabel[] {
  const counts = new Map<string, number>()
  for (const url of urls) counts.set(domainOf(url), (counts.get(domainOf(url)) ?? 0) + 1)

  return urls.map((url) => {
    const domain = domainOf(url)
    const page = (counts.get(domain) ?? 0) > 1 ? pageOf(url) : ''
    return { url, label: page ? `${domain}/${page}` : domain }
  })
}
