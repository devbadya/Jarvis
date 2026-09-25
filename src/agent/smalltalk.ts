import { wordPattern } from './language'

/**
 * Small talk answered in code, in German or English.
 *
 * The `conversation` skill only routes on a whole message of small talk, and
 * for that the model is the wrong tool: with a worked example in front of it,
 * *Hallo Jarvis, wie geht es dir?* still came back as *Ich habe alles richtig!
 * Wie geht es Ihnen? Was können Sie mir dabei helfen?* — after two minutes of
 * reasoning on a modest GPU. There are five things these messages say, and
 * each has one right answer.
 *
 * Only German and English have wording. Any other chosen language gets null,
 * and the model answers from the skill's exemplars as before.
 */
export const CONVERSATION_SKILL = 'conversation'

type Intent = 'how-are-you' | 'thanks' | 'who' | 'abilities' | 'greeting'

const HOW_ARE_YOU = wordPattern("wie geht(?:'?s| es)|how are you|how'?s it going|alles (?:klar|gut)")
const THANKS = wordPattern('danke|vielen dank|dankesch(?:ö|oe)n|thanks|thank you|thx|cheers')
const WHO = wordPattern(
  "wer bist du|was bist du|wie hei(?:ß|ss)t du|who are you|what are you|what(?:'?s| is) your name|tell me about yourself",
)
const ABILITIES = wordPattern('was kannst du|what can you')
const GOOD_TIME_OF_DAY = /^\s*(guten (?:morgen|tag|abend)|good (?:morning|afternoon|evening))/i

/** Written the way each language writes it: German capitalises the noun, English does not. */
function timeOfDayGreeting(said: string): string {
  const [first = '', second = ''] = said.toLowerCase().split(/\s+/)
  const noun = first === 'guten' ? second.charAt(0).toUpperCase() + second.slice(1) : second
  return `${first.charAt(0).toUpperCase()}${first.slice(1)} ${noun}!`
}

function intentOf(message: string): Intent {
  if (ABILITIES.test(message)) return 'abilities'
  if (WHO.test(message)) return 'who'
  if (HOW_ARE_YOU.test(message)) return 'how-are-you'
  if (THANKS.test(message)) return 'thanks'
  return 'greeting'
}

const ABILITIES_DE = [
  'Ich kann dir bei vielen Dingen helfen:',
  '',
  '- Fragen beantworten und dafür im Web recherchieren',
  '- Webseiten lesen und zusammenfassen',
  '- exakt rechnen',
  '- dir das Wetter und die Uhrzeit an jedem Ort sagen',
  '- Termine im Kalender eintragen, verschieben und löschen',
  '- mir Dinge über dich merken, wenn du das möchtest',
  '',
  'Frag mich einfach.',
].join('\n')

const ABILITIES_EN = [
  'I can help with quite a few things:',
  '',
  '- answer questions, researching them on the web',
  '- read and summarise web pages',
  '- calculate exactly',
  '- tell you the weather and the time anywhere',
  '- add, move and delete appointments in your calendar',
  '- remember things about you, if you want me to',
  '',
  'Just ask.',
].join('\n')

/** The reply, or null when there is no wording for the chosen language. */
export function smallTalkReply(message: string, language: 'de' | 'en', chosen?: string): string | null {
  if (chosen && chosen !== 'de' && chosen !== 'en') return null
  const de = language === 'de'
  const greeting = GOOD_TIME_OF_DAY.exec(message)?.[1]
  const hello = greeting ? timeOfDayGreeting(greeting) : de ? 'Hallo!' : 'Hi!'

  switch (intentOf(message)) {
    case 'abilities':
      return de ? ABILITIES_DE : ABILITIES_EN
    case 'who':
      return de
        ? 'Ich bin Jarvis, ein Assistent, der ganz in deinem Browser läuft. Wie kann ich dir helfen?'
        : "I'm Jarvis, an assistant that runs entirely in your browser. How can I help you?"
    case 'how-are-you':
      return de
        ? 'Mir geht es gut, danke! Wie kann ich dir helfen?'
        : "I'm doing well, thanks! How can I help you?"
    case 'thanks':
      return de
        ? 'Gern geschehen! Sag Bescheid, wenn du noch etwas brauchst.'
        : "You're welcome! Let me know if you need anything else."
    case 'greeting':
      return de ? `${hello} Wie kann ich dir helfen?` : `${hello} How can I help you?`
  }
}
