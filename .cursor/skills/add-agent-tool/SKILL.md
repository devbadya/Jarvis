---
name: add-agent-tool
description: Add, change or remove a tool that Jarvis's model can call. Use when asked to give the agent a new capability (search, fetch, compute, read something), when editing src/tools/, when a tool needs a server-side proxy endpoint, or when a tool exists but the model never calls it correctly.
license: MIT
---

# Adding a tool the model can call

Tools live in `src/tools/`. Every tool is a `{ schema, execute }` pair built by `defineTool` and
handed to `runAgent`, which matches the model's request against `schema.function.name`.

## Non-negotiables

- **Arguments are untyped strings.** Qwen3.5 emits tool calls as XML, and `src/agent/parse.ts`
  passes every `<parameter>` value through as a trimmed string. `execute` receives
  `Record<string, unknown>`. Coerce and validate everything yourself — `Number(args.limit)` may be
  `NaN`, `args.query` may be absent.
- **The return value goes straight into the model's context, so cap it.** Return a compact string,
  not JSON, not megabytes. Long tool results are not a neutral cost: function-calling accuracy falls
  by 7% to 91% as responses grow, which is why `read_page` truncates at `MAX_PAGE_CHARS` (8,000
  characters, roughly 2,000 tokens). Anything that can return an unbounded body needs the same
  treatment.
- **Throw on failure.** `runAgent` catches it and feeds `Tool "<name>" failed: <message>` back to
  the model, which usually recovers. Never return an error string that reads like a result.
- **The description is prompt text.** The chat template renders it into every prompt. Write one or
  two sentences that say _when_ to reach for the tool, matching the voice of the existing four.
  This model is 0.8B — long or hedged descriptions make tool use worse, not better.
- **Names are `snake_case`.** MCP tools are namespaced `<server-id>__<tool-name>` by
  `src/tools/mcp.ts`; do not use `__` in a built-in name.

## Steps

1. **Write the tool** in `src/tools/builtins.ts` (or a new module in `src/tools/` if it needs real
   logic, like `calculator.ts`):

```ts
export const myTool = defineTool(
  'my_tool',
  'One sentence on what it returns. One sentence on when to use it.',
  {
    type: 'object',
    properties: { subject: { type: 'string', description: 'For example: Berlin' } },
    required: ['subject'],
  },
  async (args) => {
    const subject = String(args.subject ?? '').trim()
    if (!subject) throw new Error('subject must not be empty')
    return `…compact result…`
  },
)
```

2. **Register it** in the `builtinTools` export at the bottom of `src/tools/builtins.ts`. There are
   two arrays — one for when the proxy is available and one for when it is not. A tool that needs
   no network goes in both; a tool that calls `/api/*` goes only in the first.

3. **If it needs the network, add the proxy endpoint.** The browser cannot fetch arbitrary origins,
   so add a branch to the `/api/` middleware in `tools/vite-plugin-agent-api.ts` and call it through
   `getJson` in `builtins.ts`. Reuse `assertPublicUrl` for anything URL-shaped: it blocks loopback,
   link-local and RFC1918 addresses so the proxy cannot be aimed at internal services. Reuse
   `fetchWithLimits` for its timeout and size caps.

4. **Test the logic.** Pure functions get a unit test next to them (`calculator.test.ts` is the
   model). Do not write a test that hits the network or needs a GPU.

5. **Add an eval scenario** to `src/eval/scenarios.ts`: a prompt that should reach for the new tool,
   its `expectTool`, and an `accept` predicate over the final answer. Set `online: true` if it needs
   the proxy. Without one, nothing measures whether the model actually routes to the tool, which is
   the part most likely to be wrong.

6. **Update the Tools table in `README.md`.** It is the only user-facing list of built-ins; the
   Tools panel in the app renders `tools` from the store and needs no change.

7. Run `pnpm check`.

## When the model has a tool but will not use it

The tool list is not the problem — check `debug-model-output` first. In particular, do not try to
fix low tool-use rates by adding instructions to `SYSTEM_PROMPT`; that was measured and made things
clearly worse. Measure the rate at <http://localhost:5173/?eval> before and after any attempt,
because sampling makes a handful of manual runs indistinguishable from noise.

## Budget

`MAX_TOOL_ROUNDS` in `src/llm/config.ts` caps a turn at four generate-and-execute rounds. A tool
that reliably needs several follow-up calls to be useful is the wrong shape — fold the work into
one call instead of raising the cap.
