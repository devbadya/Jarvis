# Jarvis

A chat agent that runs its language model **inside your browser**. Qwen3.5-0.8B is executed on your own GPU through WebGPU, so there is no API key, no per-token cost, and no conversation data leaving the machine. Install it once and it keeps working offline.

The agent can search the web, read pages, calculate exactly, and call any MCP server you connect.

## How it works

```
Browser tab
├── UI (React 19 + HeroUI v3)
├── Service worker ──► app shell + ONNX runtime precached (offline start)
├── Web Worker ──────► Transformers.js ──► ONNX Runtime Web ──► WebGPU
└── Tool loop ───────► /api/search, /api/fetch  (dev server or serverless function)
                    └► MCP servers over HTTP
```

Inference lives in a Web Worker. A 0.8B forward pass on the main thread would freeze the interface between every streamed token.

The model emits reasoning inside `<think>` blocks and tool requests as JSON inside `<tool_call>` blocks. `src/agent/parse.ts` separates the three streams; `src/agent/loop.ts` executes the requested tools and feeds their output back until the model answers without asking for another tool (capped at four rounds).

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

The one real risk is that the specific conversion we depend on, `onnx-community/Qwen3.5-0.8B-Text-ONNX`, is a third-party repository that could be renamed or removed. If that matters to you, mirror it.

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

The host must send `Access-Control-Allow-Origin` for your domain and should support range requests. **Cloudflare R2 fits well**: 467 MB sits inside the 10 GB free tier, egress is free at any volume, and a public bucket on a custom domain gives you a CDN with configurable CORS. Uploading to your own Hugging Face repository works too and takes minutes.

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

## Scripts

| Command          | Purpose                                           |
| ---------------- | ------------------------------------------------- |
| `pnpm dev`       | Dev server including the tool API endpoints       |
| `pnpm build`     | Typecheck and produce a production bundle         |
| `pnpm preview`   | Serve the production build, service worker active |
| `pnpm test`      | Unit and component tests (Vitest)                 |
| `pnpm typecheck` | TypeScript, no emit                               |
| `pnpm lint`      | oxlint                                            |
| `pnpm format`    | Prettier                                          |
| `pnpm check`     | Everything CI runs                                |

Two helper scripts live in `tools/`:

- `node tools/verify-model.mjs` checks that the model id resolves and that the chat template renders tool definitions the way the agent loop expects. Add `--generate` to download the weights and run a real generation.
- `./tools/generate-icons.sh` regenerates the PWA raster icons from the committed SVG sources.

## Tools

| Tool           | What it does                                                 |
| -------------- | ------------------------------------------------------------ |
| `web_search`   | DuckDuckGo results — title, URL, snippet. No API key needed. |
| `read_page`    | Fetches a URL and returns its readable text.                 |
| `calculator`   | Exact arithmetic via a hand-written parser.                  |
| `current_time` | Local date, time, and timezone.                              |

### Why the network tools need a server

The browser cannot fetch arbitrary origins directly; CORS blocks it. `web_search` and `read_page` therefore call `/api/search` and `/api/fetch`, served in development by `tools/vite-plugin-agent-api.ts`. That module guards against SSRF by refusing loopback, link-local, and RFC1918 addresses, so the proxy cannot be pointed at internal services or cloud metadata endpoints.

For a static deployment, host `search()` and `readPage()` from that file as two serverless functions under the same paths. Everything else is static.

The calculator deliberately avoids `eval`. Expressions come from model output, which is attacker-influenceable as soon as the model has read an untrusted page.

### MCP servers

Open **Tools** in the header to connect a Model Context Protocol server over Streamable HTTP. Its tools are merged into the model's tool list, namespaced as `<server-id>__<tool-name>`. Configuration is stored in `localStorage`.

The server must send permissive CORS headers, because requests originate from the page with no proxy in between. A server that fails to connect is skipped rather than blocking startup, and the error is shown next to its entry.

## Project layout

```
src/
├── agent/      Tool-calling loop and model-output parser
├── components/ UI
├── llm/        Worker, worker client, model configuration
├── store/      Zustand store
├── tools/      Tool definitions, calculator, MCP client
└── lib/        WebGPU detection, storage/persistence, formatting
tools/          Vite plugin for the dev tool API, icon and model scripts
```

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

The model cannot run on the CPU at all: its Gated DeltaNet layers use the `CausalConvWithState` operator, which ONNX Runtime Web implements and the Node build does not. WebGPU is a requirement, not an optimisation.

## Licence

MIT
