# Jarvis

**[Try it →](https://devbadya.github.io/Jarvis/)** (Chrome or Edge 113+, ~4 GB of GPU memory)

A chat agent that runs its language model **inside your browser**. Qwen3.5-0.8B is executed on your own GPU through WebGPU, so there is no API key, no per-token cost, and no conversation sent to a model provider. Install it once and it keeps working offline.

The agent can search, read pages, calculate exactly, and call any MCP server you connect. Because a 0.8B model needs the help, common requests are routed through [skills](#skills) that show it a worked example rather than telling it what to do.

There is no backend. Not "a backend you can skip" — the project ships no server code at all, and `pnpm build` produces a directory of static files that needs nothing but a web server to host it. That is why the deployed site above has the full tool set rather than a reduced one.

## How it works

```
Browser tab
├── UI (React 19 + HeroUI v3)
├── Service worker ──► app shell + ONNX runtime precached (offline start)
├── Web Worker ──────► Transformers.js ──► ONNX Runtime Web ──► WebGPU
├── Skills ──────────► worked examples + a narrowed tool list, matched per turn
├── Answer check ────► every reply, read back against the tool results
└── Tool loop ───────► search provider  (Wikipedia, or Jina with your key)
                    ├► r.jina.ai        (page reader)
                    └► MCP servers over HTTP
```

Inference lives in a Web Worker. A 0.8B forward pass on the main thread would freeze the interface between every streamed token.

The model emits reasoning inside `<think>` blocks and tool requests as JSON inside `<tool_call>` blocks. `src/agent/parse.ts` separates the three streams; `src/agent/loop.ts` executes the requested tools and feeds their output back until the model answers without asking for another tool (capped at four rounds). The answer it settles on is then [checked against what the tools returned](#checking-the-answer-before-it-is-shown) before anyone sees it.

## Installing the model

The model is **448 MB** and downloads once. Two things make it stick:

1. **Persistent storage.** Before downloading, the app calls `navigator.storage.persist()`. Without that grant the browser treats the weights as best-effort data and may evict them under storage pressure — turning a one-time download into a recurring one. Chrome grants persistence silently for installed PWAs and sufficiently engaged sites.
2. **OPFS instead of the Cache API.** Transformers.js caches downloads in the Cache API by default, but Chrome rejects the 448 MB weights file there with `Failed to execute 'put' on 'Cache': Unexpected internal error` — the download completed and then quietly vanished, so every visit re-fetched it. `src/llm/opfs-cache.ts` replaces that backend with the Origin Private File System, which is built for large binaries and streams them to disk. Downloads land under a `.part` name and are renamed only once complete, so an interrupted install can never be mistaken for a finished one.

A second visit then reaches the chat in about a second instead of four minutes.

The gate screen shows whether the model is installed, how much space it occupies, whether storage is persistent, and offers a **Remove model** button to reclaim the space.

Installing Jarvis as a PWA (the install icon in Chrome's address bar) is what makes offline use reliable, because installed apps get persistent storage automatically.

The service worker precaches only the app shell — roughly 1 MB. The ONNX runtime is fetched from the Transformers.js CDN on first load and stored in OPFS next to the weights, so it is present offline too. A new version of the app takes over once every tab has been closed, rather than reloading the page and discarding an open conversation.

## Where the model comes from

By default the weights are fetched from the Hugging Face Hub. It works well as a public source, and this was verified rather than assumed:

- **No account, no token.** The repository is public and ungated.
- **Any origin may fetch it.** The Hub reflects the requesting `Origin` back in `Access-Control-Allow-Origin`, so a browser on any domain can download directly.
- **Byte ranges are supported** (`Accept-Ranges: bytes`), so downloads can resume.
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

The host must send `Access-Control-Allow-Origin` for your domain and should support range requests. Those are the two things `node tools/verify-model.mjs` checks, and it reads the same two variables, so point them at your mirror and run it before deploying. **Cloudflare R2 fits well**: 467 MB sits inside the 10 GB free tier, egress is free at any volume, and a public bucket on a custom domain gives you a CDN with configurable CORS. Uploading to your own Hugging Face repository works too and takes minutes.

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

The service worker is disabled in development. To exercise the real PWA and offline behaviour, use `pnpm build && pnpm preview`.

## Deploying

`pnpm build` writes `dist/`. Upload it anywhere that serves static files — GitHub Pages, Cloudflare Pages, Netlify, S3, nginx. There are no functions to deploy, no environment variables to set, and no runtime configuration: what the tools need is either keyless or entered by the user in the app.

## Scripts

| Command          | Purpose                                           |
| ---------------- | ------------------------------------------------- |
| `pnpm dev`       | Dev server                                        |
| `pnpm build`     | Typecheck and produce a production bundle         |
| `pnpm preview`   | Serve the production build, service worker active |
| `pnpm test`      | Unit and component tests (Vitest)                 |
| `pnpm typecheck` | TypeScript, no emit                               |
| `pnpm lint`      | oxlint                                            |
| `pnpm format`    | Prettier                                          |
| `pnpm check`     | Everything CI runs                                |

Two helper scripts live in `tools/`:

- `node tools/verify-model.mjs` checks that all seven weight files are still where the app looks for them and that the host will let a browser read them, that the chat template renders tool definitions the way the agent loop expects, and that the preconditions the reasoning budget relies on hold. It takes about a second. It stops short of generating, because it cannot — see `CausalConvWithState` below.
- `./tools/generate-icons.sh` regenerates the PWA raster icons from the committed SVG sources.

## Deployment and releases

Every push to `main` publishes https://devbadya.github.io/Jarvis/. `.github/workflows/deploy.yml` reuses the CI workflow as a gate, builds, deploys to Pages, and then cuts a release. Nothing is published unless lint, formatting, types, tests, and the build all pass.

A fork needs one manual step: **Settings → Pages → Source: GitHub Actions**. The workflow could enable Pages itself, but only with a token holding repository administration rights, which is not worth handing to CI.

Three details make the app work from a repository sub-path rather than a domain root:

- **`base` is set at build time** from the path Pages reports, and the PWA manifest's `start_url` and `scope` follow it. Without this every asset URL would point one directory too high.
- **`404.html` is a copy of the app shell**, so a deep link opens the app instead of GitHub's error page on the first visit, before the service worker is installed.
- **Every tool ships**, including `web_search` and `read_page`. They used to be switched off here because Pages cannot host a proxy; they no longer need one.

**Releasing is a version bump.** The workflow tags and publishes `v<version>` from `package.json` once that tag does not yet exist, with notes generated from the commits since the last release. Ordinary commits deploy without leaving empty releases behind.

## Tools

| Tool           | What it does                                                 |
| -------------- | ------------------------------------------------------------ |
| `web_search`   | Wikipedia by default; full web search with your own API key. |
| `read_page`    | Fetches a URL and returns its readable text.                 |
| `calculator`   | Exact arithmetic via a hand-written parser.                  |
| `current_time` | Local date, time, and timezone.                              |

### How the network tools work without a server

A browser may only read a response whose origin opts in with CORS headers, which is why apps like this normally ship a proxy. Both network tools instead use endpoints that do opt in, so the request goes straight from the page. `src/tools/web.ts` holds all of it.

**`read_page`** goes through `r.jina.ai`, which reflects the requesting origin, needs no account, and returns extracted markdown rather than raw HTML. Anonymous use is capped at 20 requests per minute per IP; a Jina key raises that and is optional.

**`web_search`** has a provider choice under **Tools → Web access**:

| Provider  | Key   | Covers                                                         |
| --------- | ----- | -------------------------------------------------------------- |
| Wikipedia | none  | Encyclopedic facts. Nothing about current events. **Default.** |
| Jina      | yours | General web search, via `s.jina.ai`.                           |

Wikipedia is the default because it works with no signup, and because a 0.8B model's worst habit is inventing facts it half-remembers. The tool description changes with the provider, so the model is told whether it is searching an encyclopedia or the web — without that it cheerfully asks Wikipedia for this morning's news.

One Jina key covers both services: search needs it, the reader is merely faster with it. Keys are entered at runtime and kept in `localStorage`. None of this reads a build-time environment variable, deliberately: a key compiled into the bundle is a key published to every visitor.

**Choosing a provider is mostly a CORS question, and a stricter one than it looks.** Tavily and Exa were both offered here and both had to be removed. Tavily answers the preflight with the origin reflected and then omits `Access-Control-Allow-Origin` from the actual POST; Exa sends it for `http://localhost` only. Each worked perfectly against the dev server and failed on the deployed site. Before adding a provider, check the header on the real request from the real origin, not on the preflight and not from localhost.

Dropping the proxy also removed a liability. A server-side fetch proxy is a confused deputy — it can be aimed at loopback, link-local, or RFC1918 addresses and made to read internal services, so the old one carried an SSRF guard. The reader service runs on the public internet and cannot see your network, so that class of attack no longer has a target. `read_page` still refuses private and non-HTTP URLs, now only to fail clearly on a target that could never work.

It removed a deployment compromise too. The Pages build used to unset `VITE_AGENT_API_BASE`, which dropped `web_search` and `read_page` from the tool list because a static host cannot run the proxy. The published site was a reduced version of the app. Both tools now ship everywhere.

The calculator deliberately avoids `eval`. Expressions come from model output, which is attacker-influenceable as soon as the model has read an untrusted page.

### What leaves the browser

Inference does not: prompts, reasoning, and replies never leave the GPU. Tools are the exception, and always were. A `web_search` call sends the query to the chosen provider and a `read_page` call sends the URL to the reader — the difference now is that these go direct, with no server of ours in the path to log them.

### MCP servers

Open **Tools** in the header to connect a Model Context Protocol server over Streamable HTTP. Its tools are merged into the model's tool list, namespaced as `<server-id>__<tool-name>`. Configuration is stored in `localStorage`.

The server must send permissive CORS headers, because requests originate from the page with no proxy in between. A server that fails to connect is skipped rather than blocking startup, and the error is shown next to its entry.

Tool results are truncated at 8,000 characters before they reach the model. Long results are not a neutral cost: across several models, function-calling accuracy drops by between 7% and 91% as tool responses grow ([arXiv:2505.10570](https://arxiv.org/html/2505.10570)), and an unbounded web page would be by far the largest thing in this model's context.

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

Matching is by regex on the user's message, not by asking the model. Routing through the model spends exactly the capacity the skill exists to conserve, and metadata-only routing is unreliable even for much larger models ([arXiv:2603.22455](https://arxiv.org/html/2603.22455v5)). A regex costs nothing and cannot hallucinate. It also caps the library at somewhere around twenty skills — which is fine, because skill-selection accuracy collapses past a critical library size anyway, and for a 0.8B model that size is small.

Six ship: `arithmetic`, `current-date`, `summarize-url`, `lookup-term`, `research-question` and `weather`.

### Why `weather` exists

The weather is the clearest case of something the model cannot possibly know, and the one it is most willing to make up: a plausible temperature is easy to write and impossible to tell from a real one. So `weather` fires on the shape of the question — anything naming the weather or a forecast, `how hot is it`, `is it raining`, `will it rain` — and teaches by example that the place goes into the query and the figures come out of the results.

Its priority sits above `current-date`, which owns _today_ and _right now_ and would otherwise answer _what's the weather in Tokyo today_ with the date. Its triggers exclude `weather` and `forecast` when they appear inside a URL, so a linked forecast stays with `summarize-url` and gets read rather than searched for.

One limit worth stating plainly: this needs a search provider that covers the live web. The default is Wikipedia, which has an article on Berlin's climate and nothing at all on this morning, so answering current conditions means configuring a Jina key under **Tools → Web access**.

### Why `lookup-term` exists

Asked _what is 1inch_, the model searched for **`1 inch to measurement in centimeters`**. It split the token, decided on its own that the question was about unit conversion, and searched for that instead — so the results never got the chance to mention that 1inch is a DEX aggregator.

Nothing in the prompt caused this and no skill was firing; the model simply preferred a reading it had seen more often in training. It is a good illustration of why the tool name is not enough to judge a turn by: `web_search` was the right tool, called at the right moment, with arguments that made the answer impossible.

So `lookup-term` triggers on the shape of the question — `what is <single token>`, or any subject containing a digit — and teaches by example that the query is the user's word, unaltered, and that what the term _means_ is something the results decide rather than the model. Its second exemplar runs search then `read_page`, which is the "check what actually came back" half of the same lesson.

The eval scores this directly: scenarios may assert on the arguments a tool was called with, not just its name, and the harness reports that as a separate **Right args** column.

Skills are bundled at build time rather than fetched, so they survive going offline without needing service-worker precaching.

## Checking the answer before it is shown

A skill fires on some requests. This runs on all of them.

Between the model settling on an answer and that answer reaching the screen, `src/agent/review.ts` reads it back against what the turn actually produced — the results the tools returned, and the URLs already in the conversation. Three things are checked:

| Check             | Fires when                                                                  |
| ----------------- | --------------------------------------------------------------------------- |
| `wrong-number`    | The calculator returned a value the answer states nowhere, at any precision |
| `invented-source` | The answer cites a URL that no tool returned and nobody supplied            |
| `missing-source`  | Tools returned sources and the answer cites none                            |

A failed check costs one further generation. The model is handed its own draft and told what to change — _The calculator returned 6748 \* 9 = 60732. Give that number, exactly as it came back._ — and the correction replaces the draft only if it leaves fewer problems behind. Otherwise the draft stands. That gate is the important half: the correction comes from the same 0.8B model, so a mechanism that could not tell an improvement from a regression would be a coin toss on every reply.

**The checks are deterministic, and that is the design.** Asking the model to grade its own answer spends exactly the capacity the answer needed, and intrinsic self-correction — re-reading with nothing new to go on — degrades reasoning rather than improving it ([arXiv:2310.01798](https://arxiv.org/html/2310.01798)). What works is external feedback, so every check compares the draft against something already in the context, and the correction states the fix rather than inviting the model to hunt for one.

They are also deliberately shy. A clarifying question is asked for no citation; a long decimal quoted to fewer places counts as the calculator's number; citing the site when a page on it was read is close enough; a URL from an earlier reply is not an invention. Every check would rather miss a mistake than invent one, because a check that fires on a correct answer costs a generation and teaches you to ignore the whole mechanism.

The interface says what happened rather than quietly rewriting the reply. While the corrected answer streams in it is labelled with what is being fixed, and afterwards it carries `corrected` — claimed only for an answer that now passes every check — or `flagged`, naming what is still wrong with the text on screen. An answer half fixed and advertised as corrected would be worse than no check at all.

## Measuring changes

`pnpm dev` then <http://localhost:5173/?eval> opens the eval harness.

It exists because the reliability numbers below were gathered by hand, which made every prompt change a bet nobody could settle. The harness sweeps configurations over a set of scenarios and scores three things separately: whether the model reached for the right tool, whether it passed sensible arguments, and whether the final answer was right. Those come apart constantly — it calls the calculator and then misquotes the result, answers correctly from memory without the tool, or searches for the right thing under a query it rewrote — and a single pass/fail would hide the distinctions that matter most when tuning a small model. It also reports invented tool names and median reasoning length.

The eval runs in the browser rather than in Node because that is the only place the model runs at all; see the note on `CausalConvWithState` below.

The answer check is reported as two more columns, **Flagged** and **Corrected**, and **Also run each arm with the answer check off** adds a `-nocheck` twin of every arm so what it is worth can be measured inside a single run rather than across two.

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
├── agent/      Tool-calling loop, model-output parser, answer checks, tool-call renderer
├── components/ UI, including the eval harness
├── eval/       Scenarios, runner and metrics
├── llm/        Worker, worker client, generation strategies, phase helpers
├── skills/     Skill format, loader, trigger matching, the skills themselves
├── store/      Zustand store
├── tools/      Tool definitions, browser-direct search and reader, calculator, MCP client
└── lib/        WebGPU detection, storage/persistence, theming, formatting
tools/          Icon and model scripts
```

## Agent skills

These are for agents editing this repository, and are unrelated to the [skills](#skills) the model
itself uses at runtime.

`.cursor/skills/` holds six [Agent Skills](https://agentskills.io/) — the open `SKILL.md` format,
so Cursor, Claude Code and Codex all read them. Each one records something about this repository
that is repeatable, non-obvious, or already cost someone an afternoon.

| Skill                | Covers                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `add-agent-tool`     | Adding a tool the model can call, including the proxy endpoint a network tool needs       |
| `write-model-skill`  | Authoring a runtime skill under `src/skills/`: the 600-character cap, exemplars, triggers |
| `debug-model-output` | Empty replies, leaking markup, unparsed tool calls — symptom to cause, and dead ends      |
| `verify-in-browser`  | What needs a real GPU, why the service worker is off in dev, how to inspect OPFS          |
| `ship-a-change`      | Preflight checks, the GitHub Pages constraints, releasing by bumping the version          |
| `ui-components`      | HeroUI v3 and React Aria props, theme tokens, store selectors, component tests            |

Only the `name` and `description` of each are loaded until an agent decides one is relevant, so the
set costs little to keep installed. Invoke one explicitly with `/skill-name`.

`.cursor/rules/` makes that routing deterministic in Cursor, which a skill description alone cannot.
`agent-skills.mdc` is always in context and maps each area of work to the skill that covers it; the
other five attach themselves when a matching file is opened — `src/tools/**` pulls in the tool rule,
`src/skills/**` the runtime-skill one, and so on — and each states the two or three traps worth
knowing even if the skill is never opened. Skills hold the detail, rules decide when it is needed.

## Notes on the model

`onnx-community/Qwen3.5-0.8B-Text-ONNX` is the text-only export, loaded through the standard `text-generation` pipeline with `dtype: 'q4f16'`. The multimodal build of the same model also exists, but it ships a vision encoder this app never feeds, requires the dedicated `Qwen3_5ForConditionalGeneration` class, and downloads roughly 150 MB more.

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
