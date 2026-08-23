import type { ReactNode } from 'react'
import { Radio } from '@heroui/react/radio'

/**
 * HeroUI's Radio is a slot composition: used on its own it renders its children
 * and nothing else — no control, no radio role. This assembles the parts once so
 * a list of choices stays readable at the call site.
 */
export function RadioOption({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Radio value={value}>
      <Radio.Content>
        <Radio.Control>
          <Radio.Indicator />
        </Radio.Control>
        {children}
      </Radio.Content>
    </Radio>
  )
}
