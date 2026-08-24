/**
 * The streaming caret already stops blinking for `prefers-reduced-motion`, in
 * CSS. Scrolling is the other moving thing in the app and it cannot be reached
 * from a stylesheet, so it has to ask.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
