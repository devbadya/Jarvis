# Jarvis

A chat agent that runs its language model **inside your browser**. Qwen3.5-0.8B is executed on your own GPU through WebGPU, so there is no API key, no per-token cost, and no conversation data leaving the machine. The agent can search the web, read pages, calculate exactly, and call any MCP server you connect.

## How it works

```
Browser tab
├── UI (React 19 + HeroUI v3)
├── Web Worker ──► Transformers.js ──► ONNX Runtime Web ──► WebGPU
└── Tool loop ───► /api/search, /api/fetch  (dev server or serverless function)
                └► MCP servers over HTTP
```

Inference lives in a Web Worker. A 0.8B forward pass on the main thread would freeze the interface between every streamed token.

The model emits reasoning inside `<think>` blocks and tool requests as JSON inside `<tool_call>` blocks. `src/agent/parse.ts` separates the three streams; `src/agent/loop.ts` executes the requested tools and feeds their output back until the model answers without asking for another tool (capped at four rounds).

## Requirements

- **Chrome or Edge 113+.** WebGPU is required. Safari and Firefox still ship it behind a flag, and there is no CPU fallback path in this build.
- **About 4 GB of GPU memory.**
- **Node 20+** and pnpm for development.

The first run downloads roughly 600 MB of weights. They are cached in the browser afterwards, so later visits start offline.

## Getting started

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173 and press **Load model**.

## Scripts

| Command          | Purpose                                     |
| ---------------- | ------------------------------------------- |
| `pnpm dev`       | Dev server including the tool API endpoints |
| `pnpm build`     | Typecheck and produce a production bundle   |
| `pnpm preview`   | Serve the production build locally          |
| `pnpm test`      | Unit and component tests (Vitest)           |
| `pnpm typecheck` | TypeScript, no emit                         |
| `pnpm lint`      | oxlint                                      |
| `pnpm format`    | Prettier                                    |
| `pnpm check`     | Everything CI runs                          |

## Tools

Built in and always available:

| Tool           | What it does                                                 |
| -------------- | ------------------------------------------------------------ |
| `web_search`   | DuckDuckGo results — title, URL, snippet. No API key needed. |
| `read_page`    | Fetches a URL and returns its readable text.                 |
| `calculator`   | Exact arithmetic via a hand-written parser.                  |
| `current_time` | Local date, time, and timezone.                              |

### Why the network tools need a server

The browser cannot fetch arbitrary origins directly; CORS blocks it. `web_search` and `read_page` therefore call `/api/search` and `/api/fetch`, which are served in development by `tools/vite-plugin-agent-api.ts`. That module also guards against SSRF by refusing loopback, link-local, and RFC1918 addresses, so the proxy cannot be pointed at internal services or cloud metadata endpoints.

For a static deployment, host `search()` and `readPage()` from that same file as two serverless functions under the same paths. Everything else is static and needs no server.

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
└── lib/        WebGPU detection, formatting
tools/          Vite plugin serving the dev-time tool API
```

## Notes on the model

`onnx-community/Qwen3.5-0.8B-ONNX-OPT` is loaded through the dedicated `Qwen3_5ForConditionalGeneration` class. The generic `pipeline` helper does not yet support this architecture, and support only exists on the Transformers.js v4 preview line, which is why that dependency is pinned to an exact version.

The model is multimodal and has a vision encoder. This build only sends text; wiring up image input means passing a `RawImage` as the processor's second argument.

## Licence

MIT
