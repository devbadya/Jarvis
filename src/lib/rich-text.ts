/**
 * A deliberately small reader for the markup a chat reply actually contains.
 *
 * Two things put it here. Every skill exemplar in `src/skills` ends its answer
 * with a bare `Source: https://…`, so the app asks the model for a URL on most
 * turns and then renders it as text nobody can click. And an instruct-tuned
 * model reaches for `**bold**`, `- ` lists and fenced code whether or not the
 * prompt invites it, which arrived on screen as punctuation.
 *
 * It is not a Markdown implementation and should not grow into one. It reads a
 * flat block structure and four inline forms; anything it does not recognise
 * stays literal, which is the same thing the app did before. Output is a tree
 * of plain data that the caller turns into React elements, so no string ever
 * becomes HTML and there is nothing here for a sanitiser to do.
 *
 * Emphasis with single asterisks is left out on purpose: the calculator tool
 * means `17 * 23 * 2` is a plausible reply, and reading that as italics would
 * be worse than reading nothing.
 */

export type Span =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'link'; href: string; text: string }

export type Block =
  | { type: 'paragraph'; spans: Span[] }
  | { type: 'heading'; spans: Span[] }
  | { type: 'list'; ordered: boolean; items: Span[][] }
  | { type: 'code'; language: string; text: string }

const FENCE = /^ {0,3}```(\S*)\s*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/
const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/
const ORDERED = /^ {0,3}\d{1,9}[.)][ \t]+(.*)$/

/**
 * Backticks first, so `**` inside a code span stays punctuation. Bare URLs come
 * last, so the target of a `[label](url)` is not also matched on its own.
 */
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)/g

const SENTENCE_ENDINGS = new Set(['.', ',', ';', ':', '!', '?'])

function occurrences(text: string, character: string): number {
  let count = 0
  for (const char of text) if (char === character) count += 1
  return count
}

/**
 * `Source: https://example.com/pricing.` — the full stop belongs to the
 * sentence, not the URL. A closing bracket is only trimmed when nothing in the
 * URL opened it, so `…/Foo_(bar)` survives being written inside parentheses.
 *
 * Exported for the citation line in `lib/sources.ts`, which reads URLs out of a
 * reply by a different route and must agree with this one about where they end.
 */
export function trimTrailingPunctuation(url: string): string {
  let end = url.length
  while (end > 0) {
    const char = url[end - 1] ?? ''
    if (SENTENCE_ENDINGS.has(char)) {
      end -= 1
      continue
    }
    if (char === ')') {
      const candidate = url.slice(0, end)
      if (occurrences(candidate, ')') > occurrences(candidate, '(')) {
        end -= 1
        continue
      }
    }
    break
  }
  return url.slice(0, end)
}

export function parseSpans(text: string): Span[] {
  const spans: Span[] = []
  let plainFrom = 0

  const pushText = (value: string): void => {
    if (value) spans.push({ type: 'text', text: value })
  }

  INLINE.lastIndex = 0
  for (let match = INLINE.exec(text); match !== null; match = INLINE.exec(text)) {
    const [whole, code, strong, linkText, linkHref, bareUrl] = match

    // A bare URL can pick up punctuation the sentence owns. Give it back rather
    // than swallowing it, so the following text still reads as written.
    let consumed = whole.length
    let span: Span
    if (code !== undefined) {
      span = { type: 'code', text: code }
    } else if (strong !== undefined) {
      span = { type: 'strong', text: strong }
    } else if (linkText !== undefined && linkHref !== undefined) {
      span = { type: 'link', href: linkHref, text: linkText }
    } else {
      const href = trimTrailingPunctuation(bareUrl ?? '')
      if (!href) {
        continue
      }
      consumed = href.length
      span = { type: 'link', href, text: href }
    }

    pushText(text.slice(plainFrom, match.index))
    spans.push(span)
    plainFrom = match.index + consumed
    INLINE.lastIndex = plainFrom
  }

  pushText(text.slice(plainFrom))
  return spans
}

export function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', spans: parseSpans(paragraph.join('\n')) })
    paragraph = []
  }

  const flushList = (): void => {
    if (!list) return
    blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseSpans) })
    list = null
  }

  const flush = (): void => {
    flushParagraph()
    flushList()
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const body: string[] = []
      index += 1
      // An unclosed fence still renders as code. Half a code block is what the
      // reader sees for as long as one is streaming in.
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({ type: 'code', language: fence[1] ?? '', text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', spans: parseSpans(heading[2] ?? '') })
      continue
    }

    const bullet = BULLET.exec(line)
    const ordered = bullet ? null : ORDERED.exec(line)
    if (bullet ?? ordered) {
      flushParagraph()
      const isOrdered = ordered !== null
      if (list && list.ordered !== isOrdered) flushList()
      list ??= { ordered: isOrdered, items: [] }
      list.items.push(bullet?.[1] ?? ordered?.[1] ?? '')
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flush()
  return blocks
}
