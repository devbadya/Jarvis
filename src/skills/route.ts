import { search } from './retrieve'
import type { SkillEntry } from './types'

/**
 * Choosing a skill, keeping it while it is useful, and dropping it when it is
 * not.
 *
 * Three stages, cheapest and most certain first:
 *
 * 1. **Triggers.** A regex the author wrote for the shape of a request. Precise,
 *    free, and unable to hallucinate.
 * 2. **Search.** The curated keyword index, for phrasings no trigger anticipated
 *    — including the languages the triggers are not written in.
 * 3. **Carry-over.** A follow-up like *and in Lisbon?* matches nothing on its
 *    own, and the skill that answered the question it continues is exactly the
 *    one it needs.
 *
 * Stage 3 is the only stateful part, and it is deliberately hard to enter and
 * easy to leave. A skill that keeps applying to turns it has nothing to do with
 * is worse than no skill: it spends context and narrows the tool list on a
 * request that needed neither.
 */
export type RouteReason = 'trigger' | 'search' | 'carried-over'

export interface Route {
  entry: SkillEntry
  reason: RouteReason
  /** What matched. Empty for a trigger, which is its own explanation. */
  matched: string[]
}

/** What the router remembers between turns. Nothing else about a skill persists. */
export interface SkillMemory {
  name: string
  /** Turns it has been carried since it last matched a trigger or the index. */
  carried: number
}

export interface Routing {
  route: Route | null
  /** Memory for the next turn. Null means: evicted, nothing resident. */
  memory: SkillMemory | null
}

/**
 * How long a skill may survive on carry-over alone.
 *
 * Two turns of *and in Lisbon?* and *and tomorrow?* is the pattern this exists
 * for. Past that, a skill still resident has stopped being a continuation and
 * started being a default.
 */
export const MAX_CARRIED_TURNS = 2

/** A fragment this short cannot state a subject of its own. */
const MAX_FRAGMENT_TERMS = 4

/** An explicit continuation, whatever its length. */
const CONTINUES = /^\s*(and|und|auch|also|plus|what about|how about|was ist mit|oh and)\b/i

/**
 * A question that carries its own subject, so it is asking something new rather
 * than continuing the last thing.
 */
const ASKS_AFRESH =
  /^\s*(what|whats|which|who|when|where|why|how|is|are|does|do|did|can|could|tell|give|show|write|wer|was|wann|wo|warum|wieso|ist|sind|kannst|schreib)\b/i

/** Nothing to continue: the turn is closing the exchange, not extending it. */
const CLOSES = /^\s*(thanks|thank you|thx|cheers|ok|okay|cool|nice|great|danke|dankeschön|bye|ciao)\b/i

const WORD = /[\p{L}\p{N}]+/gu

/**
 * Whether this message reads as a continuation of the previous one.
 *
 * Length alone is not enough, and getting that wrong is how the mechanism turns
 * harmful: *what is the capital of France?* is six words, and answering it with
 * the weather skill's exemplars resident would send the model searching for a
 * fact it knows. So a continuation has to either say so, or be too short to be
 * asking anything by itself.
 */
export function isFollowUp(message: string): boolean {
  if (CLOSES.test(message)) return false
  if (CONTINUES.test(message)) return true
  if (ASKS_AFRESH.test(message)) return false

  const words = [...message.matchAll(WORD)]
  return words.length > 0 && words.length <= MAX_FRAGMENT_TERMS
}

/** First trigger match wins, and the catalogue is ordered by descending priority. */
export function matchTriggers(message: string, catalog: SkillEntry[]): SkillEntry | null {
  return catalog.find((entry) => entry.triggers.some((trigger) => trigger.test(message))) ?? null
}

export function route(message: string, catalog: SkillEntry[], memory: SkillMemory | null = null): Routing {
  const triggered = matchTriggers(message, catalog)
  if (triggered) {
    return {
      route: { entry: triggered, reason: 'trigger', matched: [] },
      memory: { name: triggered.name, carried: 0 },
    }
  }

  const [best] = search(message, catalog)
  if (best) {
    return {
      route: { entry: best.entry, reason: 'search', matched: best.matched },
      memory: { name: best.entry.name, carried: 0 },
    }
  }

  const resident = memory ? catalog.find((entry) => entry.name === memory.name) : undefined
  if (resident?.carry && memory && memory.carried < MAX_CARRIED_TURNS && isFollowUp(message)) {
    return {
      route: { entry: resident, reason: 'carried-over', matched: [] },
      memory: { name: resident.name, carried: memory.carried + 1 },
    }
  }

  // Nothing matched and nothing is worth keeping resident, so the skill is
  // dropped here rather than lingering into a conversation it left behind.
  return { route: null, memory: null }
}
