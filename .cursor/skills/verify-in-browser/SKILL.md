---
name: verify-in-browser
description: Verify Jarvis by hand in a real browser - model install, OPFS caching, storage persistence, service worker and offline behaviour, and the /api search and fetch proxy. Use when changing src/llm/opfs-cache.ts, src/lib/storage.ts, the PWA config in vite.config.ts, or whenever asked whether a change actually works end to end.
license: MIT
compatibility: Generation requires Chrome or Edge 113+ with WebGPU and roughly 4 GB of GPU memory. Everything else runs headless.
---

# Verifying Jarvis by hand

## Know what you can and cannot prove

There is **no CPU fallback**. The model's Gated DeltaNet layers need the `CausalConvWithState`
operator, which only ONNX Runtime Web implements, so generation runs on WebGPU or not at all. A
headless CI runner or a VM without hardware acceleration cannot produce a token.

| Behaviour                                           | How to verify                            |
| --------------------------------------------------- | ---------------------------------------- |
| Parsing, the agent loop, the calculator, cache keys | `pnpm test`                              |
| Types, bundle, PWA manifest generation              | `pnpm build`                             |
| `/api/search` and `/api/fetch`                      | `curl` against the dev or preview server |
| UI rendering and interaction                        | Vitest + Testing Library, or a browser   |
| Model install, OPFS, persistence, offline           | Chrome or Edge, by hand                  |
| Token generation and tool calling                   | Chrome or Edge with a real GPU, by hand  |

If a GPU is not available, say so rather than claiming the model path was tested.

## Which server to run

**The service worker is disabled in development** (`devOptions.enabled: false`). `pnpm dev` on
http://localhost:5173 is right for UI and tool work, and useless for anything about caching,
installation or offline.

For anything PWA-related use the production build:

```bash
pnpm build && pnpm preview
```

Both servers mount the `/api` middleware — the plugin registers `configureServer` _and_
`configurePreviewServer` — so `web_search` and `read_page` work in either.

## Model install

Press **Install model** on the gate screen. It downloads seven files, about 467 MB in total, of
which `onnx/model_q4f16.onnx_data` is 448 MB. Expect roughly four minutes on a first run and about
a second on a second visit.

The gate screen is the fastest read on state: it shows whether the model is installed, how much
space it occupies, whether storage is persistent, and offers **Remove model**.

To inspect the cache directly, open DevTools → Application → Storage. Weights live in the Origin
Private File System under `model-cache/`, with filenames that are the download URL flattened by
`cacheKeyFor` (`huggingface.co_onnx-community_…_model_q4f16.onnx`). A name ending in `.part` is an
in-flight or abandoned download and is deliberately invisible to `listCachedFiles`.

To retest an install, use **Remove model**. Clearing site data also drops the persistence grant,
which is sometimes what you want to test and usually not.

## Storage persistence

`navigator.storage.persist()` is called before downloading. Chrome grants it silently for installed
PWAs and sufficiently engaged sites and denies it silently otherwise, so **a `false` result is not a
failure** and must not be reported as one. To test the granted path, install the app as a PWA from
the icon in the address bar.

## Offline

1. `pnpm build && pnpm preview`, then install the model and let the page settle.
2. DevTools → Network → Offline, or stop the preview server.
3. Reload. The app shell comes from the precache (~1 MB: js, css, html, svg), and the weights and
   the ONNX runtime come from OPFS.

`web_search` and `read_page` will fail offline, by design — they need the proxy.

A new build does **not** reload an open tab. `registerType` is `'prompt'` on purpose so an in-flight
conversation is never discarded; a new version takes over once every tab has been closed. When
testing an update, close all tabs rather than waiting for a refresh.

## The proxy endpoints

```bash
curl 'http://localhost:5173/api/search?q=webgpu&limit=3'
curl 'http://localhost:5173/api/fetch?url=https://example.com'
```

Both return JSON with either the payload or an `error` field. `assertPublicUrl` refuses loopback,
link-local and RFC1918 targets, so `curl '…/api/fetch?url=http://127.0.0.1'` returning an error is
the correct result.

## WebGPU is missing

`detectWebGpu` in `src/lib/webgpu.ts` distinguishes the two cases: no `navigator.gpu` at all means
the browser is unsupported; a present API that returns no adapter usually means hardware
acceleration is off, which is the normal state on Linux VMs and headless runners. Check
`chrome://gpu` before assuming the app is broken.
