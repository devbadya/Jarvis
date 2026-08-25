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

`EmptyState` looks useful and is not: it resolves to `p-2 text-sm text-muted` and nothing else.

`Badge` is the notification dot that hangs off a corner, not a status pill — so it is wrong for a
label and right for the unreachable-server count on the tools trigger. It needs a `Badge.Anchor`
around both the control and the badge; the anchor is the `relative` and the badge is the `absolute`.
Wrapping a `DialogTrigger`'s trigger in one is safe, because the trigger's press props come down by
context rather than by being the root's first child.

`ProgressBar` and `Meter` are not interchangeable. A progress bar is a task working its way to done
(the model download); a meter is a standing measurement against a known ceiling (storage quota), and
it renders as `role="meter"` with a grid that already has places for a label, an output and a track.

`ScrollShadow` has one variant, `fade`, and it is a `mask-image` — it makes the content at the edge
transparent, not just dimmer. Fine over a list of controls, wrong over prose someone is reading.

Inside a `TextField`, prefer HeroUI's own field parts to hand-wiring ARIA. `Description` renders into
the field's description slot, and `FieldError` renders when `isInvalid` is set and marks the input
invalid too — both are associated by React Aria, so an `aria-describedby` written by hand against an
id constant is a sign something is being done the long way. `Description` returns `null` outside a
field, by design.

`InputGroup.Suffix` is where an in-field control goes, such as the reveal on `ui/SecretField.tsx`.
Swap `type` on the `TextField`, not on the input, so the value keeps its label and error association.

`Link` is built for a link that stands on its own. `--link` is `--foreground` in both themes and the
underline only appears on hover, so dropped into a sentence it is indistinguishable from the words
beside it; it is also `inline-flex w-fit`, so a long URL will neither wrap nor sit on the baseline.
`RichText` overrides both with `inline`, `underline` and `[overflow-wrap:anywhere]` rather than
hand-rolling an `<a>`, which keeps the focus ring and the press states.

`Drawer.Content` is a full-viewport flex wrapper, not the panel — `placement="right"` is nothing but
a `justify-end` on it. Put a width there and the panel lands on the _left_; size `Drawer.Dialog`
instead, which already picks a sensible width per placement.

`Disclosure.Indicator` already **is** a chevron — HeroUI's own `IconChevronDown`, with the rotation
on `[data-expanded]` and the transition already written. It also carries `ms-auto`, which is right
for a full-width trigger row and wrong for a compact pill, where it parks the chevron a long way
from the words it belongs to; `ms-0` is the override. A `Disclosure.Content` keeps its children
mounted while collapsed (it animates `height`), so a test can find text inside a closed panel and
`aria-expanded` on the trigger is what actually proves the toggle works.

`Spinner` renders with `aria-label="Loading"` of its own, before the props it is given. Left alone
inside a `Disclosure.Trigger` that reads "Thinking…", the accessible name comes out as
"LoadingThinking…" — pass `aria-hidden` whenever the surrounding row already says what is happening.

`Avatar` is Radix underneath, not React Aria: `Avatar.Fallback` renders on its own with no
`Avatar.Image` beside it. The assistant's mark no longer uses it — it needs a halo that lights while
a reply streams, which is two stacked spans rather than a component.

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

**The palette is ours, through HeroUI's variables.** HeroUI declares `--accent`, `--background`,
`--surface`, `--border` and `--radius` as plain custom properties and derives every soft, hover and
border variant from them with `color-mix()`, which resolves at use time. `index.css` therefore
redefines those roots — same selectors, same layer, later in the file — and every component follows.
Change one there rather than reaching for a palette colour in a className. `--accent-foreground` has
to move with a light `--accent`: the dark theme's is bright enough that white text on an accent
button, or on a user bubble, would be unreadable.

`--brand` and `--brand-secondary` are ours alone, exposed to Tailwind through `@theme inline` so
`text-brand` and `bg-brand/12` exist. They are for the mark, the landing page and the glows — not a
second accent to colour controls with.

There is no CSS-in-JS and no stylesheet per component. The hand-written utilities are:

- `.caret`, the blinking cursor at the end of a streaming message. `RichText` puts it on the last
  block it renders rather than on the container, because `::after` on a block wrapper lands on its
  own line.
- `.shimmer`, the sweep across a label that is still being earned — the `Thinking…` trigger. It
  clips a gradient to the glyphs, so `color` is `transparent` while it runs. `.brand-text` is the
  same trick slowed to a drift, for the one landing headline that carries the brand.
- `.glass` and `.glass-dim`, translucent surface or background plus a backdrop blur, for the header,
  the composer and the landing cards. They exist because those panels sit over the ambient glow and
  an opaque one flattens it.
- `.reveal`, `.focus-glow`, `.progress-sheen` and `.orb-halo`, each documented where it is defined.

The ambient glow is `body::before`, not a div. A negative z-index only stays behind everything for
as long as no ancestor opens a stacking context, and body is the one element nothing can wrap.

Motion: entrances come from `tw-animate-css`, which `@heroui/styles` already imports — `animate-in
fade-in slide-in-from-bottom-4 duration-700 delay-150 fill-mode-both`, with no dependency of our
own. Note that its `delay-*` shadows Tailwind's transition delay and sets `animation-delay` instead;
`Reveal` therefore staggers with an inline `transitionDelay`. Only continuous motion gets keyframes
of its own.

