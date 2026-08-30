# Jarvis

**[Try it →](https://devbadya.github.io/Jarvis/)** (Chrome or Edge 113+, ~4 GB of GPU memory)

A chat agent that runs its language model **inside your browser**. Qwen3.5-0.8B is executed on your own GPU through WebGPU, so there is no API key, no per-token cost, and no conversation sent to a model provider. Install it once and every later visit starts in about a second.

It does need a connection to answer, which is a deliberate limit rather than a missing feature — see [why it waits for a connection](#why-it-waits-for-a-connection).

The agent can search, read pages, calculate exactly, remember things you tell it, and call any MCP server you connect. Because a 0.8B model needs the help, common requests are routed through [skills](#skills) that show it a worked example rather than telling it what to do.

The published site has no backend. `pnpm build` produces a directory of static files that GitHub Pages can host, and every tool ships there — that is why the deployed site above has the full tool set rather than a reduced one. An optional [tool proxy](#optional-tool-proxy) lives in `tools/` for DuckDuckGo search and page reads without CORS: `pnpm dev` uses it locally, `pnpm proxy` runs it on its own. Inference stays in the tab either way.

## How it works

```
Browser tab
├── UI (React 19 + HeroUI v3)
├── Service worker ──► app shell + ONNX runtime precached (a one-second start)
├── Web Worker ──────► Transformers.js ──► ONNX Runtime Web ──► WebGPU
├── Skills ──────────► worked examples + a narrowed tool list, matched per turn
├── Memory ──────────► IndexedDB ──► recalled into the prompt, managed by tool
├── Answer check ────► every reply, read back against the tool results
└── Tool loop ───────► search provider  (DuckDuckGo, Wikipedia, or LangSearch/Jina with your key)
                    ├► r.jina.ai        (page reader)
                    ├► MediaWiki        (Wikipedia pages, no reader budget)
                    ├► MCP servers over HTTP
                    └► optional tool proxy  (`/api/search`, `/api/fetch`)
```

Inference lives in a Web Worker. A 0.8B forward pass on the main thread would freeze the interface between every streamed token.

The model emits reasoning inside `<think>` blocks and tool requests as JSON inside `<tool_call>` blocks. `src/agent/parse.ts` separates the three streams; `src/agent/loop.ts` executes the requested tools and feeds their output back until the model answers without asking for another tool. That is capped at four rounds, and [reaching the cap still produces an answer](#when-a-turn-runs-out-of-tool-rounds) rather than an apology. The answer it settles on is then [checked against what the tools returned](#checking-the-answer-before-it-is-shown) before anyone sees it.

## The first screen

The model has to be started by hand even once it is installed, so `ModelGate` stands in front of the chat on every visit. That makes it the page anyone arriving here reads first, and `src/components/Landing.tsx` treats it as one: what this is, what it can do, how a question becomes a checked answer, what actually leaves the browser, and what this browser needs before any of it works. The functional half — the GPU check, the storage figures, the download and its progress — is `src/components/InstallPanel.tsx`, and it sits in the hero as the call to action. It appears exactly once; a second copy would report two of every state.

Asking for 448 MB is a bigger request than a button can make on its own, which is the whole argument for the page: the numbers it quotes are the ones the install is about to spend.

The interface it introduces is built out of HeroUI's own tokens rather than a palette of its own. HeroUI declares its colours as plain custom properties and derives its soft, hover and border variants from them with `color-mix()`, which resolves at use time — so redefining a handful of roots in `src/index.css` recolours every component at once, and both themes keep working without a component ever naming a colour. Motion follows the same rule: `tw-animate-css` comes in with `@heroui/styles`, three things that move continuously have keyframes of their own, and one `prefers-reduced-motion` block switches all of it off.

## Why it waits for a connection

The weights are local. The facts are not.

Nothing about being offline makes the model's knowledge older — it is exactly as old either way, fixed on the day it was trained. What a connection buys is the tool loop: search, the page reader, the weather lookup, the world clock and any MCP server. Take those away and a 0.8B model has only what it memorised, with nothing left to check it against, and the [answer check](#checking-the-answer-before-it-is-shown) fails open because there are no tool results to read the reply back to. That is the shape of a confident wrong answer, and it is the failure this app spends the most effort avoiding everywhere else.

So no turn starts without a connection. `send`, `retry` and the queue behind a running turn all refuse, and the composer says why instead of letting the question disappear. `navigator.onLine` is what it asks, and that answers in one direction only — it reports a network interface, not a reachable internet — so only a definite `false` counts as offline. A browser that cannot say is treated as online, because refusing to work on a guess is the worse of the two failures.

What survives from the offline story is the part that was about the download rather than the answers: the app shell and the ONNX runtime stay precached, the weights stay in this browser's storage, and a second visit reaches the chat in about a second instead of four minutes.

To go the other way — answering from the model alone when there is no network — the guard is one condition in `send` and its mirror in `runTurn`.

## What a reply shows

Three of those streams reach the screen, and only one of them is the answer. The interface keeps them in that order of importance.

**The thinking is one line.** While the model works, a row says `Thinking… 4s` — a shimmer, a spinner and the seconds, so a wait that can run to half a minute on a modest GPU is legibly a wait rather than a hang. When the answer lands the row becomes `Thought for 3.2 s` with a chevron, and the trace behind it opens on click, one step per break the model wrote. It is never opened for the reader. A trace that expands itself buries the answer it was meant to explain, and by the third turn a transcript of visible monologue is unreadable — which is why every reasoning interface that survived contact with users ended up here.

The duration is measured, not estimated. With thinking enabled the chat template ends the prompt with an open `<think>`, so the block is already running before the first token arrives; `createThinkingClock` in `src/lib/reasoning.ts` times it off the `inThinkBlock` edge and sums the block each tool round opens. `stats.thinkTokens` cannot stand in for it — tokens are not seconds, and the ratio drifts as the GPU throttles.

Both forms of the label report that same measurement, which is the point: the number the reader watches climb is the number that ends up on the finished reply. Counting wall-clock time while streaming instead would let `Thinking… 12s` settle into `Thought for 3.2 s` and read as the interface correcting itself. The consequence is that the counter holds still while a tool runs — accurate, since no thinking is happening, and the tool row is doing the talking by then.

The trace is deliberately not rendered as rich text. Reasoning is not an answer, and a URL the model talked itself into is exactly the thing that should not become something to click.

**Tool calls are said in words.** `Searched the web`, `Read a page`, `Calculated` — with the function name kept inside the card, where a mis-routed turn actually gets diagnosed. A turn that used several tools collects them into one row that says what is running now, or afterwards what it all cost and how much of it failed. Unlike reasoning this is observed behaviour rather than generated text, so the row can say what happened without being opened.

**A follow-up can be typed into the wait.** A 0.8B model on a modest GPU takes long enough that the next question usually arrives before the last answer has, so `send` holds it rather than dropping it: queued messages sit above the composer, in order, each removable, and the next one goes as soon as the running turn finishes. Two rules make that safe. **Stop clears the queue** — interrupting is "not this, and not now", so sending the follow-up that was waiting behind a reply the user just cut off would be the opposite of what they asked. **A failed turn drains nothing**, because the next question would push the failure off the screen and be asked of the same broken worker; the queue survives, still on screen, and the rerun the failure offers picks it up once something has worked.

**Citations sit beside the answer.** Every [skill](#skills) exemplar ends its reply with a bare `Source: https://…`, and the [answer check](#checking-the-answer-before-it-is-shown) looks for one, so most replies that used the web carry a citation line. `splitSources` lifts that line out of the prose into pills naming the site; a URL written into the middle of a sentence stays where the model put it, and a line that only starts like a citation (`Source: my own recollection`) is prose and is left alone. Nothing is rewritten — `content` still holds the line, so copying, checking and the history sent back to the model all see it. There are no favicons, because every favicon service is a request to a third party carrying the domain the user is reading about.

## Installing the model

The model is **448 MB** and downloads once. Three things make it stick:

1. **Persistent storage.** Before downloading, the app calls `navigator.storage.persist()`. Without that grant the browser treats the weights as best-effort data and may evict them under storage pressure — turning a one-time download into a recurring one. Chrome grants persistence silently for installed PWAs and sufficiently engaged sites.
2. **OPFS instead of the Cache API.** Transformers.js caches downloads in the Cache API by default, but Chrome rejects the 448 MB weights file there with `Failed to execute 'put' on 'Cache': Unexpected internal error` — the download completed and then quietly vanished, so every visit re-fetched it. `src/llm/opfs-cache.ts` replaces that backend with the Origin Private File System, which is built for large binaries and streams them to disk. Downloads land under a `.part` name and are renamed only once complete, so an interrupted install can never be mistaken for a finished one.
3. **A dropped connection costs only what was left.** The `.part` file is kept, and the next attempt continues from it with `Range: bytes=<offset>-` instead of starting the 448 MB again — see [resuming an interrupted download](#resuming-an-interrupted-download).

A second visit then reaches the chat in about a second instead of four minutes.

### When there is no private file system

OPFS is the right home for this file and stays the default. A browser can still refuse it — Safari disables OPFS outright in private browsing, and an engine can expose `navigator.storage.getDirectory` without the synchronous access handle a resumable write needs. Until recently those cases fell back to the Cache API, which is the one place a 448 MB file is known to fail, so the model was downloaded again on every visit.

`src/llm/idb-cache.ts` is the fallback, and `src/llm/model-cache.ts` chooses between the two. IndexedDB is slower for this — writes go through the structured clone algorithm and cannot address an offset, which across published benchmarks costs roughly an order of magnitude on large sequential writes — so it is a fallback and not a default. Three things follow from storing a file that size in a key-value store:

- **The file is records, not a value.** A single 448 MB entry would have to be assembled in memory to write and again to read, and an interruption at 400 MB would leave nothing. Chunks of 4 MB are appended one at a time, each committed with the running byte count in the same transaction, so the two cannot disagree.
- **The same resume protocol applies.** `planWrite` in `src/llm/resume.ts` is shared with the OPFS backend: one copy of the `ETag`, range and total-size checks that stop two different files being spliced together, tested once.
- **Reading is a stream, not a blob.** Concatenating a hundred-odd records into one value before answering would put the whole file in the worker's heap. Each pull reads the next record instead.

The install panel reports what the active backend holds, so a browser that gains OPFS is told it is downloading again rather than shown a 448 MB it cannot reach. **Remove model** clears both stores, because a copy in the one this browser stopped using is still occupying the disk.

The install panel on the [first screen](#the-first-screen) shows whether the model is installed, how much space it occupies, whether storage is persistent, and offers a **Remove model** button to reclaim the space. A half-finished download is reported as such — `312 MB of 467 MB saved` — with a **Resume install** button, rather than counted as installed because a few of the seven files arrived.

### Resuming an interrupted download

Transformers.js reads a whole response into memory before handing it to a cache, so a `put`-side cache never sees a failure: at 400 MB of 448 MB there is nothing to hand over and nothing on disk. Resuming therefore has to own the fetch, and `opfsCache.match` does — it downloads the file into `.part`, retries the transfer up to three times from wherever it stopped, publishes it under the real name, and only then answers with the file. Upstream shipped the same idea for Node's filesystem cache in [transformers.js#1715](https://github.com/huggingface/transformers.js/pull/1715); the browser half is [still open](https://github.com/huggingface/transformers.js/issues/1220).

Four details are what make it work rather than merely sound good:

- **A partial is written through a sync access handle.** A `FileSystemWritableFileStream` buffers into a swap file that is discarded unless it is closed cleanly, so the old code's `.part` file was always empty after a failure. `createSyncAccessHandle()` writes straight to the file, and is available because the download runs in a Web Worker.
- **The entity tag is checked here, not by the server.** The natural mechanism is `If-Range`, and the Hub's CDN ignores it: a stale validator still comes back `206` with the old byte range, which would splice two different files together. So the `ETag` and total size are recorded next to the partial and compared on the next attempt; anything that does not match starts the file again.
- **A body that stops short is an unfinished download, not a shorter file.** Transformers.js sizes its buffer from `Content-Length` and zero-pads whatever never arrived, which would publish silently corrupt weights. A transfer that ends before the declared total is retried instead.
- **The download finishes before the response is returned.** Handing back a streaming body looked neater and was wrong: Transformers.js also calls `match` to ask whether a file exists and how big it is, and drops the body when it does — which left the OPFS write lock held by a reader that was never going to read. Progress therefore comes from the cache itself, reported per megabyte and translated into file names by the worker.

`node tools/verify-model.mjs` checks the three things this needs from the host: byte ranges, a `206` that states the file's total size, and an `ETag` that CORS actually lets a script read.

Installing Jarvis as a PWA (the install icon in Chrome's address bar) is what makes the download stick, because installed apps get persistent storage automatically.

The service worker precaches only the app shell — roughly 1 MB. The ONNX runtime is fetched from the Transformers.js CDN on first load and stored in OPFS next to the weights, so neither is fetched again. That is what a one-second second visit is made of; answering still [needs the network](#why-it-waits-for-a-connection). A new version of the app takes over once every tab has been closed, rather than reloading the page and discarding an open conversation.

## Where the model comes from

By default the weights are fetched from the Hugging Face Hub. It works well as a public source, and this was verified rather than assumed:

- **No account, no token.** The repository is public and ungated.
- **Any origin may fetch it.** The Hub reflects the requesting `Origin` back in `Access-Control-Allow-Origin`, so a browser on any domain can download directly.
- **Byte ranges are supported** (`Accept-Ranges: bytes`) and the `ETag` is exposed to scripts, which is what an interrupted download needs to continue.
- **Rate limits are not a concern here.** Anonymous clients get 3,000 file requests per five minutes per IP address; one installation needs seven.
- **Licensing permits redistribution.** The base model `Qwen/Qwen3.5-0.8B` is Apache-2.0, so you may mirror the weights as long as you keep the licence and attribution.

The one real risk is that the specific conversion we depend on, `onnx-community/Qwen3.5-0.8B-Text-ONNX`, is a third-party repository that could be renamed or removed. If that matters to you, mirror it. `node tools/verify-model.mjs` re-checks the first three points above in about a second, so a rename or a change of CORS policy shows up as a failed check rather than as a broken install.

### Hosting the model yourself

Point the app at any HTTPS host:

```bash
VITE_MODEL_HOST=https://models.example.com/
VITE_MODEL_PATH_TEMPLATE={model}/
```

Copy these seven files, keeping the `onnx/` subdirectory:

| File                         |       Size |
| ---------------------------- | ---------: |
| `onnx/model_q4f16.onnx_data` |     448 MB |
| `tokenizer.json`             |    18.3 MB |
| `onnx/model_q4f16.onnx`      |     0.6 MB |
| `config.json`                |     < 1 MB |
| `generation_config.json`     |     < 1 MB |
| `tokenizer_config.json`      |     < 1 MB |
| `chat_template.jinja`        |     < 1 MB |
| **Total**                    | **467 MB** |

The host must send `Access-Control-Allow-Origin` for your domain, and should serve byte ranges with a script-readable `ETag` so an interrupted install can resume. Those are the things `node tools/verify-model.mjs` checks, and it reads the same two variables, so point them at your mirror and run it before deploying. **Cloudflare R2 fits well**: 467 MB sits inside the 10 GB free tier, egress is free at any volume, and a public bucket on a custom domain gives you a CDN with configurable CORS. Uploading to your own Hugging Face repository works too and takes minutes.

GitHub Releases will not work. Release assets are served with `Access-Control-Allow-Origin: https://render.githubusercontent.com`, so a browser cannot read them.

## Requirements

- **Chrome or Edge 113+.** WebGPU is required, and there is no CPU fallback — see the note on `CausalConvWithState` below. Safari and Firefox still ship WebGPU behind a flag.
- **About 4 GB of GPU memory.**
- **Node 20+** and pnpm for development.

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173 and press **Install model**.

The service worker is disabled in development. To exercise the real PWA and its precaching, use `pnpm build && pnpm preview`.

## Deploying

`pnpm build` writes `dist/`. Upload it anywhere that serves static files — GitHub Pages, Cloudflare Pages, Netlify, S3, nginx. The hosted site needs no functions, no environment variables, and no runtime configuration: what the tools need is either keyless, entered by the user in the app, or an optional [tool proxy](#optional-tool-proxy) they run themselves.

## Scripts

| Command          | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `pnpm dev`       | Dev server, with the tool proxy at `/api`                 |
| `pnpm proxy`     | Standalone tool proxy on http://localhost:8787            |
| `pnpm start`     | Same process as `pnpm proxy` (for hosts that run `start`) |
| `pnpm build`     | Typecheck and produce a production bundle                 |
| `pnpm preview`   | Serve the production build, service worker active         |
| `pnpm test`      | Unit and component tests (Vitest)                         |
| `pnpm typecheck` | TypeScript, no emit                                       |
| `pnpm lint`      | oxlint                                                    |
| `pnpm format`    | Prettier                                                  |
| `pnpm check`     | Everything CI runs                                        |

Two helper scripts live in `tools/`, plus the optional tool proxy:

- `node tools/verify-model.mjs` checks that all seven weight files are still where the app looks for them and that the host will let a browser read them, that the chat template renders tool definitions the way the agent loop expects, and that the preconditions the reasoning budget relies on hold. It takes about a second. It stops short of generating, because it cannot — see `CausalConvWithState` below.
- `./tools/generate-icons.sh` regenerates the PWA raster icons from the committed SVG sources.
- `pnpm proxy` runs `tools/agent-api-listen.ts`, the standalone `/api/search` and `/api/fetch` process. The same handlers are what `pnpm dev` mounts through `tools/vite-plugin-agent-api.ts`.

## Deployment and releases

Every push to `main` publishes https://devbadya.github.io/Jarvis/. `.github/workflows/deploy.yml` reuses the CI workflow as a gate, builds, deploys to Pages, and then cuts a release. Nothing is published unless lint, formatting, types, tests, and the build all pass.

A fork needs one manual step: **Settings → Pages → Source: GitHub Actions**. The workflow could enable Pages itself, but only with a token holding repository administration rights, which is not worth handing to CI.

Three details make the app work from a repository sub-path rather than a domain root:

- **`base` is set at build time** from the path Pages reports, and the PWA manifest's `start_url` and `scope` follow it. Without this every asset URL would point one directory too high.
- **`404.html` is a copy of the app shell**, so a deep link opens the app instead of GitHub's error page on the first visit, before the service worker is installed.
- **Every tool ships**, including `web_search` and `read_page`. They used to be switched off here because Pages cannot host a proxy; they no longer need one.

**Releasing is a version bump.** The workflow tags and publishes `v<version>` from `package.json` once that tag does not yet exist, with notes generated from the commits since the last release. Ordinary commits deploy without leaving empty releases behind.

## Tools

| Tool           | What it does                                                        |
| -------------- | ------------------------------------------------------------------- |
| `web_search`   | Full web search with no key; Wikipedia, LangSearch or Jina instead. |
| `read_page`    | Fetches a URL and returns its readable text.                        |
| `research`     | Search, read three independent sites, return quoted passages.       |
| `calculator`   | Exact arithmetic via a hand-written parser.                         |
| `current_time` | Live date and time here, or in a named city, country or timezone.   |
| `weather`      | Current conditions and a three-day outlook, from several forecasts. |
| `memory`       | Saves, lists, corrects and deletes what it remembers about you.     |

### How the network tools work without a server

A browser may only read a response whose origin opts in with CORS headers, which is why apps like this normally ship a proxy. Both network tools instead use endpoints that do opt in, so the request goes straight from the page unless you [run the optional tool proxy](#optional-tool-proxy). `src/tools/web.ts` holds the browser path; `tools/agent-api.ts` holds the server path.

**`read_page`** goes through `r.jina.ai`, which reflects the requesting origin, needs no account, and returns extracted markdown rather than raw HTML. Anonymous use is capped at 20 requests per minute per IP; a Jina key raises that and is optional.

**`web_search`** has a provider choice under **Tools → Web access**:

| Provider   | Key   | Covers                                                                  |
| ---------- | ----- | ----------------------------------------------------------------------- |
| DuckDuckGo | none  | The live web, current events included. **Default.**                     |
| Wikipedia  | none  | Encyclopedic facts, in the language of the question. Nothing about now. |
| LangSearch | yours | The live web from a search API, on a free key.                          |
| Jina       | yours | The live web from a search API, via `s.jina.ai`.                        |

The default takes no key and no signup: `r.jina.ai` is pointed at a DuckDuckGo results page, and the reader returns it as markdown that `parseDuckDuckGoResults` reads back into results. Scraping a layout is more fragile than parsing an API, which is the price of the keyless tier — so the parser is tested against captured pages, and a page it finds nothing in raises an error rather than reporting "no results", because a 0.8B model relays that as "this does not exist".

That fragility has already been paid once, and not in the way it looked. `lite.duckduckgo.com` was the only page asked, and one afternoon the reader could not load it: it waited on the page and returned a 422, so the default provider could not search at all. The html page answered the same query in the same second, and an hour later both were fine. So the fault was never that one page died — it is that one page is enough for the search to work and not enough for it to keep working. Both are asked now, `duckduckgo.com/html/` first because it is what answered during the outage. They write a hit differently, `1.[Title](link)` against `## [Title](link)`, and the parser reads both.

Search and `read_page` share the reader's budget of 20 requests a minute per IP, so one search plus one page read spends two — except when the page is Wikipedia. MediaWiki already sends CORS headers and a plaintext extract, so `read_page` of a `*.wikipedia.org` URL goes there directly and spends none of the 20. A Jina key raises the ceiling for the reader-backed calls and is what the Jina provider needs outright.

**The search itself now carries the facts a 0.8B model would otherwise spend a round guessing at.** Every `web_search` result is stamped with today's local date, so "current" and "today's news" have a date without calling `current_time`. A German question searches German Wikipedia and, on DuckDuckGo, prefers German results (`kl=de-de`); English _who was Ada Lovelace_ is not mistaken for German because bare `was` is also English. German Wikipedia is smaller, so an empty result there falls through to English rather than telling the model the subject does not exist.

The `research-question` skill does not offer `web_search`. It offers `research`, which searches, picks three **different sites** (`investor.nvidia.com` and `nvidianews.nvidia.com` count as one), reads them in parallel, and returns the passages that bear on the question. Wikipedia pages go through MediaWiki, so a typical call spends one reader request on the search and two on the other sites rather than six. A page that will not open becomes its search snippet; if nothing readable comes back the tool throws rather than telling the model the subject does not exist. `lookup-term` still searches and optionally reads one page — a name does not need three sources.

**LangSearch is the way off that shared budget without paying for one.** `api.langsearch.com` is a search API rather than a results page, its free tier allows 1,000 searches a day and one a second, and a key needs no card — so a search stops competing with `read_page` for the same 20 requests a minute. Two things about it are worth knowing before choosing it. Its snippets are index text rather than prose, lower-cased and with spaces around the punctuation, which a 0.8B model reads less confidently than a sentence. And it answers in an envelope: a refusal it decides to report with a 200 arrives as a `msg` and no result set, so `searchLangSearch` raises that rather than passing an empty list to a model that would relay it as "this does not exist". Long summaries are available per result and are switched off — each is the whole page behind the result, which would leave a 0.8B context with no room for the answer.

The tool description changes with the provider, so the model is told whether it is searching an encyclopedia or the web — without that it cheerfully asks Wikipedia for this morning's news. Wikipedia is worth keeping selected for definitions and biography: its extracts are full paragraphs where a results page gives a line.

Keys are entered at runtime and kept in `localStorage`. None of this reads a build-time environment variable, deliberately: a key compiled into the bundle is a key published to every visitor.

**`weather`** needs no key and no provider choice. It resolves the place with Open-Meteo's geocoder and then asks two unrelated services about that one point: Open-Meteo for DWD's ICON, NOAA's GFS and ECMWF's IFS, and wttr.in for an independent reading of the conditions right now. All three endpoints send `Access-Control-Allow-Origin: *` on the real request from the deployed origin.

The geocoder matches names, and what a 0.8B model passes is often the whole question — `Wetter in Berlin`, `Hamburg heute`. Both found nothing, and the tool failed outright rather than approximately. So `placeCandidates` narrows the argument: the phrase as written first, then what follows a preposition, then the same with the subject and the time words removed. Whole-first is the safeguard, since In Salah is a town in Algeria and narrowing it would answer about somewhere else.

The reconciling happens in `src/tools/weather.ts`, not in the conversation. The three models disagree by two or three degrees on an ordinary day, so the outlook is their median rather than whichever model answered first, and the reading ends with a sentence saying how far the two current readings are apart — 3.4 °C for Berlin on the afternoon this was written, 0.1 °C for Lisbon — so an answer hedges exactly when hedging is warranted. Asking the model to weigh that up itself would mean several page reads for one question, which is the shape that makes tool accuracy collapse. What arrives instead is under 400 characters:

```text
Berlin, Germany — 15:45 local (Europe/Berlin)
Now (measured 7 min ago): 19.6 °C, feels 19.5 °C, partly cloudy, wind 4 km/h from NW, humidity 59%
Today Mon 24 Aug: 11.4 to 20.2 °C, overcast, 3% chance of rain
Tue 25 Aug: 13.4 to 23.6 °C, overcast, 0% chance of rain
Sources: Open-Meteo (ICON, GFS, ECMWF) and wttr.in, 3.4 °C apart on the temperature now, so it is approximate.
```

**Two sources that observe at different rates do not disagree — they are different ages, and that reads as disagreement.** Open-Meteo returns `current` on a quarter-hourly grid, which it says outright as `interval: 900`; wttr.in refreshes every half hour or so and serves it with `Cache-Control: max-age=600`, which the browser will honour on top. Measured together they were routinely 30 to 40 minutes apart in age, and Hamburg came back _2.4 °C apart, so it is approximate_ from two sources that did not contradict each other about any single moment. The clock beside the place name made it worse rather than better: it is the observation's clock, so on a quarter-hourly grid it always trails the question by a few minutes and the whole reading looked stale.

Three things follow, and all three are in `weather.ts`:

- **Both requests are made with `cache: 'no-store'`.** The one question this tool answers is what the weather is doing now, so a reply out of the HTTP cache is the one reply it must not give.
- **Each reading carries the instant it was observed**, parsed from what the source actually publishes: Open-Meteo's `current.time` is a local wall clock and only becomes an instant alongside `utc_offset_seconds` from the same response, and wttr.in stamps its observation in UTC as a bare `08:22 PM` with no date on it, which can only be behind our own clock — so a time that lands ahead belongs to yesterday.
- **A reading older than 45 minutes is left out of the current conditions rather than averaged into them**, and named in the sources line with the age that disqualified it. Ordering by observation also means the quoted temperature is the newest measurement available rather than whichever service this module happens to ask first. If every reading is stale it is still the only answer there is, so it is used and the `Now` line says how old it is.

The outlook is deliberately unaffected: a day's maximum does not go off in half an hour, and only Open-Meteo has three models behind it.

**Choosing a provider is mostly a CORS question, and a stricter one than it looks.** Tavily and Exa were both offered here and both had to be removed. Tavily answers the preflight with the origin reflected and then omits `Access-Control-Allow-Origin` from the actual POST; Exa sends it for `http://localhost` only. Each worked perfectly against the dev server and failed on the deployed site. Before adding a provider, check the header on the real request from the real origin, not on the preflight and not from localhost.

That header is also why the keyless tier goes through the reader rather than to a search engine. Measured with the real request from `https://devbadya.github.io`: Marginalia serves keyless JSON results and sends no `Access-Control-Allow-Origin` at all, public SearXNG instances answer `format=json` with bot checks or 403s, Brave, SerpApi, Kagi and You.com send no header on a keyed request either, Mojeek's JSON API answers 200 with no header, and DuckDuckGo's own Instant Answer API does send one but returns an empty payload for anything longer than a bare entity name. Of the keyed APIs that do send it, LangSearch is the one offered here. Firecrawl's `/v2/search` sends it too. Serper sends it on `/search` but not on its own health route, so the header is configured per route there rather than globally and a working search cannot be inferred from a failing one. Google Programmable Search sends it and is nonetheless the wrong thing to add now: it has been closed to new customers, and existing keys stop working on 1 January 2027.

There is a browser check for this that a shell cannot do, and it is worth running on any provider added later. With `pnpm dev` running, in the DevTools console:

```js
const web = await import('/src/tools/web.ts')
await web.searchWeb('webgpu', 3, { provider: 'langsearch', langsearchApiKey: 'sk-wrong' })
```

A rejection reading `LangSearch rejected the API key (401)` is the result to want: the response reached JavaScript, so the headers are there and only the key was wrong. A CORS failure looks nothing like it — the console logs the blocked request and the caller gets an opaque `TypeError: Failed to fetch`, with no status to report.

The browser-direct path removed a liability the old always-on proxy had. A server-side fetch proxy is a confused deputy — it can be aimed at loopback, link-local, or RFC1918 addresses and made to read internal services. The reader service runs on the public internet and cannot see your network, so that class of attack has no target until you opt into the proxy. `read_page` still refuses private and non-HTTP URLs in the tab, now only to fail clearly on a target that could never work. The optional proxy repeats the check with a DNS lookup, and follows redirects by hand so a public URL cannot bounce onto a private one.

It also removed a deployment compromise. The Pages build used to unset `VITE_AGENT_API_BASE`, which dropped `web_search` and `read_page` from the tool list because a static host cannot run the proxy. Both tools now ship everywhere, and the proxy is a path they can take rather than a requirement they cannot.

The calculator deliberately avoids `eval`. Expressions come from model output, which is attacker-influenceable as soon as the model has read an untrusted page.

**`current_time`** without a place is this browser's clock and does not leave the tab. With a place it uses the same Open-Meteo geocoder, then formats `new Date()` in that IANA zone, so a second question a minute later is a new reading rather than a conversion of the last one. English ranking for _Deutschland_ and _Tokio_ is the wrong town, so the lookup asks in English and German and prefers countries and capitals.

The line it returns puts the **local wall clock first** — `Germany — 22:40 CEST (UTC+2, Europe/Berlin), Thu 27 Aug 2026` — and does not include a UTC instant. A 0.8B model copies the first HH:MM it sees; when that used to be `2026-08-27T20:40:19.483Z` it answered 20:40 for Germany, minutes right and the hour UTC. The hour is taken from UTC plus the zone offset, not from whatever `hourCycle` Intl emitted.

The tool card keeps that zone **live**. The line the model read is a snapshot; the card ticks from `new Date()` in the same IANA zone, so the minute rolls over without another tool call. A second `current_time` in the same turn is also run again — unlike search, the clock is a different reading a minute later, and handing back the first one is how the minutes froze.

### Optional tool proxy

GitHub Pages cannot host a process, so the published site stays browser-direct. The same handlers run in two places when you want the other path:

- **`pnpm dev`** — the Vite plugin serves `POST /api/search` and `POST /api/fetch` on the dev server. `.env.development` sets `VITE_AGENT_API_BASE=same-origin`, so DuckDuckGo search and non-Wikipedia page reads go there automatically.
- **`pnpm proxy`** — the same handlers on http://localhost:8787, for a static build or the hosted site. Paste that origin into **Tools → Tool proxy URL**, or build with `VITE_AGENT_API_BASE=http://localhost:8787`.
- **Railway (or any host)** — the `Dockerfile` in the repo root runs only this process. Create a project, connect `devbadya/Jarvis`, set `PROXY_ORIGINS` to `https://devbadya.github.io`, wait until the deploy is live, then **Settings → Networking → Generate domain**. That `https://….up.railway.app` origin is the URL: paste it into **Tools → Tool proxy URL** on the hosted site. There is no URL until a domain exists; the Hobby plan alone does not create one.

The proxy scrapes DuckDuckGo HTML itself and fetches pages itself. It does not spend the Jina reader budget, and it is not limited to CORS-friendly endpoints. Wikipedia, LangSearch and Jina still leave the tab directly — they already send the headers, and their keys must not travel through this process.

A fetch-on-behalf proxy is still a confused deputy. Every target is resolved and refused if it lands on loopback, link-local or RFC1918, and redirects are re-checked. Do not bind `pnpm proxy` to the public internet without setting `PROXY_ORIGINS` to the pages that may call it (for example `https://devbadya.github.io`). Inference never goes through it.

### What leaves the browser

Inference does not: prompts, reasoning, and replies never leave the GPU, and neither do [memories](#memory), which are written to IndexedDB in this browser and read back into a prompt that goes no further than the GPU either. Tools are the exception, and always were. A `web_search` call sends the query to the chosen provider, a `read_page` call sends the URL to the reader, a `weather` call sends the place name to Open-Meteo's geocoder and its coordinates to the two forecast services, and a `current_time` call with a place sends the name to the same geocoder.

On the hosted site those go direct, with no server of ours in the path to log them. With the optional proxy, DuckDuckGo search and non-Wikipedia page reads go to that process first — one more party than a search API, and the one you run.

Worth being precise about on the default provider without a proxy: a search sends the query to `r.jina.ai`, which then sends it to DuckDuckGo. That is one more party than a search API like LangSearch or Jina involves.

### MCP servers

Open **Tools** in the header to connect a Model Context Protocol server over Streamable HTTP. Its tools are merged into the model's tool list, namespaced as `<server-id>__<tool-name>`. Configuration is stored in `localStorage`.

The server must send permissive CORS headers, because requests originate from the page with no proxy in between. A server that fails to connect is skipped rather than blocking startup, and the error is shown next to its entry.

Tool results are truncated at 8,000 characters before they reach the model. Long results are not a neutral cost: across several models, function-calling accuracy drops by between 7% and 91% as tool responses grow ([arXiv:2505.10570](https://arxiv.org/html/2505.10570)), and an unbounded web page would be by far the largest thing in this model's context.

## Memory

Jarvis remembers things you tell it to remember, and nothing else. Open **Memory** in the header to read every entry, correct one, delete one, or switch the whole thing off.

Memories live in **IndexedDB**, in your browser, next to the model weights. Nothing is uploaded, because there is nowhere to upload it to. The rest of this app's settings sit in `localStorage`, which is the wrong home for these: it is synchronous, so every write would block the main thread in the middle of streaming a reply; it stores strings, so one edit means re-serialising the whole set; and it cannot be reached from a worker.

### What gets remembered

The [CoALA taxonomy](https://arxiv.org/abs/2309.02427) splits an agent's memory four ways: working memory is the live context window, and the three durable kinds are semantic, episodic and procedural. Only the durable three are stored — working memory is the transcript, which the tab already holds — and they are named in words the model can actually pick between.

The transcript is not enough on its own. A 0.8B model will answer tomorrow's weather without the city the last turn just resolved, so the last established place is pinned into the system prompt as one short line — _This conversation is about Frankfurt._ — the same way recall is. It is derived from the chat, never written to IndexedDB, and it stays off a fresh question that names its own subject. Switching memory off does not drop it: that toggle is for stored facts, not for this conversation.

| Kind         | Is                                 | Recalled                      |
| ------------ | ---------------------------------- | ----------------------------- |
| `fact`       | Something true about you           | When the question is about it |
| `preference` | How you want Jarvis to behave      | On every turn                 |
| `event`      | Something that happened, at a time | When the question is about it |

Preferences are carried unconditionally because "keep answers short" is relevant to a message that never mentions answers or length. Facts and events have to be asked about, or every prompt would carry your whole profile.

An event is recalled with the date it was noted, which the other two are not. Nothing here can rewrite a memory that has gone stale — that needs the background model call this deliberately does not make — but _flying to Lisbon in July (noted 2026-03-02)_ at least gives the model what it needs to tell an old plan from a new one. Reading that as still upcoming in September is the exact failure OpenAI rebuilt ChatGPT's memory to fix.

### Recall happens before the model sees the question

Whatever is relevant is added to the system prompt for that turn. The model is not asked to look anything up, and this is the part most worth defending: a 0.8B model asked _what do you know about me_ will answer rather than reach for a tool, and when it does reach it spends one of only four tool rounds to learn something that could have been free. Every assistant that ships memory injects it for the same reason.

Selection is lexical — word overlap, newest first — not semantic. An embedding model would be another download and another forward pass per turn, and over a couple of hundred short sentences the difference is small. Where it is wrong, it is wrong in a way you can see and fix, since the panel shows exactly what is stored.

The injected block is capped at roughly a hundred tokens and is **empty when nothing matches**, so a prompt is never lengthened to announce that nothing is known. That cap is not decoration: this app has already measured a longer system prompt dropping tool use to 1 in 6.

### Writing is explicit

Say _remember that…_ and the model calls `memory`. Type it into the panel and it is stored the same way, through the same rules.

There is deliberately no background pass that reads your conversations and writes notes about them. ChatGPT's does this, and so does [mem0](https://docs.mem0.ai/migration/oss-v2-to-v3)'s extractor, and both spend an extra model call on every conversation to do it. Here that call would run on your own GPU and double the cost of a turn, to produce notes from a 0.8B model that you then have to live with in every later prompt.

One tool covers the lot, with a command argument, rather than four separate tools — tool-calling accuracy falls as the visible list grows:

| Command  | Does                                                     |
| -------- | -------------------------------------------------------- |
| `save`   | Stores one short sentence about you                      |
| `list`   | Reads them back with ids, optionally filtered by a query |
| `update` | Corrects one, by id or by a query naming it              |
| `delete` | Removes one, by id or by a query naming it               |
| `clear`  | Removes all of them, and only with `confirm=yes`         |

The verbs you would actually use — `remember`, `forget`, `recall` — are accepted as aliases for the command names, because the model reaches for those first and a rejected call costs a whole tool round.

### Getting it wrong is recoverable

The model writing your memories is a 0.8B model, so it will sometimes record the wrong thing, and it can reach `delete` and `clear` on its own. Three things follow from that:

- **Deleting is undoable for a week.** Nothing is erased on request, by you or by the model; it moves to a bin in the panel with Restore beside it, and is purged a week later.
- **An ambiguous delete is refused.** _Forget about Lisbon_ against two memories mentioning Lisbon comes back with both and their ids, rather than a guess at which one to destroy.
- **`clear` needs asking twice.** The first call is refused with an explanation, and only `confirm=yes` goes through.

Contradictions are kept rather than resolved. Tell it you have moved and both _lives in Berlin_ and _lives in Lisbon_ are stored; recall prefers the newer and the panel shows you both. mem0 shipped the version that overwrites, found that deciding two sentences describe the same thing needs a model, and moved back to appending.

The store is capped at 200 entries and each is capped at 200 characters. Past that the oldest goes to the bin: recall only ever injects a handful, so a larger store would not make answers better. The bin has a ceiling of its own, at 100, because saving and deleting can be repeated for ever without the live count ever moving.

Switching memory off hides the tool from the model and stops recall, and keeps what is stored — it means _stop using this_, not _delete it_. The panel's own button is how memories go. The `memory` skill goes quiet at the same moment: a skill teaches by worked tool calls, and one whose tool is no longer there would only teach the model to ask for something it cannot have.

## Skills

These are the skills the model uses at runtime, and are a separate thing from the [agent skills](#agent-skills) further down, which are for coding agents working on this repository.

A skill is a folder under `src/skills/` containing a `SKILL.md`. The frontmatter follows the [Agent Skills](https://agentskills.io) standard — `name` and a `description` saying what the skill does and when to use it — so a skill written here can be published to the wider ecosystem unchanged. What it carries is different, though, and deliberately so.

The standard's middle stage loads a skill body of up to ~500 lines into context on trigger. That budget assumes a frontier model. Here it would be actively harmful, and this app already has the evidence: adding firmer instructions about tool use to the system prompt dropped tool use to 1 in 6. The research agrees about where the leverage actually is — for small models, few-shot exemplars are worth about +21.5 points on tool use while prose documentation is worth about +5 ([arXiv:2604.20148](https://arxiv.org/html/2604.20148v1)). So the payload is inverted: the body is capped at 600 characters and the work is done by worked examples.

```yaml
---
name: arithmetic
description: Computes an exact answer with the calculator whenever …
jarvis:
  priority: 30
  tools: [calculator]
  triggers: ['\d\s*[+*/^%-]\s*\d']
  exemplars:
    - user: What is 6748 * 9?
      steps:
        - tool: calculator
          arguments: { expression: 6748 * 9 }
          result: 6748 * 9 = 60732
      answer: 6748 × 9 = 60,732.
---
Call `calculator` for the arithmetic. Do not work it out yourself.
```

Each exemplar becomes real conversation turns ahead of the user's history, and the assistant turn carries the literal `<tool_call>` markup rather than a description of it — an example is only worth something if it is byte-for-byte the shape the model must produce. A test asserts every shipped exemplar round-trips back through the parser, so a skill cannot teach a format the agent loop would then fail to read.

An exemplar can hold several steps, which is how a workflow gets taught. Split across two single-step exemplars, "search" and "then open the best result" are two unrelated behaviours the model has no reason to connect.

Two further things a skill does. It **narrows the tool list** to what it declares, because tool-calling accuracy falls as the number of visible tools grows. And it can **override the reasoning budget** per skill.

Eight ship: `arithmetic`, `current-date`, `world-clock`, `summarize-url`, `lookup-term`, `research-question`, `weather` and `memory`.

### Which skill, and when

Skills are not all loaded. [How they are found](#finding-the-right-skill) is its own piece of machinery, and the short version is that the catalogue never enters the prompt at all: routing happens in code, and only the one skill that won is read.

### Why `weather` exists

The weather is the clearest case of something the model cannot possibly know, and the one it is most willing to make up: a plausible temperature is easy to write and impossible to tell from a real one. So `weather` fires on the shape of the question — anything naming the weather or a forecast, `how hot is it`, `is it raining`, `will it rain` — and hands the turn to the [`weather` tool](#tools), which is the only tool it offers. One tool and no choice about it is the easiest routing decision this model ever gets.

It was the first skill with triggers in a second language. The app answers in the language it is asked in, and German asks in compounds — _Wettervorhersage_, _Unwetter_ — which a word boundary would miss, so the German patterns match a prefix instead. Four more skills have since been given German shapes of their own, for the reason set out under [narrowing what a skill claims](#narrowing-what-a-skill-claims).

Two collisions are pinned by tests. Its priority sits above `current-date`, so _what's the weather in Tokyo today_ is answered with a forecast rather than a date; that used to be a genuine contest, since `current-date` claimed the bare word _today_, and the tests now hold the stronger line that those questions reach the clock not at all. And its triggers do not match `weather` or `forecast` inside a URL, so a linked forecast stays with `summarize-url` and gets read rather than looked up somewhere else.

The exemplars carry the part prose cannot. One quotes a reading whose sources are 3.4 °C apart and calls the temperature approximate; the other answers _will it rain tomorrow_ off the dated line rather than the `Now` line. Both are behaviours a 0.8B model gets wrong from a description and right from an example. Both also carry the `Now (measured … ago)` line, because an exemplar that showed a format the tool no longer returns would teach the model to read a reading that never arrives.

### Why `world-clock` exists

Asked the time in Germany as a follow-up, the model invented a date a day in the future and a timezone Germany does not use. `current_time` used to read only the user's own clock, and the `current-date` skill deliberately left _what time is it in Tokyo_ unrouted so it would not answer with the wrong hour. Unrouted, the 0.8B model just made one up.

So `world-clock` fires on the shape that names another clock — _what time is it in …_, _wie spät ist es in …_, _wie viel Uhr … in …_, _uhrzeit in …_ — and hands the turn to `current_time` with the place as written. The tool geocodes that name (the same Open-Meteo lookup the weather already uses) and formats `new Date()` in that IANA zone, daylight saving included. A second question a minute later is a new call, not a conversion of the last reading. The German trigger does not require `ist` between _Uhr_ and _in_, because _wie viel Uhr es in Deutschland ist_ puts the verb at the end.

Its priority sits above `current-date` and below `weather`, so _what's the weather in Tokyo today_ stays a forecast and _what time is it_ without a place stays the user's own clock. A follow-up like _and in Germany?_ still matches nothing by itself; carry-over keeps whichever clock skill is resident, and `current-date` now has an exemplar that passes `place` rather than converting the previous hour.

### Why `lookup-term` exists

Asked _what is 1inch_, the model searched for **`1 inch to measurement in centimeters`**. It split the token, decided on its own that the question was about unit conversion, and searched for that instead — so the results never got the chance to mention that 1inch is a DEX aggregator.

Nothing in the prompt caused this and no skill was firing; the model simply preferred a reading it had seen more often in training. It is a good illustration of why the tool name is not enough to judge a turn by: `web_search` was the right tool, called at the right moment, with arguments that made the answer impossible.

So `lookup-term` triggers on the shape of the question — `what is <single token>`, `was ist <single token>`, or a subject whose token mixes letters with digits — and teaches by example that the query is the user's word, unaltered, and that what the term _means_ is something the results decide rather than the model. Its second exemplar runs search then `read_page`, which is the "check what actually came back" half of the same lesson.

Two shapes are excluded by hand, because both look exactly like a name to a pattern that counts tokens. A token of bare digits is a measurement rather than a project, so _what is 32 fahrenheit in celsius_ is left alone: searching for it verbatim answers nothing, and it was the one prompt this skill reliably stole. And _what is that?_ is a pronoun, not a product.

The eval scores this directly: scenarios may assert on the arguments a tool was called with, not just its name, and the harness reports that as a separate **Right args** column.

Skills are bundled at build time rather than fetched, so no part of routing depends on a request that could fail.

### Narrowing what a skill claims

A skill's triggers are a claim on a class of request, and the way that claim goes wrong is not usually a missed question — it is a stolen one. These were found by routing ordinary phrasings through `route` and reading which skill answered:

| Asked                              | Went to        | Because                                                         |
| ---------------------------------- | -------------- | --------------------------------------------------------------- |
| _What's today's news?_             | `current-date` | `today` was a trigger, so the news was answered with a date     |
| _How much is a Big Mac in Japan?_  | `arithmetic`   | `how much is` was a keyword, and a price is not a sum           |
| _I was born in 2024_               | `research`     | A bare year was a trigger, however it was used                  |
| _What is 32 fahrenheit in celsius_ | `lookup-term`  | `32` is a digit-bearing token, and so is `1inch`                |
| _Was ist Stripe?_                  | nothing        | Every shape it matched was written in English                   |
| _Wie spät ist es?_                 | nothing        | The clock had no German shape at all                            |
| _Who is that?_ / _Wer ist das?_    | `research`     | `who is` / `wer ist` treated a pronoun as a person to look up   |
| _Was ist los?_                     | `research`     | `los` was grouped with _gerade_ / _heute_, and it is a greeting |

The first four, and the two pronoun cases at the bottom, are the same mistake: a word that _appears in_ a kind of request was mistaken for the request itself. The fix is to match the shape instead — `what('s| is) the (date|time)` anchored at the end of the message rather than the word `today`, `how much is a` rather than `how much is`, an interrogative alongside the year rather than the year alone, `who is` only when the next word is not a pronoun.

**Narrow enough to stop stealing is narrow enough to start missing, and that is the other half of the same table.** Routing 52 ordinary phrasings through `route` found 19 that reached no skill at all, and the pattern in them is that each was one inflection or one article away from a shape that already existed:

| Asked                              | Reached | Because                                                     |
| ---------------------------------- | ------- | ----------------------------------------------------------- |
| _Wird es morgen in Berlin regnen?_ | nothing | Only the third person `regnet` was a trigger                |
| _What's it like outside?_          | nothing | The commonest weather question names no weather             |
| _What is the iPhone?_              | nothing | The bare-name shape had no room for an article              |
| _Tell me about Notion_             | nothing | Every lookup shape was a question, not an instruction       |
| _Erkläre mir OpenAI_               | nothing | Same, in the language the app is mostly asked in            |
| _Who wrote Dune?_                  | nothing | `who is` and `who won` were shapes; authorship was not      |
| _What's the population of Tokyo?_  | nothing | A figure the model will otherwise invent to three digits    |
| _Aktueller Bundeskanzler_          | nothing | A whole question with no interrogative in it                |
| _Merke dir, dass ich vegan bin_    | nothing | The keyword was `merk dir`, and keywords match as written   |
| _Vergiss das bitte_                | nothing | The keywords were `vergiss was` and `vergiss dass`          |
| _Fasse das zusammen_               | nothing | The object is usually a pronoun, and `seite zusammen` isn't |
| _Welchen Wochentag haben wir?_     | nothing | `wochentag` was not among the clock's keywords              |

Widening a claim is where a skill starts stealing again, so each of these is anchored as tightly as the shape allows: `tell me about` and `erkläre mir` end at the name, so _tell me about the trip we planned_ is three tokens past matching; the optional article cannot widen the bare-name shape because the name is still the last token, which is what keeps _what is the capital of France?_ out; `add` needs both operands, so _add 3 more rows_ is not a sum; and the two-word `aktuelle …` fragment excludes the subjects the clock and the thermometer own, because answering _aktuelle Uhrzeit_ with a web search is worse than not routing it at all. `\b(regen)?schirm\b` does not fire on _Bildschirm_, since there is no word boundary inside a compound.

Two known misses are left deliberately. _GDP of Germany 2024_ needs a bare year to be a trigger, and that is exactly the rule that sent _I was born in 2024_ to a search engine. _What's 2 plus two?_ needs the spelled-out operand, which buys one phrasing and a new class of false positive.

Anchoring used to buy an honest refusal. `current_time` read the user's own clock and no other, so its triggers ended in `(?!\s+in\b)`: _what time is it_ routed, _what time is it in Tokyo_ deliberately routed nowhere. That refusal is now a different skill. `world-clock` takes the `in` shape and reads that city's clock; `current-date` still ends its triggers before `in`, so the two do not steal from each other. A keyword cannot express that split, which is why the German shapes stay triggers rather than index entries.

The last two are the cost of a keyword-only second language, and they were the commonest question there is. Where a German phrasing has a shape worth matching it is now written out; the index still catches the rest.

## Finding the right skill

The standard's answer is progressive disclosure in three levels: every skill's `name` and `description` sit in the system prompt permanently at roughly 100 tokens each, the body is read when the skill triggers, and bundled files are read only if the model asks for them. Claude's Tool Search and MCP's progressive discovery extend the same idea to tools — defer the definitions, give the model a search tool, load three to five results, and cut tool-definition tokens by about 85%.

**Both of those hand the searching to the model, and that is the part this app cannot copy.** A search round-trip here is a whole generation from a 0.8B model at around 18 tokens per second, spent before the real answer starts; routing through the model spends exactly the capacity a skill exists to conserve; and metadata-only routing is unreliable even for far larger models ([arXiv:2603.22455](https://arxiv.org/html/2603.22455v5)). So the search happens in code, and the catalogue never reaches the prompt — **zero tokens, rather than a hundred per installed skill.**

What is loaded, and when:

| Level                     | When                          | Cost to the model                            |
| ------------------------- | ----------------------------- | -------------------------------------------- |
| Name, keywords, triggers  | Always, in code               | Nothing — the router reads it, not the model |
| Guidance and exemplars    | For the one skill that routed | Up to `MAX_SKILL_CONTEXT_CHARS`              |
| Everything else installed | Never                         | Nothing                                      |

`loadCatalog` reads only the frontmatter, so a skill's exemplars are parsed the first time that skill wins a turn and never for a skill that does not. A test proves it: a catalogue entry whose exemplar cannot parse routes perfectly well, and only throws when something asks for its body.

Routing runs three stages, cheapest and most certain first:

1. **Triggers** — the author's regexes, matched against the shape of a request. Precise, free, unable to hallucinate.
2. **Search** — an inverted index over curated `keywords`, ranked by inverse document frequency. This is what catches phrasings no trigger anticipated, including the languages the triggers are not written in. The app answers in the language it is asked in, and a German shape is written out as a trigger only where it needs something a keyword cannot say — an exclusion, like _wie spät ist es_ having to stand down when a city follows. _Zusammenfassung bitte_ and _Quadratwurzel von 144_ reach their skill through the index instead, and used to reach none.
3. **Carry-over** — _and in Lisbon?_ matches nothing by itself, and the skill that answered the question it continues is exactly the one it needs.

Retrieval is lexical rather than semantic on purpose. RAG-MCP shows semantic retrieval of tool schemas beating a flat prompt three to one, 43.1% against 13.6% ([arXiv:2505.03275](https://arxiv.org/html/2505.03275v1)), and it is the right shape for hundreds of entries; for a handful of short ones, BM25-style scoring is where sparse retrieval is strongest, and a dense retriever would mean shipping a second model — 22 MB and up — into an app whose premise is one download and no server. The seam is in `retrieve.ts` if that changes: anything that can score an entry against a message can replace `search`.

**What is searched is curated, and that is not a detail.** Retrieving over the `description` is the obvious move and a trap: `temperature` appears in the weather description, so a bag-of-words match fires the weather skill on _what temperature does water boil at_. Keywords are written to be matched instead, as phrases, over the words as written — dropping stopwords first would quietly turn `how warm` into `warm` and fire the weather skill on a bowl of soup. A skill that declares no keywords falls back to its description and needs two terms to match, because prose nobody wrote for a router is weaker evidence.

### Removing what is not needed

A skill that keeps applying to turns it has nothing to do with is worse than no skill: it spends context and narrows the tool list on a request that needed neither. So carry-over is deliberately hard to enter and easy to leave.

- A continuation has to either **say so** (`and`, `und`, `what about`) or be **too short to be asking anything of its own**. Length alone is not enough, and this is where the mechanism would turn harmful: _what is the capital of France?_ is six words, and answering it with the weather skill's exemplars resident would send the model searching for a fact it already knows.
- It survives **two turns** on carry-over alone. Past that it has stopped being a continuation and become a default.
- It is dropped the moment another skill matches, the message asks something fresh, the turn closes the exchange (_thanks_), or a new chat starts.

The resident skill is read back off the transcript rather than kept in a counter of its own, so rerunning a reply rewinds it too — a counter held to one side would still be carrying the turn it just discarded.

Every reply says which skill answered it and how it was found: `weather skill · matched "wetter"`, or `· carried over`. A router nobody can see is a router nobody can correct.

## Checking the answer before it is shown

A skill fires on some requests. This runs on all of them.

Between the model settling on an answer and that answer reaching the screen, `src/agent/review.ts` reads it back against what the turn actually produced — the results the tools returned, and the URLs already in the conversation. Three things are checked:

| Check             | Fires when                                                            |
| ----------------- | --------------------------------------------------------------------- |
| `wrong-number`    | The calculator's value, or the clock's local HH:MM, is stated nowhere |
| `invented-source` | The answer cites a URL that no tool returned and nobody supplied      |
| `missing-source`  | Tools returned sources and the answer cites none                      |

A failed check costs one further generation. The model is handed its own draft and told what to change — _The calculator returned 6748 \* 9 = 60732. Give that number, exactly as it came back._ — and the correction replaces the draft only if it leaves fewer problems behind. Otherwise the draft stands. That gate is the important half: the correction comes from the same 0.8B model, so a mechanism that could not tell an improvement from a regression would be a coin toss on every reply.

**The checks are deterministic, and that is the design.** Asking the model to grade its own answer spends exactly the capacity the answer needed, and intrinsic self-correction — re-reading with nothing new to go on — degrades reasoning rather than improving it ([arXiv:2310.01798](https://arxiv.org/html/2310.01798)). What works is external feedback, so every check compares the draft against something already in the context, and the correction states the fix rather than inviting the model to hunt for one.

They are also deliberately shy. A clarifying question is asked for no citation; a long decimal quoted to fewer places counts as the calculator's number; citing the site when a page on it was read is close enough; a URL from an earlier reply is not an invention; a year-only clock answer is left alone, and a German date like `27.08.2026` is not a time. Every check would rather miss a mistake than invent one, because a check that fires on a correct answer costs a generation and teaches you to ignore the whole mechanism.

The interface says what happened rather than quietly rewriting the reply. While the corrected answer streams in it is labelled with what is being fixed, and afterwards it carries `corrected` — claimed only for an answer that now passes every check — or `flagged`, naming what is still wrong with the text on screen. An answer half fixed and advertised as corrected would be worse than no check at all.

## When a turn runs out of tool rounds

A cap has to exist, because a model that can call a tool can call one forever. But this app used to enforce it by giving up:

> `web_search` sergej kunz mystic religion russian New Age movement Wikipedia · **done**
> `web_search` sergej kunz religious figure Russian New Age mystic Soviet era · **done**
> `web_search` 俄语 новое движение Сергей · **done**
> `web_search` Russian New Age movement mystical figures · **done**
>
> I reached the limit of 4 tool rounds without settling on an answer. Try narrowing the question.

Four searches had returned results and none of them was ever read back to the user. The information needed to say _no, that name does not appear to belong to a Russian mystic_ was sitting in the context when the loop stopped.

LangChain names the two ways of enforcing a cap `force` and `generate`, and only the second ends in an answer: one final pass over what the tools returned, with the model asked to conclude from it. `src/agent/budget.ts` spends the budget in three phases on that principle.

| Phase                 | What happens                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| Rounds with tools     | Generate, execute, feed back — four times                                   |
| The wind-down warning | With one round left, the model is told so, right after the tool results     |
| The wind-down round   | The tools are withheld and the model is asked to answer from what came back |

**The warning goes where the model is reading.** It is its own turn in the conversation, after the results of the second-to-last round, because that is the only place it can change what the model does with the round it has left. A budget the model cannot see is a budget it cannot wrap up inside — which is why every agent framework that grew a tool budget grew this alongside it ([pydantic-ai-tool-budget](https://github.com/sarth6/pydantic-ai-tool-budget); [arXiv:2511.17006](https://arxiv.org/html/2511.17006v1)).

**The tools are withheld rather than forbidden.** With no tool list the chat template renders no tool block at all, so the round that has to answer has no call format in front of it to copy. On a 0.8B model that is worth considerably more than a sentence asking it not to. The results already gathered are unaffected — they are `tool` turns, not part of the tool block — and `node tools/verify-model.mjs` checks that against the real template, since the round would otherwise be asked to answer from nothing.

**An identical call is not run twice in one turn.** Re-running it would spend a network request, a rate-limit slot and a quarter of the budget to arrive at text already in the conversation, so the earlier result comes back with a note saying it has not changed. Only exact repeats, deliberately: catching near-duplicates needs a similarity threshold, and the four queries above share barely half their words, so a threshold loose enough to catch them also catches a genuine refinement. Circling with different words is what the warning is for.

**The floor under all of it is not an apology.** If even the wind-down round comes back empty, the reply is the sources the turn did find, as a citation line — every one of them from a tool result, so the reply claims nothing the turn did not earn.

The reply that comes out of this says so, next to the self-check labels: `tool budget` · _spent all 4 tool rounds, then answered with what it had_. It is as good as what the tools had returned by then and no better, and a reader deciding whether to trust it should be told which kind of answer they are looking at.

## Measuring changes

`pnpm dev` then <http://localhost:5173/?eval> opens the eval harness.

It exists because the reliability numbers below were gathered by hand, which made every prompt change a bet nobody could settle. The harness sweeps configurations over a set of scenarios and scores three things separately: whether the model reached for the right tool, whether it passed sensible arguments, and whether the final answer was right. Those come apart constantly — it calls the calculator and then misquotes the result, answers correctly from memory without the tool, or searches for the right thing under a query it rewrote — and a single pass/fail would hide the distinctions that matter most when tuning a small model. It also reports invented tool names and median reasoning length.

The eval runs in the browser rather than in Node because that is the only place the model runs at all; see the note on `CausalConvWithState` below.

The answer check is reported as two more columns, **Flagged** and **Corrected**, and **Also run each arm with the answer check off** adds a `-nocheck` twin of every arm so what it is worth can be measured inside a single run rather than across two. **Wound down** is a fifth column, counting the turns that spent the whole tool budget — those answers can still be right, so it sits beside accuracy as the cost of getting there rather than being folded into it.

Configurations are compared as whole arms, each strategy with and without skills:

| Strategy   | Reasoning budget | Routing preamble |
| ---------- | ---------------: | ---------------- |
| `baseline` |         uncapped | —                |
| `capped`   |        32 tokens | —                |
| `routed`   |        32 tokens | `Tool needed: `  |
| `verbose`  |       256 tokens | —                |

`baseline` is what ships. The others come from a finding that reads like a bug report for this app: sweeping the chain-of-thought budget on Qwen2.5-1.5B against BFCL v3 gives a sharply non-monotonic curve — 44% correct tool selection with no reasoning, **71.5% at 16 tokens**, then a collapse to 25% at 256 and 22.5% at 512, with invented function names rising from under 1% to 20% across the same range ([arXiv:2604.02155](https://arxiv.org/pdf/2604.02155)). Past roughly a hundred tokens the model reasons its way _into_ the wrong tool. Jarvis currently generates up to 1,024 tokens with no cap on the reasoning block, which puts it in the collapsed region, and the symptom the README already describes — doing the arithmetic in its head and getting it wrong, confidently — is what that failure looks like.

`capped` stops the reasoning block at a budget; `routed` also seeds it with a preamble so the model's first tokens must name the tool it intends to use, which in the same paper drove invented tool names to zero. `verbose` is included to check the collapse reproduces here rather than being assumed.

**None of this is measured on this model yet.** Those numbers are from Qwen2.5-1.5B-Instruct, an instruct model, whereas Qwen3.5 is reasoning-trained — and this app has already found that switching thinking off entirely made tool use worse. That is why the strategies cap reasoning rather than remove it, and why `baseline` remains the default until the harness says otherwise. Changing that default on the strength of someone else's benchmark is the mistake the harness was built to avoid.

Two preconditions the capped strategies depend on are checked against the real tokenizer by `node tools/verify-model.mjs`: that the chat template leaves the reasoning block open at the end of the prompt, and that `</think>` is a single token so generation can stop on it.

### How the budget is enforced

Transformers.js applies the chat template only when the input is an array of turns; a plain string is fed to the model verbatim. So the capped strategies render the prompt themselves, generate into the reasoning block up to the budget, close the block, and then resume generation from the concatenated string. The cost is a second prefill of the whole prompt, since the KV cache does not survive between pipeline calls — cheap next to decode at this model size.

## Project layout

```
src/
├── agent/      Tool-calling loop, model-output parser, answer checks, round budget, tool-call renderer
├── components/ UI: the landing page, the chat, the panels, and the eval harness
├── eval/       Scenarios, runner and metrics
├── llm/        Worker, worker client, generation strategies, phase helpers, model cache backends
├── memory/     IndexedDB store, what may be stored, what a turn recalls
├── skills/     Skill format, catalogue loader, retrieval and routing, the skills themselves
├── store/      Zustand store
├── tools/      Tool definitions, browser-direct search and reader, calculator, MCP client
└── lib/        WebGPU detection, storage/persistence, theming, formatting, reply presentation
tools/          Icon and model scripts, and the optional tool proxy (`agent-api.ts`)
```

## Agent skills

These are for agents editing this repository, and are unrelated to the [skills](#skills) the model
itself uses at runtime.

`.cursor/skills/` holds seven [Agent Skills](https://agentskills.io/) — the open `SKILL.md` format,
so Cursor, Claude Code and Codex all read them. Each one records something about this repository
that is repeatable, non-obvious, or already cost someone an afternoon.

| Skill                | Covers                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `add-agent-tool`     | Adding a tool the model can call, including the proxy endpoint a network tool needs               |
| `agent-memory`       | The IndexedDB store, soft deletion, the recall budget, and why nothing extracts in the background |
| `write-model-skill`  | Authoring a runtime skill under `src/skills/`: the 600-character cap, exemplars, triggers         |
| `debug-model-output` | Empty replies, leaking markup, unparsed tool calls — symptom to cause, and dead ends              |
| `verify-in-browser`  | What needs a real GPU, why the service worker is off in dev, how to inspect OPFS                  |
| `ship-a-change`      | Preflight checks, the GitHub Pages constraints, releasing by bumping the version                  |
| `ui-components`      | HeroUI v3 and React Aria props, theme tokens, store selectors, component tests                    |

Only the `name` and `description` of each are loaded until an agent decides one is relevant, so the
set costs little to keep installed. Invoke one explicitly with `/skill-name`.

`.cursor/rules/` makes that routing deterministic in Cursor, which a skill description alone cannot.
`agent-skills.mdc` is always in context and maps each area of work to the skill that covers it; the
other six attach themselves when a matching file is opened — `src/tools/**` pulls in the tool rule,
`src/skills/**` the runtime-skill one, and so on — and each states the two or three traps worth
knowing even if the skill is never opened. Skills hold the detail, rules decide when it is needed.

## Notes on the model

`onnx-community/Qwen3.5-0.8B-Text-ONNX` is the text-only export, loaded through the standard `text-generation` pipeline with `dtype: 'q4f16'` — which is what Transformers.js added text-only Qwen3.5 support for ([transformers.js#1602](https://github.com/huggingface/transformers.js/pull/1602)).

### Why 448 MB is the floor

The download is the largest thing this app asks of anyone, so it is worth saying plainly what the alternatives cost. Within Transformers.js and Qwen3.5-0.8B there are none.

| Export                                  | q4f16 total | Loads through                                      |
| --------------------------------------- | ----------: | -------------------------------------------------- |
| `onnx-community/Qwen3.5-0.8B-Text-ONNX` | **448 MiB** | `pipeline('text-generation')`                      |
| `onnx-community/Qwen3.5-0.8B-ONNX-OPT`  |     616 MiB | `Qwen3_5ForConditionalGeneration` + vision encoder |
| `onnx-community/Qwen3.5-0.8B-ONNX`      |     617 MiB | `Qwen3_5ForConditionalGeneration` + vision encoder |

Those are the only first-party ONNX conversions; every other Qwen3.5-0.8B ONNX repository on the Hub is a copy of one of them or larger. Within the export in use, `q4f16` is the smallest of the five variants published — `q4` is 526 MiB, int8 896 MiB, fp16 1.4 GiB, fp32 2.9 GiB — and INT4 is as far as ONNX Runtime Web's WebGPU backend goes.

Two facts about the model account for the rest. Qwen3.5 has no size below 0.8B: the small series is 0.8B, 2B, 4B and 9B, so there is no smaller sibling to fall back to. And 0.8B parameters at four bits would be nearer 400 MB were it not for a 248,320-token vocabulary tied to the output layer, which is a third of the weights on its own.

`node tools/verify-model.mjs` re-measures all of this against the Hub and fails if a smaller variant appears, so the claim above is checked rather than remembered.

Tool definitions are passed straight to the pipeline via its `tools` option, added in Transformers.js v4.2, so the chat template renders them itself rather than us hand-assembling a prompt.

Several details about this model cost real debugging time and are easy to get wrong:

- **Reasoning has to be switched on.** Left at its default the chat template writes an empty `<think></think>` pair into the prompt, and the model answers immediately — including inventing arithmetic instead of reaching for the calculator. The worker passes `enable_thinking: true` through `tokenizer_encode_kwargs`, which is what reaches `apply_chat_template`.
- **Tool calls are XML, not JSON.** Qwen3.5's template asks for `<tool_call><function=name><parameter=key>value</parameter></function></tool_call>`. The parser reads that shape and treats parameter values as trimmed strings, since the format carries no types. JSON tool calls are still accepted because other Qwen builds emit them.
- **The published `eos_token_id` is wrong for chat.** `generation_config.json` lists only `<|endoftext|>`, so generation runs straight past `<|im_end|>` and the model starts writing the user's next turn. The worker stops on both tokens.
- **Sampling follows the thinking-mode preset.** Qwen publishes different settings per mode; the non-thinking preset (`temperature 0.7, top_p 0.8`) was in use here by mistake. `min_p` and `presence_penalty` from the official recommendation have no equivalent in Transformers.js, so a light `repetition_penalty` stands in.
- **The answer is often trapped in the think block.** The model regularly reasons its way to a conclusion and stops without restating it, leaving no visible content. The agent loop promotes that reasoning to the answer; otherwise the reply renders empty and, worse, an empty assistant message enters the history and the next turn loses the context.

### How reliable is it, really

A 0.8B model is small, and it behaves like one. Over ten scripted runs against a warm model in this configuration, it called the calculator for `98765 * 4321` five times and recalled a fact from the previous turn eight times. When it skips the calculator it does the arithmetic in its head and gets it wrong, confidently.

Two things that sound like fixes are not. Lowering the temperature from 1.0 to 0.6 changed nothing measurable. Adding firmer instructions about tool use to the system prompt made it clearly worse — tool use fell to 1 in 6 — so the prompt was kept short. Treat the tools as an assist, not a guarantee.

That second result is the one worth dwelling on, because it is the reason skills here look nothing like skills elsewhere: at this size the model does not follow instructions about tools, it follows examples of them. Whether the skills and reasoning budgets actually improve on the numbers above is what `?eval` is for; the figures in this section predate both and are the baseline they have to beat.

The model cannot run on the CPU at all: its Gated DeltaNet layers use the `CausalConvWithState` operator, which ONNX Runtime Web implements and the Node build does not. WebGPU is a requirement, not an optimisation.

## Licence

MIT
