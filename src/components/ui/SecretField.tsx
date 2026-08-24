import { useState } from 'react'
import { Button } from '@heroui/react/button'
import { Description } from '@heroui/react/description'
import { FieldError } from '@heroui/react/field-error'
import { InputGroup } from '@heroui/react/input-group'
import { Label } from '@heroui/react/label'
import { TextField } from '@heroui/react/textfield'
import { EyeIcon, EyeOffIcon } from './icons'

interface SecretFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Shown under the field and wired to it by HeroUI, not by hand. */
  description?: string
  /** Present only when the value is wrong; renders as the field's own error. */
  error?: string
}

/**
 * An API key someone pasted from a provider's dashboard, which they cannot
 * check without being able to see it once. A masked field with no way to
 * reveal it turns one bad paste into a tool that fails for no stated reason.
 *
 * The reveal is a `TextField` type swap rather than anything of our own, so the
 * value keeps its label, its description and its error association throughout.
 */
export function SecretField({ label, value, onChange, placeholder, description, error }: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false)

  return (
    <TextField
      isInvalid={Boolean(error)}
      type={revealed ? 'text' : 'password'}
      value={value}
      onChange={onChange}
    >
      <Label>{label}</Label>
      <InputGroup>
        <InputGroup.Input placeholder={placeholder} />
        <InputGroup.Suffix>
          <Button
            aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => setRevealed((current) => !current)}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      {description && <Description>{description}</Description>}
      <FieldError>{error}</FieldError>
    </TextField>
  )
}
