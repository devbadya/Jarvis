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
headless CI runner or a VM without hardware acceleration cannot produce a token, and loading the
weights in Node fails with `is not a registered function/op` after the download completes.

| Behaviour                                            | How to verify                           |
| ---------------------------------------------------- | --------------------------------------- |
| Parsing, the agent loop, the calculator, cache keys  | `pnpm test`                             |
| Weights reachable, chat template, budget assumptions | `node tools/verify-model.mjs`           |
| Types, bundle, PWA manifest generation               | `pnpm build`                            |
| `web_search` and `read_page` surviving CORS          | The page-context snippet below          |
| UI rendering and interaction                         | Vitest + Testing Library, or a browser  |
| Model install, OPFS, persistence, offline            | Chrome or Edge, by hand                 |
| Token generation and tool calling                    | Chrome or Edge with a real GPU, by hand |
| Tool routing and answer accuracy                     | The `?eval` harness, same requirements  |

If a GPU is not available, say so rather than claiming the model path was tested.

## Which server to run

**The service worker is disabled in development** (`devOptions.enabled: false`). `pnpm dev` on
http://localhost:5173 is right for UI and tool work, and useless for anything about caching,
installation or offline.

For anything PWA-related use the production build:

```bash
pnpm build && pnpm preview
```

`web_search` and `read_page` work in either, and in a plain static host too: they call their
providers from the page and need nothing from the server.

## The eval harness

<http://localhost:5173/?eval> swaps the chat for the harness. It lives behind a query flag, and in
the app rather than in a script, because the model only exists where WebGPU does. It sweeps the
strategies in `src/llm/config.ts` over the scenarios in `src/eval/scenarios.ts` and scores routing
and answers separately.

Repeat is the outer loop on purpose, so a GPU that throttles part way through does not penalise
whichever strategy ran last. Sampling is on, so one repeat is noise — a comparison needs several.
Scenarios marked `online` need the proxy and a working network, so leave them out when offline.

## Model install

Press **Install model** on the gate screen. It downloads seven files, about 467 MB in total, of
which `onnx/model_q4f16.onnx_data` is 448 MB. Expect roughly four minutes on a first run and about
a second on a second visit.

The gate screen is the fastest read on state: it shows whether the model is installed, how much
space it occupies, whether storage is persistent, and offers **Remove model**. It reads `.onnx_data`
as the test of "installed", so a run that fetched only the small files still shows as not installed.

To exercise the resume path, install with DevTools → Network → Offline switched on part way through,
or kill the tab mid-download. The cache retries three times on its own first, so leave it offline
long enough to see it give up. The gate then reads **partly downloaded** with a **Resume install**
button, `model_q4f16.onnx_data.part` and a `.part-meta` sidecar are in OPFS, and the next attempt
sends `Range: bytes=<size of the partial>-` — visible in the Network panel as a `206`. Restarting
from zero instead means the sidecar's `ETag` no longer matched, which is the correct response to the
weights having changed upstream and worth confirming before calling it a bug.

The progress bar during an install is reported by the cache, not by Transformers.js, because the
library is handed a file that is already on disk. A bar that stalls at half while bytes are clearly
arriving means the URL-to-filename mapping in `worker.ts` has drifted and one file is being counted
twice.

To inspect the cache directly, open DevTools → Application → Storage. Weights live in the Origin
Private File System under `model-cache/`, with filenames that are the download URL flattened by
`cacheKeyFor` (`huggingface.co_onnx-community_…_model_q4f16.onnx`). A name ending in `.part` is an
in-flight or abandoned download and is deliberately invisible to `listCachedFiles`; the matching
`.part-meta` holds the `ETag` and total size a resume is checked against.

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

`web_search` and `read_page` will fail offline, by design — they need the network.

A new build does **not** reload an open tab. `registerType` is `'prompt'` on purpose so an in-flight
conversation is never discarded; a new version takes over once every tab has been closed. When
testing an update, close all tabs rather than waiting for a refresh.

## The network tools

`curl` cannot verify these. The thing most likely to be broken is CORS, and CORS is enforced by the
browser against the page's origin — a request from a shell has no origin and will happily succeed
where the app fails. Exercise the real module from a real page instead. In the DevTools console at
http://localhost:5173:

```js
const web = await import('/src/tools/web.ts')
await web.searchWeb('webgpu', 3, { provider: 'wikipedia' })
await web.readPage('https://example.com', { provider: 'wikipedia' })
```

Watch the console as well as the return value: a CORS failure surfaces there and reaches the caller
only as an opaque `TypeError`. A provider returning a readable 401 is the opposite — proof its
headers are present and only the key is wrong.

`assertPublicHttpUrl` refuses loopback, link-local and RFC1918 targets, so
`web.readPage('http://127.0.0.1/', { provider: 'wikipedia' })` rejecting is the correct result.

## WebGPU is missing

`detectWebGpu` in `src/lib/webgpu.ts` distinguishes the two cases: no `navigator.gpu` at all means
the browser is unsupported; a present API that returns no adapter usually means hardware
acceleration is off, which is the normal state on Linux VMs and headless runners. Check
`chrome://gpu` before assuming the app is broken.
