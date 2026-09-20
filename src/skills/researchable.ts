import { contentTerms } from './retrieve'
import type { SkillEntry } from './types'

/**
 * Whether a message that matched no skill is still a question worth researching.
 *
 * Triggers and the keyword index catch the shapes the author wrote. What they
 * miss is an ordinary factual question — *What is the capital of France?*,
 * *Warum ist der Himmel blau?* — and the informal ones people actually type,
 * *no of macron has a wife*, *macron frau*, *his age*. A 0.8B model will
 * otherwise answer those from training data, confidently and often wrongly.
 * Greeting, small talk, creative work and questions about the user or the
 * assistant are not that: researching *wie geht's dir* is the failure this
 * exists to avoid.
 *
 * This runs in code on purpose. Asking the model whether to research spends the
 * generation the skill exists to skip, and a regex on the skill itself cannot
 * hold the exclusions without stealing greetings the way `who is` once stole
 * *Who is that?*.
 */
export const RESEARCH_SKILL = 'research-question'

/** A question word at the start, in either language the app is asked in. */
const INTERROGATIVE =
  /^\s*(what|whats|which|who|when|where|why|how|is|are|does|do|did|can|could|should|would|wer|was|wann|wo|warum|wieso|weshalb|welche[rsn]?|ist|sind|hat|haben|kannst|k(ö|oe)nntest|erkl(ä|ae)r)/i

/** Asked as an instruction to look something up, which is the same job. */
const LOOKUP = /^\s*(tell me about|explain|look up|find out|search for|google|schau nach|finde heraus)\b/i

/**
 * *Erkläre mir warum das nicht geht* is shaped like a lookup and is about this
 * conversation. The object has to be a public subject, or this becomes a search
 * for a pronoun.
 */
const IN_CONTEXT =
  /^\s*erkl(ä|ae)r(?:e|st)?\s+(?:mir|uns)[,\s]+(?:warum|wieso|wie|das|dies|es)\b|^\s*explain\s+(?:why|how)\s+(?:this|that|it)\b/i

/**
 * *Tell me about the trip we planned* is shaped like a lookup and is about us.
 * The object has to be a public subject, or this becomes a search for a holiday.
 */
const PERSONAL_OBJECT =
  /\b(we|our|us|my|mine|it|that|this|wir|unser|unsere[nms]?|mich|mir|ich|dir|dich|du)\b/i

/** A follow-up fragment, not a question of its own. Carry-over owns these. */
const CONTINUES = /^\s*(and|und|auch|also|plus|what about|how about|was ist mit|oh and)\b/i

/**
 * Small talk, including the German greeting that is shaped exactly like a
 * question. Anchored where a longer message with the same words is actually
 * asking — *what's up in France* is news; *what's up?* is not.
 */
const GREETING =
  /^\s*(?:hi|hey|hello|hallo|moin|servus|hiya|yo|howdy)\b|^\s*(?:how are you|how're you|how are ya|how'?s it going|how do you do|how have you been)\b|^\s*(?:what'?s up|was geht(?:\s+ab)?|na)\s*\??\s*$|^\s*wie\s+geht(?:'?s|\s+es)\b|^\s*alles\s+klar\s*\??\s*$/i

