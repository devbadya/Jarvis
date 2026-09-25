/**
 * Every language the picker offers.
 *
 * The interface itself is fully translated for English and German. Every other
 * entry still changes three things: the sentence that tells the model which
 * language it may answer in, the language dictation listens for, and the voice
 * a reply is read with. Names are the ones a speaker of that language looks for.
 */
export interface Language {
  id: string
  /** Native name, shown in the picker. */
  name: string
  /** English name, the one the model is told to answer in. */
  english: string
  /** BCP 47 tag for recognition and synthesis. */
  speech: string
}

export const LANGUAGES: Language[] = [
  { id: 'en', name: 'English', english: 'English', speech: 'en-US' },
  { id: 'de', name: 'Deutsch', english: 'German', speech: 'de-DE' },
  { id: 'es', name: 'Español', english: 'Spanish', speech: 'es-ES' },
  { id: 'fr', name: 'Français', english: 'French', speech: 'fr-FR' },
  { id: 'it', name: 'Italiano', english: 'Italian', speech: 'it-IT' },
  { id: 'pt', name: 'Português', english: 'Portuguese', speech: 'pt-PT' },
  { id: 'nl', name: 'Nederlands', english: 'Dutch', speech: 'nl-NL' },
  { id: 'pl', name: 'Polski', english: 'Polish', speech: 'pl-PL' },
  { id: 'sv', name: 'Svenska', english: 'Swedish', speech: 'sv-SE' },
  { id: 'da', name: 'Dansk', english: 'Danish', speech: 'da-DK' },
  { id: 'no', name: 'Norsk', english: 'Norwegian', speech: 'nb-NO' },
  { id: 'fi', name: 'Suomi', english: 'Finnish', speech: 'fi-FI' },
  { id: 'cs', name: 'Čeština', english: 'Czech', speech: 'cs-CZ' },
  { id: 'sk', name: 'Slovenčina', english: 'Slovak', speech: 'sk-SK' },
  { id: 'hu', name: 'Magyar', english: 'Hungarian', speech: 'hu-HU' },
  { id: 'ro', name: 'Română', english: 'Romanian', speech: 'ro-RO' },
  { id: 'bg', name: 'Български', english: 'Bulgarian', speech: 'bg-BG' },
  { id: 'el', name: 'Ελληνικά', english: 'Greek', speech: 'el-GR' },
  { id: 'tr', name: 'Türkçe', english: 'Turkish', speech: 'tr-TR' },
  { id: 'uk', name: 'Українська', english: 'Ukrainian', speech: 'uk-UA' },
  { id: 'ru', name: 'Русский', english: 'Russian', speech: 'ru-RU' },
  { id: 'ar', name: 'العربية', english: 'Arabic', speech: 'ar-SA' },
  { id: 'he', name: 'עברית', english: 'Hebrew', speech: 'he-IL' },
  { id: 'hi', name: 'हिन्दी', english: 'Hindi', speech: 'hi-IN' },
  { id: 'bn', name: 'বাংলা', english: 'Bengali', speech: 'bn-BD' },
  { id: 'ur', name: 'اردو', english: 'Urdu', speech: 'ur-PK' },
  { id: 'fa', name: 'فارسی', english: 'Persian', speech: 'fa-IR' },
  { id: 'ta', name: 'தமிழ்', english: 'Tamil', speech: 'ta-IN' },
  { id: 'th', name: 'ไทย', english: 'Thai', speech: 'th-TH' },
  { id: 'vi', name: 'Tiếng Việt', english: 'Vietnamese', speech: 'vi-VN' },
  { id: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', speech: 'id-ID' },
  { id: 'ms', name: 'Bahasa Melayu', english: 'Malay', speech: 'ms-MY' },
  { id: 'zh', name: '中文', english: 'Chinese', speech: 'zh-CN' },
  { id: 'ja', name: '日本語', english: 'Japanese', speech: 'ja-JP' },
  { id: 'ko', name: '한국어', english: 'Korean', speech: 'ko-KR' },
  { id: 'sw', name: 'Kiswahili', english: 'Swahili', speech: 'sw-KE' },
]

const BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]))

export function languageById(id: string): Language {
  return BY_ID.get(id) ?? LANGUAGES[0]!
}

/**
 * The one sentence added to the prompt. It overrides the guideline that says
 * to follow the language of the question: the chosen language is the only one
 * a reply may use.
 */
export function replyInstruction(id: string): string {
  const language = languageById(id)
  return `Reply only in ${language.english}, never in any other language.`
}