One `prefers-reduced-motion` block zeroes every animation and transition. Anything scripted asks
separately, through `prefersReducedMotion()` / `scrollBehavior()` in `src/lib/motion.ts`. The two
gradients clipped to text need their colour putting back there as well as stopping — dropping the
sweep alone leaves transparent glyphs.

`Reveal` starts hidden, so it marks itself visible up front wherever nothing will mark it: jsdom,
which has no `IntersectionObserver`, and a reader who asked for less motion. Forget that and a test
passes against markup nobody can see.

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

Actions live in the store, not in components: `send`, `retry`, `stop`, `clear`, `initialize`,
`removeModel`, `setMcpServers`. A component calls them and renders the result. Async actions
returning promises are invoked as `onPress={() => void action()}`.

`send` decides for itself whether a message is answered now or queued behind the running turn, so
the composer clears its draft either way and never has to check `busy` first. The queue is store
state (`queued`, `unqueue`) rather than component state, because `stop` and `clear` both empty it and
`runTurn` drains it — three callers a local `useState` could not reach. A test can drive the queuing
half of that without a GPU by setting `status: 'ready'` and `busy: true` and awaiting `send`;
draining runs a real turn, so it belongs in `verify-in-browser`.

`stop()` reaches the worker, and a worker cannot be constructed under jsdom. Assert queue-clearing
against the store with `busy: false`, not by clicking Stop in a component test — the click spawns a
worker, fails asynchronously, and leaves a broken client cached in module state for every test after
it.

`send` and `retry` both end in the same private `runTurn`, which answers whatever user turn the
transcript currently ends with. `retry` gets there by rewinding past the reply it is replacing —
appending a second answer to one question would send both back as history. That rewind is only
correct for the newest reply, which is why `MessageItem` takes `isLatest` and shows the button
nowhere else.

A turn that throws sets `Message.error` and leaves `content` holding whatever streamed. Do not put a
failure into `content`; that is what this used to do, and a crashed worker read as a reply.

`EvalPanel` is the one component that drives the model itself, through the exported `getClient`
rather than a store action. It is a developer tool behind `?eval` whose results are not application
state, so it does not belong in the store. Do not treat it as licence to do the same in the chat UI.

Import through the `@/` alias for anything outside the current folder (`@/store/chat`,
`@/tools/mcp`), and relative paths for siblings (`./ui/RichText`).

## Rendering a reply

Assistant text goes through `ui/RichText.tsx`, over the block and span tree that
`src/lib/rich-text.ts` produces. It is not a Markdown implementation and should not become one: it
reads what a reply actually contains — the bare `Source: https://…` every skill in `src/skills` asks
for, plus the `**bold**`, `` `code` ``, lists and fences an instruct model emits unprompted.

Everything is constructed as elements, never parsed into HTML, so there is no sanitiser in the
picture and nothing to keep in step with one. Keep it that way: the only reason a `javascript:` URL
cannot reach an `href` is that the parser matches `https?://` and nothing else.

Single-asterisk emphasis is left out on purpose. The calculator makes `17 * 23 * 2` a plausible
reply, and italicising it is worse than leaving it alone.

Two things are lifted out of the text before it gets there, and both are presentation only —
`message.content` is what gets copied, checked by `reviewAnswer` and sent back as history, so
nothing here may rewrite it:

- **The citation line.** `splitSources` in `src/lib/sources.ts` recognises a trailing
  `Source: https://…` and hands it to `ui/Sources.tsx` as pills. It only fires on a line that is
  nothing but URLs, and only once the reply has finished, because a half-typed URL is nobody's
  citation.
- **The reasoning.** `ui/Reasoning.tsx` owns the whole collapsed-trace behaviour, including the
  measured duration that arrives as `Message.reasoningMs`. Do not expand it by default and do not
  feed it through `RichText`.

`describeTool` in `src/lib/tool-labels.ts` names only the tools this app ships. An MCP tool is named
by whoever wrote it and keeps that name, because inventing a verb for it would be a guess.

## Accessibility

Every field needs a name a test can query: a `Label` inside a `TextField`, or an `aria-label` where
there is no room for one.

```tsx
expect(screen.getByLabelText('Server URL')).toBeInTheDocument()
```

Buttons must have accessible names that read as their purpose, since tests use
`getByRole('button', { name: 'Send' })`. When a control carries a count or a state as a graphic —
the `Badge` on the tools trigger — hide the graphic and put the same fact into the accessible name
in words.

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

`Landing` renders `InstallPanel`, so `ModelGate.test.tsx` still queries the download's own strings
through the whole page. Two consequences: the install panel may appear **once** — a second copy
makes `getByText` throw on a duplicate rather than fail on a bug — and the landing's prose may not
repeat a string a test matches loosely. `IndexedDB` is the live example; it is asserted absent when
the backend is OPFS, so no marketing copy may mention it.

Keep these tests to rendering and interaction. jsdom has no WebGPU, no Web Worker running
Transformers.js and no OPFS, so anything touching the model belongs in a unit test over a pure
function instead — `parseModelOutput`, `evaluateExpression` and `cacheKeyFor` are all extracted for
exactly that reason. `pnpm test` runs once; `pnpm test:watch` while iterating.