/** The assistant, not a public fact. Whole-message shapes, so *what are you supposed to do if…* survives. */
const ABOUT_ASSISTANT =
  /^\s*(?:who are you|what are you|what('?s| is) your name|what can you (?:do|help)|how (?:do|can) you help|can you help(?: me)?|tell me about yourself)\s*\??\s*$|^\s*(?:wer bist du|was bist du|wie hei(ß|ss)t du|was kannst du|was machst du|kannst du (?:mir )?helfen|erz(ä|ae)hl(?: e)? (?:mir )?von dir)\b/i

/** The user's own attributes. A favourite colour is recall, not a search. */
const ABOUT_USER =
  /^\s*(?:what('?s| is)|was ist)\s+(?:my|mein|meine)\b|\b(?:my favourite|mein lieblings)|^\s*(?:wie hei(ß|ss)e ich|what's my|what is my)\b/i

/**
 * A pronoun where a subject should be. *Who is that?* used to fire `who is` and
 * send a search engine a word with no referent.
 */
const PRONOUN_QUESTION =
  /^\s*(?:who|what|which|wer|was|welche[rsn]?)\s+(?:is|are|was|were|ist|sind|war|waren)\s+(?:that|this|it|these|those|they|them|there|das|dies|es|los)\s*\??\s*$/i

/**
 * Creative work asked as a question. *Can you write a poem?* starts with `can`
 * and would otherwise look like a request to look something up. A factual
 * *what is a haiku?* still researches, because it does not start with write.
 */
const CREATIVE =
  /^\s*(?:write|schreib(?:e|en)?|erz(ä|ae)hl(?:e)?|dichte|make up|compose|tell me|can you|could you|kannst du)\b[\s\S]*\b(?:haiku|rhyme|poem|limerick|joke|witz|gedicht|geschichte|lied|song)\b/i

/** The exchange is closing, not asking. Same list `isFollowUp` already uses. */
const CLOSES = /^\s*(thanks|thank you|thx|cheers|ok|okay|cool|nice|great|danke|dankesch(ö|oe)n|bye|ciao)\b/i

/**
 * A biographical attribute. *no of macron has a wife* never forms a question,
 * but it is still a fact to look up. `old` is not on this list: *the old town*
 * is not about someone's age, and *how old is he* already starts with `how`.
 */
export const FACT_ATTRIBUTE =
  /\b(wife|wives|wom[ae]n|girlfriend|boyfriend|husband|married|marriage|spouse|partner|fiancee?|fiancée|age|born|birthday|birthdate|kids?|children|child|sons?|daughters?|died|dead|death|nationality|frau|mann|freundin|freund|verheiratet|heirat|alter|geboren|geburtstag|gestorben|kinder|kind|sohn|tochter|partnerin)\b/i

/**
 * *no of* is *know if* with the keys next to each other. People who do not
 * write questions still ask them this way.
 */
export const INFORMAL_ASK =
  /^\s*(?:no of|know if|know of|know whether|do you know(?:\s+if|\s+whether)?|weisst du(?:\s+ob)?|wei(?:ß|ss)t du(?:\s+ob)?|sag mal(?:\s+ob)?|is it true(?:\s+that)?|ist es wahr(?:\s+dass)?)\b/i

const FIRST_PERSON_ASK = /^\s*(?:i|i'm|im|ich)\b|\b(?:my|mine|mein|meine[nms]?)\b/i

const PERSON_PRONOUN = /\b(he|she|they|him|his|her|hers|er|sie|ihn|ihm|ihr|ihnen)\b/i

/** A question mark, an interrogative, or an instruction to look it up. */
export function isFramedQuestion(message: string): boolean {
  return /[?？]/.test(message) || INTERROGATIVE.test(message) || LOOKUP.test(message)
}

export function isFactAttribute(word: string): boolean {
  return FACT_ATTRIBUTE.test(word)
}

/** Content words that are not the attribute being asked about. */
export function publicSubjectTerms(text: string): string[] {
  return contentTerms(text).filter((term) => !FACT_ATTRIBUTE.test(term))
}

/**
 * A fact-ask that never formed a question: a name plus *wife* / *alter*, an
 * informal *no of …*, or a pronoun plus an attribute (*his wife*).
 *
 * First-person statements stay out — *I have a wife*, *I was born in 2024* —
 * because those are about the user, not a public figure.
 */
export function isFactAsk(message: string): boolean {
  const text = message.trim()
  if (!text || FIRST_PERSON_ASK.test(text)) return false
  if (INFORMAL_ASK.test(text) && publicSubjectTerms(text).some((term) => term.length >= 4)) return true
  if (!FACT_ATTRIBUTE.test(text)) return false
  if (PERSON_PRONOUN.test(text)) return true
  return publicSubjectTerms(text).some((term) => term.length >= 4)
}

function isQuestion(message: string): boolean {
  return isFramedQuestion(message) || isFactAsk(message)
}

export function isResearchable(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (CLOSES.test(text) || GREETING.test(text) || ABOUT_ASSISTANT.test(text) || ABOUT_USER.test(text)) {
    return false
  }
  if (CONTINUES.test(text)) return false
  if (PRONOUN_QUESTION.test(text) || CREATIVE.test(text) || IN_CONTEXT.test(text)) return false
  if (!isQuestion(text)) return false
  if (LOOKUP.test(text) && PERSONAL_OBJECT.test(text.replace(LOOKUP, ''))) return false
  return contentTerms(text).length > 0
}

export function researchSkill(catalog: SkillEntry[]): SkillEntry | undefined {
  return catalog.find((entry) => entry.name === RESEARCH_SKILL)
}
