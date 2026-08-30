import { MAX_TOOL_ROUNDS } from '@/llm/config'
import { findUrls, type ReviewEvidence } from './review'

/**
 * What happens when a turn runs out of tool rounds.
 *
 * A cap has to exist — a model that can call a tool can call one forever — but a
 * cap that only stops the loop turns an unanswered question into a dead end,
 * which is exactly what this app used to show: four searches in a row, then
 * "I reached the limit of 4 tool rounds without settling on an answer." Every
 * search had returned something; none of it was ever read back to the user.
 *
 * LangChain names the two ways out of that `force` and `generate`, and only the
 * second ends in an answer: one final pass over what the tools returned, with
 * the model asked to conclude from it. That is the shape here, spent in three
 * phases rather than two.
 *
 * 1. **Rounds with tools.** Ordinary generate-and-execute, `MAX_TOOL_ROUNDS` of
 *    them, with `callFingerprint` stopping a round being spent re-running a call
 *    that has already been made — except `current_time`, whose answer moves.
 * 2. **The wind-down warning.** With `WIND_DOWN_AT` rounds left the model is
 *    told so, in the conversation, after the tool results and before it decides
 *    what to do next. A model that cannot see the budget cannot wrap up inside
 *    it, and beside the results it is reading is where the budget-aware agents
 *    put the count (pydantic-ai-tool-budget; arXiv:2511.17006).
 * 3. **The wind-down round.** Tools are withheld entirely — the chat template
 *    then documents no call format at all, which for a 0.8B model is worth more
 *    than any instruction not to use one — and the model is asked to answer.
 *
 * `budgetFallback` is the floor under all of it. The wind-down round can still
 * come back empty, and a user who waited through four searches is owed what
 * they turned up rather than an apology.
 */

/**
 * Told to the model while it can still act on it: after the tool results of the
 * second-to-last round, as its own turn rather than as part of a tool result,
 * because it is not something a tool returned.
 */
export function windDownNote(remaining: number): string {
  const rounds = remaining === 1 ? 'one more round of tool calls' : `${remaining} more rounds of tool calls`
  return `Tool budget: ${rounds} left this turn, then you answer with what you have. Call a tool only if something is genuinely missing; otherwise answer now from the results above.`
}

/**
 * The turn that asks for the answer, once no tool can run.
 *
 * It says the budget is gone rather than forbidding tools, and it names the
 * alternative to searching again — reporting what is missing — because a model
 * left to infer that from an empty tool list tends to apologise instead.
 */
export const FINAL_ANSWER_PROMPT =
  'The tool budget for this turn is spent, and no tools are available for this reply. Answer the question now from the tool results above: give what they do show, and say plainly what you could not find. Do not offer to search again.'

/**
 * Identifies a call by what it would do rather than by how it was written.
 *
 * Arguments arrive as untyped strings from XML, so `Berlin` and ` berlin ` are
 * one call, and key order is whatever the model happened to emit.
 */
export function callFingerprint(name: string, args: Record<string, unknown>): string {
  const values = Object.entries(args)
    .map(
      ([key, value]) =>
        [
          key.toLowerCase(),
          String(value ?? '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' '),
        ] as const,
    )
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => left.localeCompare(right))

  return JSON.stringify([name.toLowerCase(), values])
}

/**
 * Whether an identical call must still be executed again this turn.
 *
 * Search and fetch are the same page twice. The clock is not: a minute later
 * it is a different reading, and handing back the first one is how the minutes
 * froze. Only `current_time` is on this list; nothing else here changes if you
 * ask the same thing again inside one turn.
 */
export function rerunsEachCall(name: string): boolean {
  return name === 'current_time'
}

/**
 * What the model gets back instead of a second identical search.
 *
 * The result is repeated rather than pointed at: it is already further up the
 * conversation, and a model that reaches for the same call twice is a model that
 * did not use it the first time.
 *
 * Only exact repeats are caught, deliberately. Suppressing near-duplicates needs
 * a similarity threshold, and the four searches this was written for — `sergej
 * kunz mystic religion russian New Age movement Wikipedia` and its neighbours —
 * share barely half their words, so a threshold loose enough to catch them also
 * catches `weather Berlin` after `weather Munich`. Circling with different words
 * is what the wind-down warning is for.
 */
export function repeatedCallNote(name: string, result: string): string {
  return `${name} was already called with these arguments this turn, so it was not run again. Its result is unchanged:\n\n${result}\n\nAnswer from it, or try something different.`
}

/** As many sources as a reply that failed can hand over without becoming a list. */
const FALLBACK_SOURCES = 3

/**
 * The answer of last resort, when the wind-down round produced no text either.
 *
 * Everything in it comes from a tool result, so it makes no claim the turn did
 * not earn, and it ends in the one-line `Source:` shape `splitSources` lifts
 * into citation pills — the pages are the part worth clicking.
 */
export function budgetFallback(evidence: ReviewEvidence): string {
  const opening = `I could not settle on an answer within ${MAX_TOOL_ROUNDS} rounds of tool calls.`
  const sources = [...new Set(evidence.toolResults.flatMap(({ result }) => findUrls(result)))].slice(
    0,
    FALLBACK_SOURCES,
  )

  if (sources.length === 0) return `${opening} Try narrowing the question.`
  return `${opening} These pages came up on the way, in case one of them helps.\n\nSource: ${sources.join(' ')}`
}
