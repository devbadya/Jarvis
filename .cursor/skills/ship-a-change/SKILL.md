---
name: ship-a-change
description: Get a change through CI and onto GitHub Pages for Jarvis. Use before committing or opening a PR, when a CI check fails, when cutting a release, or when editing vite.config.ts, package.json or anything under .github/workflows.
license: MIT
---

# Shipping a change

## Preflight

```bash
pnpm check   # lint, format:check, typecheck, test — exactly what CI's first four steps run
pnpm build   # CI runs this too, and it typechecks the whole project again
```

`pnpm check` is `format:check`, not `format`. If it fails on formatting, run `pnpm format` and
commit the result — do not hand-fix. Prettier here means no semicolons, single quotes, a 110
character width and trailing commas everywhere; `dist`, `coverage` and `pnpm-lock.yaml` are ignored.

Lint is oxlint with the React and TypeScript plugins. `react/rules-of-hooks` is an error and
`react/only-export-components` is a warning that allows constant exports.

## What CI does

`.github/workflows/ci.yml` runs on pull requests and as a reusable workflow. It does not run on
push — pushes to `main` reach the same checks through `deploy.yml`, which calls it as a gate, so
adding a `push` trigger would double every run. It installs with `--frozen-lockfile` on Node 22, so
**commit `pnpm-lock.yaml`** with any dependency change and leave the `packageManager` field in
`package.json` alone; `pnpm/action-setup` reads the pnpm version from it.

## What deploying does

Every push to `main` runs `deploy.yml`: verify → build → deploy to Pages → release. Nothing is
published unless lint, formatting, types, tests and the build all pass.

Three details keep the app working from a repository sub-path. Do not undo them:

- **`base` comes from `BASE_PATH` at build time**, resolved from what `actions/configure-pages`
  reports, and the PWA manifest's `start_url` and `scope` follow it. Never hardcode an absolute
  asset path; use the `@/` alias for modules and let Vite rewrite asset URLs.
- **`404.html` is a copy of `index.html`**, so deep links open the app before the service worker is
  installed.
- **`VITE_AGENT_API_BASE` is empty on Pages** unless the repository variable `AGENT_API_BASE` is
  set, which drops `web_search` and `read_page` from the tool list rather than offering tools that
  fail on every call. Any new tool needing the proxy must be gated behind `webToolsAvailable` the
  same way.

The Pages concurrency group deliberately does not cancel in-progress runs: cancelling mid-deploy can
leave the site half-published.

A fork needs one manual step that CI cannot do without administration rights: **Settings → Pages →
Source: GitHub Actions**.

## Releasing

**A release is a version bump.** Change `version` in `package.json`; when the commit lands on `main`
the workflow creates tag `v<version>` with generated notes. If the tag already exists it is a no-op,
which is why ordinary commits deploy without piling up empty releases. Do not create tags by hand.

## Changing the build config

The Workbox and Vite settings carry load-bearing comments. Before editing `vite.config.ts`:

- `globPatterns` is `js,css,html,svg` on purpose. Adding `wasm` precaches an ONNX runtime copy that
  is never requested — Transformers.js fetches it from its own CDN and our OPFS cache stores it.
  Adding `png` duplicates precache entries the manifest already covers.
- `@huggingface/transformers` is in `optimizeDeps.exclude`; it ships prebuilt wasm and worker assets
  that Vite must not pre-bundle.
- `registerType` stays `'prompt'`. `'autoUpdate'` reloads the tab on a new build and discards the
  conversation.
- Hugging Face requests are `NetworkOnly`, and Workbox must not manage the weights.

## Documentation

`README.md` is the project's documentation and is kept current: the Tools table, the Scripts table
and the model file list all describe real behaviour. Update it in the same commit as the change it
describes.
