import { Fragment } from 'react'
import { Link } from '@heroui/react/link'
import { CopyButton } from './CopyButton'
import { parseBlocks, type Block, type Span } from '@/lib/rich-text'

/**
 * Turns a reply into elements. Every node here is constructed, never parsed out
 * of a string, so there is no HTML to inject and no sanitiser to get wrong. The
 * only URLs that reach an `href` matched `https?://` on the way in.
 */
function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, index) => {
        const key = `${index}-${span.type}`
        if (span.type === 'code') {
          return (
            <code key={key} className="rounded bg-surface-tertiary px-1 py-0.5 font-mono text-[0.9em]">
              {span.text}
            </code>
          )
        }
        if (span.type === 'strong') {
          return (
            <strong key={key} className="font-semibold">
              {span.text}
            </strong>
          )
        }
        if (span.type === 'link') {
          // HeroUI's Link is built for a standalone one: `--link` is `--foreground`
          // in both themes and the underline only appears on hover, which inside a
          // sentence leaves a URL indistinguishable from the words around it. It is
          // also `inline-flex`, so a long address would neither wrap nor sit on the
          // text baseline. Both are overridden here rather than replaced, so the
          // focus ring and press states still come from the component.
          return (
            <Link
              key={key}
              className="inline [overflow-wrap:anywhere] underline decoration-muted/60"
              href={span.href}
              rel="noreferrer noopener"
              target="_blank"
            >
              {span.text}
            </Link>
          )
        }
        return <Fragment key={key}>{span.text}</Fragment>
      })}
    </>
  )
}

/**
 * A fenced block, with the two things a reader wants from one: what language
 * the model thought it was writing, and a way to take it away without
 * selecting it by hand.
 */
function CodeBlock({ block, caret }: { block: Extract<Block, { type: 'code' }>; caret: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-secondary">
      <div className="flex items-center justify-between gap-2 border-b border-border ps-3 pe-1 py-0.5">
        <span className="font-mono text-xs text-muted">{block.language || 'code'}</span>
        <CopyButton copiedLabel="Code copied" label="Copy code" text={block.text} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs">
        <code className={caret ? 'caret' : undefined}>{block.text}</code>
      </pre>
    </div>
  )
}

/**
 * A `##` in a reply is emphasis, not document structure. Rendering it as a real
 * heading would splice the model's improvised outline into the page's own,
 * between the app's `h1` and whatever a screen reader expects to find next.
 */
function Heading({ spans, caret }: { spans: Span[]; caret: boolean }) {
  return (
    <p className={`font-semibold ${caret ? 'caret' : ''}`}>
      <Spans spans={spans} />
    </p>
  )
}

export function RichText({ text, caret = false }: { text: string; caret?: boolean }) {
  const blocks = parseBlocks(text)

  return (
    <div className="space-y-3 break-words">
      {blocks.map((block, index) => {
        const key = `${index}-${block.type}`
        // The blinking cursor belongs at the end of the text, which means inside
        // the last block rather than after the stack of them.
        const trailing = caret && index === blocks.length - 1

        if (block.type === 'code') return <CodeBlock key={key} block={block} caret={trailing} />

        if (block.type === 'heading') return <Heading key={key} caret={trailing} spans={block.spans} />

        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={key} className={`space-y-1 ps-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, itemIndex) => (
                <li
                  key={itemIndex}
                  className={trailing && itemIndex === block.items.length - 1 ? 'caret' : undefined}
                >
                  <Spans spans={item} />
                </li>
              ))}
            </List>
          )
        }

        return (
          <p key={key} className={`whitespace-pre-wrap ${trailing ? 'caret' : ''}`}>
            <Spans spans={block.spans} />
          </p>
        )
      })}

      {/* Nothing has streamed yet, or the last block cannot hold the cursor. */}
      {caret && blocks.length === 0 && <span className="caret" />}
    </div>
  )
}
