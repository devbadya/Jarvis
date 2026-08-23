---
name: ui-components
description: Conventions for Jarvis's React 19 + HeroUI v3 + Tailwind 4 interface and its Vitest component tests. Use when adding or editing anything under src/components/, wiring a component to the Zustand store, styling with theme tokens, or writing a test that renders a component.
license: MIT
paths:
  - 'src/**/*.tsx'
  - 'src/index.css'
  - 'src/store/**'
---

# UI conventions

## HeroUI v3

Import from the component's own subpath, never the package root:

```tsx
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
```

HeroUI v3 is built on React Aria, so its props are not DOM props:

- `onPress`, not `onClick`
- `isDisabled`, not `disabled`
- `fullWidth`, `variant` (`primary`, `secondary`, `ghost`, `danger-soft`), `size`

A plain `<button type="button" onClick={…}>` is still fine for unstyled affordances. The distinction
is per component, not per file.

**Do not use HeroUI's `Tag` for a read-only label.** It is a React Aria collection item and throws
outside a `TagGroup`. `Chip` is the read-only pill: a plain `<span>` taking `color` and
`variant="soft"`. There used to be a hand-rolled `ui/Badge.tsx` here because the `Tag` failure was
read as "HeroUI has no pill"; it does, one export along.

Two more HeroUI components look useful and are not. `EmptyState` resolves to `p-2 text-sm text-muted`
and nothing else, and `Badge` is the notification dot that hangs off a corner, not a status pill.

`Drawer.Content` is a full-viewport flex wrapper, not the panel — `placement="right"` is nothing but
a `justify-end` on it. Put a width there and the panel lands on the _left_; size `Drawer.Dialog`
instead, which already picks a sensible width per placement.

`Drawer`, `AlertDialog` and `Tooltip` are all React Aria `DialogTrigger`s underneath: put the trigger
and the overlay side by side as children of the root and the trigger wires itself up, with no
`onPress` and no state of your own. `DialogTrigger` supplies its press props through context to every
pressable descendant, portal included, so buttons inside the overlay merge them too — harmless in
practice, since the trigger's handler only toggles a dialog that is already open, but it is why
`NewChatButton.test.tsx` asserts that "Keep chatting" leaves the transcript alone.

## Styling

Tailwind 4 via `@tailwindcss/vite`, with HeroUI's semantic tokens layered on top. `src/index.css`
imports `tailwindcss` before `@heroui/styles`, and that order matters.

Use the semantic tokens rather than raw palette colours, so both themes keep working:
`bg-background`, `text-foreground`, `bg-surface`, `bg-surface-hover`, `bg-surface-tertiary`,
`border-border`, `text-muted`, `text-danger`, `bg-success-soft`, `text-success-soft-foreground`.

There is no CSS-in-JS and no stylesheet per component. The only hand-written utility is `.caret`,
the blinking cursor shown at the end of a streaming message.

**Both themes really do exist now, so check both.** HeroUI hangs its dark palette off `.dark` /
`[data-theme="dark"]`; `applyTheme` in `src/lib/theme.ts` sets them, `ThemeToggle` drives it, and an
inline script in `index.html` repeats the same work before the first paint so the page never flashes
the wrong palette — change one and change all three. `index.css` redefines Tailwind's `dark:` variant
to match, because its `prefers-color-scheme` default disagrees the moment a user overrides the
system.

## Store

State is one Zustand store, `useChatStore` in `src/store/chat.ts`, with no provider. Select narrowly
in components that render during generation:

```tsx
const messages = useChatStore((state) => state.messages)
```

Streaming patches the store on every token, so a component that destructures the whole store
re-renders on each one. Destructuring is fine in panels that are not on the streaming path, such as
`SettingsPanel`.

Actions live in the store, not in components: `send`, `stop`, `clear`, `initialize`, `removeModel`,
`setMcpServers`. A component calls them and renders the result. Async actions returning promises are
invoked as `onPress={() => void action()}`.

`EvalPanel` is the one component that drives the model itself, through the exported `getClient`
rather than a store action. It is a developer tool behind `?eval` whose results are not application
state, so it does not belong in the store. Do not treat it as licence to do the same in the chat UI.

Import through the `@/` alias for anything outside the current folder (`@/store/chat`,
`@/tools/mcp`), and relative paths for siblings (`./ui/Badge`).

## Accessibility

Every `Input` and `TextArea` needs an `aria-label`; there are no visible `<label>` elements. This is
not only correctness — the component tests query by label:

```tsx
expect(screen.getByLabelText('Server URL')).toBeInTheDocument()
```

Buttons must have accessible names that read as their purpose, since tests use
`getByRole('button', { name: 'Send' })`.

## Tests

Vitest with the `jsdom` environment, `globals: true`, and `@testing-library/jest-dom/vitest` loaded
from `src/test/setup.ts`. A test file sits next to its component as `Name.test.tsx`.

Render against the real store — no mocking, no wrapper — and assert on what the user sees:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

it('enables sending once text is typed', async () => {
  const user = userEvent.setup()
  render(<Composer />)
  await user.type(screen.getByLabelText('Message'), 'Hello')
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
})
```

Keep these tests to rendering and interaction. jsdom has no WebGPU, no Web Worker running
Transformers.js and no OPFS, so anything touching the model belongs in a unit test over a pure
function instead — `parseModelOutput`, `evaluateExpression` and `cacheKeyFor` are all extracted for
exactly that reason. `pnpm test` runs once; `pnpm test:watch` while iterating.
