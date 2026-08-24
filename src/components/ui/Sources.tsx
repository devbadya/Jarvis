import { Link } from '@heroui/react/link'
import { GlobeIcon } from './icons'
import { labelSources } from '@/lib/sources'

/**
 * What the reply cited, as pills.
 *
 * No favicons, deliberately. Every favicon service is a request to a third
 * party carrying the domain the user is reading about, which is not a trade
 * this app gets to make on their behalf — the whole point of it is that nothing
 * leaves the device unless a tool was asked to fetch something.
 */
export function Sources({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">{urls.length === 1 ? 'Source' : 'Sources'}</span>
      {labelSources(urls).map(({ url, label }) => (
        <Link
          key={url}
          className="max-w-full rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-xs no-underline hover:bg-surface-hover hover:no-underline"
          href={url}
          rel="noreferrer noopener"
          target="_blank"
        >
          <GlobeIcon className="size-3.5 shrink-0 opacity-60" />
          <span className="truncate">{label}</span>
        </Link>
      ))}
    </div>
  )
}
