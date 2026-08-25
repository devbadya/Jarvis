import { Alert } from '@heroui/react/alert'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Spinner } from '@heroui/react/spinner'
import { ToolActivity } from './ToolActivity'
import { CopyButton } from './ui/CopyButton'
import { Reasoning } from './ui/Reasoning'
import { RichText } from './ui/RichText'
import { Sources } from './ui/Sources'
import { RefreshIcon, SparkleIcon } from './ui/icons'
import type { ReviewCheck } from '@/agent/review'
import { formatDuration, formatTime } from '@/lib/format'
import { splitSources } from '@/lib/sources'
import { MAX_TOOL_ROUNDS } from '@/llm/config'
import { useChatStore } from '@/store/chat'
import type { AppliedSkill, Message } from '@/types'

/**
 * Only the newest reply can be rerun. `retry` rewinds to the last request, so
 * offering it further up the transcript would silently discard everything after
 * the message the button sits on.
 */
function RetryButton({ children }: { children: string }) {
  const busy = useChatStore((state) => state.busy)
  const retry = useChatStore((state) => state.retry)

  return (
    <Button isDisabled={busy} size="sm" variant="ghost" onPress={() => void retry()}>
      <RefreshIcon />
      {children}
    </Button>
  )
}

const REVIEW_REASON: Record<ReviewCheck, string> = {
  'wrong-number': 'a number the calculator disagreed with',
  'invented-source': 'a source no tool returned',
  'missing-source': 'a missing source',
}

/** Reads as a phrase, so the same wording works before and after the fix. */
function describeReview(found: ReviewCheck[]): string {
  return found.map((check) => REVIEW_REASON[check]).join(' and ')
}

/**
 * Why this skill and not another. A router nobody can see is a router nobody can
 * correct, and carried-over is the case worth being able to spot.
 */
function describeSkill(applied: AppliedSkill): string {
  if (applied.reason === 'carried-over') return `${applied.name} skill · carried over`
  const [matched] = applied.matched
  if (applied.reason === 'search' && matched) return `${applied.name} skill · matched “${matched}”`
  return `${applied.name} skill`
}

export function MessageItem({ message, isLatest = false }: { message: Message; isLatest?: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex animate-in justify-end fade-in slide-in-from-bottom-2 duration-500">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-accent-foreground shadow-lg shadow-brand/20">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    )
  }

  const showCaret = message.streaming && message.content.length > 0
  const review = message.review
  // Still streaming with a finding recorded means the draft failed a check and
  // the text below is being replaced. Say so, or the reply appears to reset.
  const correcting = Boolean(message.streaming && review && review.found.length > 0)
  // The citation line is presentation, so it is taken off the text on the way to
  // the screen and nowhere else: `content` is still what gets copied, checked
  // and sent back as history. A half-typed URL is nobody's citation, so the
  // split waits for the reply to finish.
  const { body, sources } = message.streaming
    ? { body: message.content, sources: [] }
    : splitSources(message.content)

  return (
    <div className="flex animate-in gap-3 fade-in slide-in-from-bottom-2 duration-500">
      {/* The mark, lit while this reply is still arriving. It is the same brand
          circle the header wears, so a turn in flight looks like the app itself
          working rather than a decoration that happens to spin. */}
      <span aria-hidden="true" className="relative mt-0.5 shrink-0">
        {message.streaming && <span className="orb-halo absolute -inset-1 rounded-full bg-brand blur-md" />}
        <span className="relative flex size-8 items-center justify-center rounded-full border border-brand/40 bg-surface text-brand">
          <SparkleIcon className="size-4" />
        </span>
      </span>

      <div className="min-w-0 flex-1 space-y-2">
        {/* A correction is generating a whole new answer, reasoning included.
            Leaving the discarded draft's trace above it would date-stamp the
            wrong turn, so the correcting row speaks for this one. */}
        {!correcting && (
          <Reasoning
            durationMs={message.reasoningMs}
            streaming={Boolean(message.streaming)}
            text={message.reasoning ?? ''}
          />
        )}

        <ToolActivity calls={message.toolCalls ?? []} />

        {correcting && review && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" /> Correcting {describeReview(review.found)}…
          </p>
        )}

        {body && <RichText caret={showCaret} text={body} />}
        <Sources urls={sources} />

        {message.error && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>The reply did not finish</Alert.Title>
              <Alert.Description className="break-words">{message.error}</Alert.Description>
              {isLatest && (
                <div className="pt-2">
                  <RetryButton>Try again</RetryButton>
                </div>
              )}
            </Alert.Content>
          </Alert>
        )}

        {!message.streaming && message.content && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <CopyButton copiedLabel="Reply copied" label="Copy reply" text={message.content} />
            {isLatest && !message.error && <RetryButton>Regenerate</RetryButton>}
            {message.skill && <span>{describeSkill(message.skill)}</span>}
            {review && review.found.length > 0 && (
              <>
                <Chip color={review.corrected ? 'success' : 'warning'} variant="soft">
                  {review.corrected ? 'corrected' : 'flagged'}
                </Chip>
                <span>
                  self-check found {describeReview(review.found)}
                  {review.corrected ? ' and fixed it' : ''}
                </span>
              </>
            )}
            {/* The tools were taken away before this reply was written, so it is
                as good as what they had returned and no better. */}
            {message.windDown && (
              <>
                <Chip color="warning" variant="soft">
                  tool budget
                </Chip>
                <span>spent all {MAX_TOOL_ROUNDS} tool rounds, then answered with what it had</span>
              </>
            )}
            {message.stats && (
              <span>
                {message.stats.tokens} tokens · {message.stats.tokensPerSecond.toFixed(1)} tok/s ·{' '}
                {formatDuration(message.stats.durationMs)}
              </span>
            )}
            <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
          </div>
        )}
      </div>
    </div>
  )
}
