/**
 * The mark. Four stacked circles rather than an SVG, so it scales from the
 * header to the landing hero by nothing but a size and inherits the brand
 * colours from the theme instead of carrying its own.
 *
 * `active` breathes the halo while a reply is being generated: the header then
 * says the model is working without spending a word on it, and the composer's
 * own label stays the place where that is said in words.
 */
export function Orb({
  active = false,
  className = '',
  size = 22,
}: {
  active?: boolean
  className?: string
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ height: size, width: size }}
    >
      <span
        className={`absolute -inset-1 rounded-full bg-brand blur-md ${active ? 'orb-halo' : 'opacity-30'}`}
      />
      <span className="absolute inset-0 rounded-full bg-linear-to-br from-brand to-brand-secondary" />
      <span className="absolute inset-[18%] rounded-full bg-background" />
      <span className="absolute inset-[34%] rounded-full bg-linear-to-br from-brand to-brand-secondary" />
    </span>
  )
}
