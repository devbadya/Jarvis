import { useRef, type ReactNode, type SVGProps } from 'react'
import { Button } from '@heroui/react/button'
import { Link } from '@heroui/react/link'
import { InstallPanel } from './InstallPanel'
import { LanguageSwitch } from './LanguageSwitch'
import { Orb } from './ui/Orb'
import { Reveal } from './ui/Reveal'
import {
  ArrowUpIcon,
  BookmarkIcon,
  CalculatorIcon,
  CalendarIcon,
  ChipIcon,
  GithubIcon,
  GlobeIcon,
  MicIcon,
  PlugIcon,
  ShieldIcon,
  WifiOffIcon,
} from './ui/icons'
import { useT, type MessageKey } from '@/i18n'
import { MODEL_ID } from '@/llm/config'
import { scrollBehavior } from '@/lib/motion'

type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactNode

const CAPABILITIES: { icon: IconComponent; key: string }[] = [
  { icon: ChipIcon, key: 'gpu' },
  { icon: WifiOffIcon, key: 'offline' },
  { icon: GlobeIcon, key: 'web' },
  { icon: CalculatorIcon, key: 'math' },
  { icon: CalendarIcon, key: 'calendar' },
  { icon: BookmarkIcon, key: 'memory' },
  { icon: MicIcon, key: 'voice' },
  { icon: PlugIcon, key: 'mcp' },
]

const STEPS = ['install', 'ask', 'tools', 'check']

const REQUIREMENTS = ['browser', 'gpu', 'space']

