import { useEffect, useState } from 'react'
import { Button } from '@heroui/react/button'
import { CheckIcon, CopyIcon } from './icons'

/** Long enough to read the tick, short enough that the button is ready again. */
const RESET_MS = 1500

/**
 * Copies text and says so, or says nothing at all.
 *
 * The clipboard is refused outright in an insecure origin and behind a denied
 * permission, and a button that claims a copy which did not happen is the one
 * outcome worse than a button that stays quiet.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  className,
}: {
  text: string
  label: string
  copiedLabel: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), RESET_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Nothing to say that would be true.
    }
  }

  return (
    <Button
      aria-label={copied ? copiedLabel : label}
      className={className}
      isIconOnly
      size="sm"
      variant="ghost"
      onPress={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}
