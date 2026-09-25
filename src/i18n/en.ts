/**
 * The English strings. This is the source of truth for the keys: every other
 * language must provide the same ones, and the type of `de.ts` says so.
 */
export const en = {
  // Header
  'header.newChat': 'New chat',
  'header.chats': 'Chats',
  'header.calendar': 'Calendar',
  'header.memory': 'Memory',
  'header.tools': 'Tools',
  'header.readAloud.on': 'Read replies aloud',
  'header.readAloud.off': 'Stop reading replies aloud',
  'header.theme.toDark': 'Switch to dark theme',
  'header.theme.toLight': 'Switch to light theme',
  'header.subtitle': 'Qwen3.5-0.8B · on-device',
  'header.language': 'Language',

  // Language switch
  'language.choose': 'Choose language',
  'language.hint': 'Jarvis answers, listens and reads aloud only in this language.',

  // Landing
  'landing.badge': 'On-device · WebGPU · no account, no API key',
  'landing.title.before': 'The model runs ',
  'landing.title.highlight': 'in this tab',
  'landing.title.after': '.',
  'landing.lede':
    'Jarvis is a chat agent whose language model never leaves this tab. It is downloaded once, kept in this browser and executed on your own GPU — so there is no per-token cost, and no conversation is handed to a model provider.',
  'landing.stat.downloaded': 'downloaded once',
  'landing.stat.requests': 'requests to a model provider',
  'landing.stat.tab': 'the entire stack',
  'landing.stat.tabValue': '1 tab',
  'landing.capabilities.eyebrow': 'What it can do',
  'landing.capabilities.title': 'A small model, given help',
  'landing.cap.gpu.title': 'Your GPU does the work',
  'landing.cap.gpu.body':
    'The weights run through WebGPU in a Web Worker, so the interface keeps answering while tokens arrive.',
  'landing.cap.offline.title': 'Waits for a connection',
  'landing.cap.offline.body':
    'The weights are yours after the download, but the facts are not. Offline it would answer from memory alone, so it does not answer at all.',
  'landing.cap.web.title': 'Searches and reads the web',
  'landing.cap.web.body':
    'DuckDuckGo, Wikipedia or Jina for search and a reader for whole pages, both called straight from this tab.',
  'landing.cap.math.title': 'Arithmetic it cannot fumble',
  'landing.cap.math.body':
    'A small model guesses at long multiplication. This one hands the expression to a calculator and quotes what came back.',
  'landing.cap.calendar.title': 'A calendar it can run',
  'landing.cap.calendar.body':
    'Appointments stay in this browser. Ask it to book, move or cancel one, and the same list is what you see.',
  'landing.cap.memory.title': 'Remembers across chats',
  'landing.cap.memory.body':
    'Tell it something worth keeping and it is recalled into the prompt next time, editable and deletable by you.',
  'landing.cap.voice.title': 'Listens and speaks',
  'landing.cap.voice.body':
    'Dictate a question with the microphone and have replies read aloud, in the language you chose.',
  'landing.cap.mcp.title': 'Connects to MCP servers',
  'landing.cap.mcp.body':
    'Point it at an HTTP endpoint and that server’s tools join the list this model is allowed to call.',
  'landing.steps.eyebrow': 'How it works',
  'landing.steps.title': 'From your question to a checked answer',
  'landing.step.install.title': 'Install once',
  'landing.step.install.body':
    'The weights stream into this browser’s storage. A download interrupted half way through continues from where it stopped rather than starting again.',
  'landing.step.ask.title': 'Ask in any language',
  'landing.step.ask.body':
    'Your question is matched against a set of skills — worked examples that show a small model what a good answer to this kind of request looks like.',
  'landing.step.tools.title': 'It reaches for tools',
  'landing.step.tools.body':
    'Search, a page reader, the calculator, its memory and any server you connected. Every call is named in words while it runs.',
  'landing.step.check.title': 'The answer is checked',
  'landing.step.check.body':
    'Before a reply is shown it is read back against what the tools returned. A number the tools disagree with, a researched fact the reply dropped, or a source nothing ever fetched, is corrected or flagged.',
  'landing.privacy.eyebrow': 'Privacy',
  'landing.privacy.title': 'What actually leaves the browser',
  'landing.privacy.stays.title': 'Stays in this tab',
  'landing.privacy.stays.1': 'Everything you type, and every reply',
  'landing.privacy.stays.2': 'The model’s reasoning and its tool results',
  'landing.privacy.stays.3': 'Whatever it has been asked to remember',
  'landing.privacy.stays.4': 'Appointments on the calendar in this app',
  'landing.privacy.stays.5': 'The weights themselves, after the download',
  'landing.privacy.leaves.title': 'Goes out, and only when a tool runs',
  'landing.privacy.leaves.1': 'The search terms of a web search',
  'landing.privacy.leaves.2': 'The address of a page you asked it to read',
  'landing.privacy.leaves.3': 'A place name, when you ask about the weather or the time somewhere else',
  'landing.privacy.leaves.4': 'Whatever you send to an MCP server you added',
  'landing.privacy.leaves.5':
    'Your voice, while you dictate — the browser’s own speech service turns it into text',
  'landing.privacy.note':
    'There is no server of ours in either column on the hosted site. The build is a directory of static files. A tool proxy you run yourself can sit in front of search and page reads; the model still does not leave this tab.',
  'landing.requirements.eyebrow': 'Before you start',
  'landing.requirements.title': 'What this browser needs',
  'landing.req.browser.term': 'Chrome or Edge 113+',
  'landing.req.browser.detail':
    'Generation has no CPU fallback — WebGPU is the only path the weights can run on.',
  'landing.req.gpu.term': 'About 4 GB of GPU memory',
  'landing.req.gpu.detail': 'Less than that and the model will not fit beside your desktop.',
  'landing.req.space.term': '448 MB of free space',
  'landing.req.space.detail': 'Kept for as long as you keep it. Removing it is one button.',
  'landing.licence': 'MIT licensed',
  'landing.source': 'Source',
  'landing.backToTop': 'Back to the top',

  // Install panel
  'install.checkingGpu': 'Checking GPU support…',
  'install.noWebGpu.title': 'WebGPU is unavailable',
  'install.noWebGpu.body': 'Generation has no CPU fallback, so the chat cannot start here.',
  'install.noWebGpu.link': 'Which browsers support WebGPU',
  'install.tryAgain': 'Try again',
  'install.start': 'Start',
  'install.resume': 'Resume install ({left} left)',
  'install.install': 'Install model ({size})',
  'install.remove': 'Remove model',
  'install.discard': 'Discard download',
  'install.noRoom.title': 'There may not be room for the download',
  'install.noRoom.body':
    'The model needs about {needed} and this browser has {free} left. Free some space first, or expect the install to fail part way through.',
  'install.failed.title': 'Loading failed',
  'install.row.model': 'Model',
  'install.row.gpu': 'GPU',
  'install.row.status': 'Status',
  'install.row.storage': 'Storage',
  'install.gpu.detected': 'detected',
  'install.status.installed': 'installed',
  'install.status.onDisk': '{size} on disk',
  'install.status.partly': 'partly downloaded',
  'install.status.partlyDetail': '{saved} of {total} saved — the rest picks up where it stopped',
  'install.status.notInstalled': 'not installed',
  'install.status.oneTime': 'one-time download, about {size}',
  'install.storage.persisted': 'Persistent — the browser will not evict the model',
  'install.storage.bestEffort': 'Best effort — the browser may reclaim the model under storage pressure',
  'install.storage.indexeddb': 'Kept in IndexedDB — this browser has no private file system to stream it to',
  'install.storage.meter': 'Browser storage used',
  'install.storage.free': '{free} free of {total}',
  'install.loading': 'Loading…',
  'install.progress': 'Model download progress',
  'install.progressText': '{loaded} of {total} · {percent}%',
  'install.onceNote':
    'Downloading only happens once. Afterwards the model is served from this browser, and a transfer that is interrupted continues from where it stopped rather than starting again.',

  // Chat
  'chat.conversation': 'Conversation',
  'chat.loading': 'Loading your chats…',
  'chat.onDevice': 'On-device',
  'chat.welcome': 'What can I do for you?',
  'chat.welcomeBody':
    'The model runs on your GPU. It can search the web, read pages, and do exact arithmetic.',
  'chat.examples': 'Example prompts',
  'chat.example.1': 'What happened in tech news this week?',
  'chat.example.2': 'Calculate (17 * 23) / sqrt(2)',
  'chat.example.3': 'Summarise https://example.com in three sentences',
  'chat.working': 'Jarvis is working on a reply',
  'chat.jumpToLatest': 'Jump to latest',

  // Composer
  'composer.placeholder': 'Ask something…',
  'composer.message': 'Message',
  'composer.send': 'Send',
  'composer.stop': 'Stop',
  'composer.queue': 'Queue',
  'composer.dictate': 'Dictate',
  'composer.stopDictating': 'Stop dictating',
  'composer.dictate.hint': 'Dictate. The browser sends the audio to its speech service.',
  'composer.listening': 'Listening…',
  'composer.offline':
    'No connection. Jarvis answers from the live web, so it waits until you are back online.',
  'composer.waiting': 'Waiting to be sent',
  'composer.removeQueued': 'Remove “{text}” from the queue',
  'composer.replying': 'Jarvis is replying',
  'composer.enterQueues': 'queues your next message',
  'composer.enterSends': 'sends',
  'composer.shiftEnter': 'adds a line',
  'composer.disclaimer': 'Jarvis can make mistakes. Check important details.',

  // Message actions
  'message.copy': 'Copy reply',
  'message.copied': 'Reply copied',
  'message.readAloud': 'Read aloud',
  'message.stopReading': 'Stop reading',
  'message.regenerate': 'Regenerate',
  'message.tryAgain': 'Try again',
  'message.failed': 'The reply did not finish',

  // Dictation failures
  'dictation.refused': 'Microphone access was refused.',
  'dictation.noMicrophone': 'No microphone was found.',
  'dictation.nothingHeard': 'Nothing was heard.',
  'dictation.network': 'The speech service could not be reached.',
  'dictation.stopped': 'Dictation stopped.',
  'dictation.couldNotStart': 'Dictation could not start.',
} as const

export type MessageKey = keyof typeof en