function SectionTitle({ children, eyebrow }: { children: string; eyebrow: string }) {
  return (
    <div className="space-y-2">
      <p className="text-[0.68rem] font-medium tracking-[0.22em] text-brand uppercase">{eyebrow}</p>
      <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{children}</h2>
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
 *
 * The language switch sits above the headline, before any sentence, so a
 * reader who does not read English finds the way out before the words.
 */
export function Landing() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const t = useT()
  const k = (key: string): MessageKey => key as MessageKey

  const backToTop = (): void => {
    scrollRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() })
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-12 pb-24 sm:px-6 sm:pt-20">
        <section className="flex flex-col items-center text-center">
          <div className="animate-in fade-in zoom-in-95 duration-700">
            <Orb size={96} />
          </div>

          <div className="mt-8 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-100 fill-mode-both">
            <LanguageSwitch prominent />
            <p className="mt-2 text-xs text-muted">{t('language.hint')}</p>
          </div>

          <p className="mt-6 animate-in fade-in slide-in-from-bottom-3 rounded-full border border-border/70 bg-surface/40 px-3.5 py-1 text-[0.68rem] tracking-[0.18em] text-muted uppercase duration-700 delay-100 fill-mode-both">
            {t('landing.badge')}
          </p>

          <h2 className="mt-6 max-w-2xl animate-in fade-in blur-in slide-in-from-bottom-4 text-4xl font-semibold tracking-tight text-balance duration-700 delay-150 fill-mode-both sm:text-6xl">
            {t('landing.title.before')}
            <span className="brand-text">{t('landing.title.highlight')}</span>
            {t('landing.title.after')}
          </h2>

          <p className="mt-5 max-w-xl animate-in fade-in slide-in-from-bottom-4 text-pretty text-muted duration-700 delay-200 fill-mode-both">
            {t('landing.lede')}
          </p>

          <p className="mt-4 max-w-xl animate-in fade-in slide-in-from-bottom-4 text-sm text-pretty text-muted duration-700 delay-200 fill-mode-both">
            {t('landing.talk')}
          </p>

          <div className="mt-10 w-full max-w-xl animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300 fill-mode-both">
            <InstallPanel />
          </div>

          <dl className="mt-8 grid w-full max-w-xl animate-in fade-in grid-cols-3 gap-3 duration-1000 delay-500 fill-mode-both">
            {[
              ['448 MB', t('landing.stat.downloaded')],
              ['0', t('landing.stat.requests')],
              [t('landing.stat.tabValue'), t('landing.stat.tab')],
            ].map(([value, label]) => (
              <div key={label} className="hud-tile px-3 py-3.5">
                <dt className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</dt>
                <dd className="mt-0.5 text-[0.7rem] tracking-wide text-muted text-balance">{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <Reveal className="mt-28 space-y-8">
          <SectionTitle eyebrow={t('landing.capabilities.eyebrow')}>
            {t('landing.capabilities.title')}
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, key }, index) => (
              <Reveal key={key} className="h-full" delayMs={index * 60}>
                <article className="glass lift edge-beam h-full rounded-2xl border border-border/70 p-5">
                  <span className="lift-badge flex size-10 items-center justify-center rounded-xl bg-brand/12 text-brand">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-medium tracking-tight">{t(k(`landing.cap.${key}.title`))}</h3>
                  <p className="mt-1.5 text-sm text-pretty text-muted">{t(k(`landing.cap.${key}.body`))}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </Reveal>

        <Reveal className="mt-28 space-y-8">
          <SectionTitle eyebrow={t('landing.steps.eyebrow')}>{t('landing.steps.title')}</SectionTitle>
          <ol className="grid gap-4 sm:grid-cols-2">
            {STEPS.map((key, index) => (
              <li key={key} className="list-none">
                <Reveal className="h-full" delayMs={index * 80}>
                  <article className="glass edge-beam flex h-full gap-4 rounded-2xl border border-border/70 p-5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-brand/40 bg-brand/10 text-sm font-medium text-brand tabular-nums">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="font-medium tracking-tight">{t(k(`landing.step.${key}.title`))}</h3>
                      <p className="mt-1.5 text-sm text-pretty text-muted">
                        {t(k(`landing.step.${key}.body`))}
                      </p>
                    </div>
                  </article>
                </Reveal>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal className="mt-28 space-y-8">
          <SectionTitle eyebrow={t('landing.privacy.eyebrow')}>{t('landing.privacy.title')}</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="glass edge-beam rounded-2xl border border-success/30 p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-success-soft text-success-soft-foreground">
                <ShieldIcon className="size-5" />
              </span>
              <h3 className="mt-4 font-medium tracking-tight">{t('landing.privacy.stays.title')}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-muted">
                {[1, 2, 3, 4, 5].map((n) => (
                  <li key={n}>{t(k(`landing.privacy.stays.${n}`))}</li>
                ))}
              </ul>
            </div>
            <div className="glass edge-beam rounded-2xl border border-border/70 p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand/12 text-brand">
                <GlobeIcon className="size-5" />
              </span>
              <h3 className="mt-4 font-medium tracking-tight">{t('landing.privacy.leaves.title')}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-muted">
                {[1, 2, 3, 4, 5].map((n) => (
                  <li key={n}>{t(k(`landing.privacy.leaves.${n}`))}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-sm text-muted">{t('landing.privacy.note')}</p>
        </Reveal>

        <Reveal className="mt-28 space-y-8">
          <SectionTitle eyebrow={t('landing.requirements.eyebrow')}>
            {t('landing.requirements.title')}
          </SectionTitle>
          <dl className="glass edge-beam divide-y divide-separator rounded-2xl border border-border/70 px-5">
            {REQUIREMENTS.map((key) => (
              <div key={key} className="grid gap-1 py-4 sm:grid-cols-[16rem_1fr] sm:gap-6">
                <dt className="font-medium tracking-tight">{t(k(`landing.req.${key}.term`))}</dt>
                <dd className="text-sm text-muted">{t(k(`landing.req.${key}.detail`))}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-muted">
              <span className="font-mono">{MODEL_ID}</span> · {t('landing.licence')}
            </p>
            <div className="flex items-center gap-2">
              <Link
                href="https://github.com/devbadya/Jarvis"
                rel="noreferrer noopener"
                target="_blank"
                className="text-sm"
              >
                <GithubIcon className="size-4" />
                {t('landing.source')}
              </Link>
              <Button size="sm" variant="ghost" onPress={backToTop}>
                <ArrowUpIcon />
                {t('landing.backToTop')}
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
