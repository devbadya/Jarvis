import { useRef, type ReactNode, type SVGProps } from 'react'
import { Button } from '@heroui/react/button'
import { Link } from '@heroui/react/link'
import { InstallPanel } from './InstallPanel'
import { Orb } from './ui/Orb'
import { Reveal } from './ui/Reveal'
import {
  ArrowUpIcon,
  BookmarkIcon,
  CalculatorIcon,
  ChipIcon,
  GithubIcon,
  GlobeIcon,
  PlugIcon,
  ShieldIcon,
  WifiOffIcon,
} from './ui/icons'
import { MODEL_ID } from '@/llm/config'
import { scrollBehavior } from '@/lib/motion'
import { useChatStore } from '@/store/chat'

type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactNode

const LOCAL_CAPABILITIES: { body: string; icon: IconComponent; title: string }[] = [
  {
    icon: ChipIcon,
    title: 'Your GPU does the work',
    body: 'The weights run through WebGPU in a Web Worker, so the interface keeps answering while tokens arrive.',
  },
  {
    icon: WifiOffIcon,
    title: 'Waits for a connection',
    body: 'The weights are yours after the download, but the facts are not. Offline it would answer from memory alone, so it does not answer at all.',
  },
  {
    icon: GlobeIcon,
    title: 'Searches and reads the web',
    body: 'DuckDuckGo, Wikipedia or Jina for search and a reader for whole pages, both called straight from this tab.',
  },
  {
    icon: CalculatorIcon,
    title: 'Arithmetic it cannot fumble',
    body: 'A small model guesses at long multiplication. This one hands the expression to a calculator and quotes what came back.',
  },
  {
    icon: BookmarkIcon,
    title: 'Remembers across chats',
    body: 'Tell it something worth keeping and it is recalled into the prompt next time, editable and deletable by you.',
  },
  {
    icon: PlugIcon,
    title: 'Connects to MCP servers',
    body: 'Point it at an HTTP endpoint and that server’s tools join the list this model is allowed to call.',
  },
]

const HOSTED_CAPABILITIES: { body: string; icon: IconComponent; title: string }[] = [
  {
    icon: ChipIcon,
    title: 'Claude Opus answers',
    body: 'Generation runs on Anthropic through the tool proxy you host. Visitors never paste a key, and this tab does not need a GPU.',
  },
  {
    icon: WifiOffIcon,
    title: 'Needs a connection',
    body: 'Every reply goes through the proxy. Offline it cannot reach Opus, so it does not pretend to answer from memory alone.',
  },
  {
    icon: GlobeIcon,
    title: 'Searches and reads the web',
    body: 'DuckDuckGo, Wikipedia or Jina for search and a reader for whole pages, both still called from this tab.',
  },
  {
    icon: CalculatorIcon,
    title: 'Arithmetic it cannot fumble',
    body: 'Exact calculations go to the calculator tool rather than being guessed in the reply.',
  },
  {
    icon: BookmarkIcon,
    title: 'Remembers across chats',
    body: 'Tell it something worth keeping and it is recalled into the prompt next time, editable and deletable by you.',
  },
  {
    icon: PlugIcon,
    title: 'Connects to MCP servers',
    body: 'Point it at an HTTP endpoint and that server’s tools join the list this model is allowed to call.',
  },
]

const LOCAL_STEPS: { body: string; title: string }[] = [
  {
    title: 'Install once',
    body: 'The weights stream into this browser’s storage. A download interrupted half way through continues from where it stopped rather than starting again.',
  },
  {
    title: 'Ask in any language',
    body: 'Your question is matched against a set of skills — worked examples that show a small model what a good answer to this kind of request looks like.',
  },
  {
    title: 'It reaches for tools',
    body: 'Search, a page reader, the calculator, its memory and any server you connected. Every call is named in words while it runs.',
  },
  {
    title: 'The answer is checked',
    body: 'Before a reply is shown it is read back against what the tools returned. A number the tools disagree with, or a source nothing ever fetched, is corrected or flagged.',
  },
]

const HOSTED_STEPS: { body: string; title: string }[] = [
  {
    title: 'No download',
    body: 'Nothing is fetched into this browser. The landing page starts the hosted model as soon as the proxy advertises one.',
  },
  {
    title: 'Ask in any language',
    body: 'The same tools and memories are available. Opus does the answering; this tab still executes every tool call.',
  },
  {
    title: 'It reaches for tools',
    body: 'Search, a page reader, the calculator, its memory and any server you connected. Every call is named in words while it runs.',
  },
  {
    title: 'The answer is checked',
    body: 'Before a reply is shown it is read back against what the tools returned. A number the tools disagree with, or a source nothing ever fetched, is corrected or flagged.',
  },
]

function SectionTitle({ children, eyebrow }: { children: string; eyebrow: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{children}</h2>
    </div>
  )
}

/**
 * The first screen of every visit, because the model has to be started by hand
 * even once it is installed. It has one job the old gate could not do: say what
 * this thing is and what it costs before asking anyone to spend 448 MB on it.
 *
 * `InstallPanel` appears exactly once, in the hero. Rendering a second copy
 * further down would double every state it reports.
 */
export function Landing() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostedChat = useChatStore((state) => state.hostedChat)
  const hosted = hostedChat !== null

  const backToTop = (): void => {
    scrollRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() })
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-10 pb-20 sm:px-6 sm:pt-16">
        <section className="flex flex-col items-center text-center">
          <div className="animate-in fade-in zoom-in-95 duration-700">
            <Orb size={84} />
          </div>

          <p className="mt-8 animate-in fade-in slide-in-from-bottom-3 rounded-full border border-border/70 px-3 py-1 text-xs text-muted duration-700 delay-100 fill-mode-both">
            {hosted
              ? 'Hosted · Claude Opus · no install, no GPU'
              : 'On-device · WebGPU · no account, no API key'}
          </p>

          <h2 className="mt-5 max-w-2xl animate-in fade-in blur-in slide-in-from-bottom-4 text-4xl font-semibold tracking-tight text-balance duration-700 delay-150 fill-mode-both sm:text-5xl">
            {hosted ? (
              <>
                A frontier model, <span className="brand-text">in this chat</span>.
              </>
            ) : (
              <>
                The model runs <span className="brand-text">in this tab</span>.
              </>
            )}
          </h2>

          <p className="mt-5 max-w-xl animate-in fade-in slide-in-from-bottom-4 text-pretty text-muted duration-700 delay-200 fill-mode-both">
            {hosted
              ? 'Jarvis sends this conversation to Claude Opus through your tool proxy. Visitors do not paste an API key. Tools still run in this tab, and memories stay in this browser.'
              : 'Jarvis is a chat agent whose language model never leaves this tab. It is downloaded once, kept in this browser and executed on your own GPU — so there is no per-token cost, and no conversation is handed to a model provider.'}
          </p>

          <div className="mt-10 w-full max-w-xl animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300 fill-mode-both">
            <InstallPanel />
          </div>

          <dl className="mt-8 grid w-full max-w-xl animate-in fade-in grid-cols-3 gap-4 duration-1000 delay-500 fill-mode-both">
            {[
              hosted ? [hostedChat.model, 'on the proxy'] : ['448 MB', 'downloaded once'],
              hosted ? ['0', 'files to install'] : ['0', 'requests to a model provider'],
              hosted ? ['1 key', 'yours, on the server'] : ['1 tab', 'the entire stack'],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="text-xl font-semibold tracking-tight sm:text-2xl">{value}</dt>
                <dd className="text-xs text-muted text-balance">{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <Reveal className="mt-24 space-y-8">
          <SectionTitle eyebrow="What it can do">
            {hosted ? 'A frontier model, with tools' : 'A small model, given help'}
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(hosted ? HOSTED_CAPABILITIES : LOCAL_CAPABILITIES).map(({ body, icon: Icon, title }, index) => (
              <Reveal key={title} className="h-full" delayMs={index * 60}>
                <article className="glass lift h-full rounded-2xl border border-border/70 p-5">
                  <span className="lift-badge flex size-9 items-center justify-center rounded-xl bg-brand/12 text-brand">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-medium">{title}</h3>
                  <p className="mt-1.5 text-sm text-pretty text-muted">{body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </Reveal>

        <Reveal className="mt-24 space-y-8">
          <SectionTitle eyebrow="How it works">From your question to a checked answer</SectionTitle>
          <ol className="grid gap-4 sm:grid-cols-2">
            {(hosted ? HOSTED_STEPS : LOCAL_STEPS).map(({ body, title }, index) => (
              <li key={title} className="list-none">
                <Reveal className="h-full" delayMs={index * 80}>
                  <article className="glass flex h-full gap-4 rounded-2xl border border-border/70 p-5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-brand/40 text-sm font-medium text-brand">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="font-medium">{title}</h3>
                      <p className="mt-1.5 text-sm text-pretty text-muted">{body}</p>
                    </div>
                  </article>
                </Reveal>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal className="mt-24 space-y-8">
          <SectionTitle eyebrow="Privacy">What actually leaves the browser</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="glass rounded-2xl border border-success/30 p-5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-success-soft text-success-soft-foreground">
                <ShieldIcon className="size-5" />
              </span>
              <h3 className="mt-4 font-medium">{hosted ? 'Stays in this browser' : 'Stays in this tab'}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-muted">
                {hosted ? (
                  <>
                    <li>Memories you asked it to keep</li>
                    <li>MCP keys and the servers you added</li>
                    <li>The page itself, and this install</li>
                  </>
                ) : (
                  <>
                    <li>Everything you type, and every reply</li>
                    <li>The model’s reasoning and its tool results</li>
                    <li>Whatever it has been asked to remember</li>
                    <li>The weights themselves, after the download</li>
                  </>
                )}
              </ul>
            </div>
            <div className="glass rounded-2xl border border-border/70 p-5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand/12 text-brand">
                <GlobeIcon className="size-5" />
              </span>
              <h3 className="mt-4 font-medium">
                {hosted ? 'Goes to Anthropic, and to tools' : 'Goes out, and only when a tool runs'}
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm text-muted">
                {hosted ? (
                  <>
                    <li>The conversation, through the tool proxy you run</li>
                    <li>The search terms of a web search</li>
                    <li>The address of a page you asked it to read</li>
                    <li>A place name, when you ask about the weather or the time somewhere else</li>
                  </>
                ) : (
                  <>
                    <li>The search terms of a web search</li>
                    <li>The address of a page you asked it to read</li>
                    <li>A place name, when you ask about the weather or the time somewhere else</li>
                    <li>Whatever you send to an MCP server you added</li>
                  </>
                )}
              </ul>
            </div>
          </div>
          <p className="text-sm text-muted">
            {hosted
              ? 'Chats go to Anthropic through the tool proxy you run. Memories, MCP keys and the page itself stay in this browser. Search and page reads still leave when a tool runs.'
              : 'There is no server of ours in either column on the hosted site. The build is a directory of static files. A tool proxy you run yourself can sit in front of search and page reads; the model still does not leave this tab.'}
          </p>
        </Reveal>

        <Reveal className="mt-24 space-y-8">
          <SectionTitle eyebrow="Before you start">What this browser needs</SectionTitle>
          <dl className="glass divide-y divide-separator rounded-2xl border border-border/70 px-5">
            {(hosted
              ? [
                  [
                    'A live tool proxy',
                    'Railway or pnpm proxy, with ANTHROPIC_API_KEY set. The key never enters this page.',
                  ],
                  [
                    'A matching origin allowlist',
                    'PROXY_ORIGINS must include this site, or strangers can spend the model key.',
                  ],
                  [
                    'A network connection',
                    'Every reply goes through that proxy to Anthropic. There is no on-device fallback on this path.',
                  ],
                ]
              : [
                  [
                    'Chrome or Edge 113+',
                    'Generation has no CPU fallback — WebGPU is the only path the weights can run on.',
                  ],
                  [
                    'About 4 GB of GPU memory',
                    'Less than that and the model will not fit beside your desktop.',
                  ],
                  ['448 MB of free space', 'Kept for as long as you keep it. Removing it is one button.'],
                ]
            ).map(([term, detail]) => (
              <div key={term} className="grid gap-1 py-4 sm:grid-cols-[16rem_1fr] sm:gap-6">
                <dt className="font-medium">{term}</dt>
                <dd className="text-sm text-muted">{detail}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-muted">
              <span className="font-mono">{MODEL_ID}</span> · MIT licensed
            </p>
            <div className="flex items-center gap-2">
              <Link
                href="https://github.com/devbadya/Jarvis"
                rel="noreferrer noopener"
                target="_blank"
                className="text-sm"
              >
                <GithubIcon className="size-4" />
                Source
              </Link>
              <Button size="sm" variant="ghost" onPress={backToTop}>
                <ArrowUpIcon />
                Back to the top
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
