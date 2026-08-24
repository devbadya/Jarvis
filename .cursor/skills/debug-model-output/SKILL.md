---
name: debug-model-output
description: Diagnose bad model behaviour in Jarvis - empty replies, visible think or tool_call markup, the model writing the user's next turn, tool calls that are never parsed, or the model doing arithmetic in its head instead of calling the calculator. Use when touching src/agent/parse.ts, src/agent/loop.ts, src/llm/worker.ts or src/llm/config.ts, or when the assistant's answers look wrong.
license: MIT
---

# Debugging what the model produces

Most of these symptoms have been hit before and have a known cause. Check this table before
changing sampling parameters or the system prompt.

| Symptom                                                  | Cause                                                                                                   | Where                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Reply renders empty                                      | The model reasoned to a conclusion inside `<think>` and stopped without restating it                    | `promoteReasoningIfEmpty` in `src/agent/loop.ts`                              |
| Model keeps going and writes the user's next turn        | Published `generation_config.json` lists only `<\|endoftext\|>`, so generation runs past `<\|im_end\|>` | `endOfTurnTokens()` in `src/llm/worker.ts`                                    |
| Model answers instantly, invents arithmetic, skips tools | Reasoning is off, so the template writes an empty `<think></think>` pair into the prompt                | `tokenizer_encode_kwargs: { enable_thinking: true }` in `src/llm/worker.ts`   |
| `<tool_call>` or `<\|im_end\|>` visible in the chat      | Parser is not stripping it                                                                              | `parseModelOutput` / `SPECIAL_TOKEN` in `src/agent/parse.ts`                  |
| Tool call is emitted but never executed                  | Qwen3.5 emits XML, not JSON                                                                             | `parseXmlToolCall` in `src/agent/parse.ts`                                    |
| Reasoning shows up as the answer on a normal turn        | Promotion is only correct when the turn is over                                                         | `parsed.toolCalls.length === 0` guard in `loop.ts`                            |
| Tool receives `"5"` where a number was expected          | XML parameters carry no types                                                                           | Coerce in the tool — see `add-agent-tool`                                     |
| Model asks for a tool that does not exist                | Usually long reasoning, not a broken tool list                                                          | `Unknown tool` branch in `loop.ts`; measured as `hallucination` in `src/eval` |
| One turn generates twice and the reply is retyped        | The answer failed a check and a correction was requested                                                | `reviewAnswer` in `src/agent/review.ts`, wired in `loop.ts`                   |
| A correction was generated and then thrown away          | It left as many problems as the draft, so the draft stands                                              | `settle` in `src/agent/loop.ts`                                               |

## Facts that are easy to get wrong

- **Reasoning starts before the stream does.** With thinking enabled the prompt ends with an open
  `<think>`, so the model's first tokens are already reasoning and the opening tag never appears in
  the output — only `</think>` does. `takeLeadingReasoning` exists for exactly this.
- **Special tokens must survive streaming.** The `TextStreamer` is configured with
  `skip_special_tokens: false` because tool calls and reasoning arrive as markup. Turning that on
  silently deletes every tool call.
- **Sampling follows Qwen's thinking-mode preset** (`temperature 1.0, top_p 0.95, top_k 20`).
  `min_p` and `presence_penalty` have no equivalent in Transformers.js, so `repetition_penalty:
1.05` stands in for the latter. The non-thinking preset was in use here once and roughly halved
  tool use.
- **Truncated trailing blocks are tolerated on purpose.** Every block regex accepts a missing
  closing tag, because generation can hit `max_new_tokens` mid-block. Do not "fix" that.
- **Reasoning length is a tuning knob, not a free parameter.** `STRATEGIES` in `src/llm/config.ts`
  caps the reasoning phase, and `runAgent` takes one via `options.strategy`. The capped strategies
  render the prompt themselves and generate in two phases, because Transformers.js only applies the
  chat template when the input is an array of turns — `src/llm/phases.ts` holds the split and close
  helpers.

## The answer check

Every reply passes through `reviewAnswer` before `runAgent` returns it, on every turn — unlike a
skill, nothing routes it. A finding costs one more generation, capped by `MAX_CORRECTIONS`, and the
result only replaces the draft when it leaves strictly fewer findings behind. `corrected` is claimed
only for an answer that then passes every check; a half-fixed one is shown labelled with what is
still wrong.

Three things follow from that, and all three are easy to undo by accident:

- **The checks compare the draft against evidence, never against the model's opinion of it.**
  Intrinsic self-correction degrades reasoning (arXiv:2310.01798); external feedback is what works.
  A check that cannot point at a tool result does not belong here.
- **A check that fires on a correct answer is a bug**, not a strict setting. It costs a generation
  and trains the user to ignore the label. `review.test.ts` pins the shy cases — a clarifying
  question, a rounded decimal, a source carried over from an earlier turn — and they are the point.
- **Only successful tool results become evidence.** A failed fetch has nothing to check against, and
  demanding a citation for a page that never loaded is worse than saying nothing.

`pnpm test` covers all of it: the checks are pure functions and `loop.test.ts` drives the correction
round with a scripted client, so none of this needs a GPU.

## What does not work

Three changes look like fixes and are not:

- Lowering the temperature from 1.0 to 0.6 changed nothing measurable.
- Adding firmer instructions about tool use to `SYSTEM_PROMPT` made it **worse** — tool use fell to
  roughly 1 in 6. The prompt is deliberately short.
- Switching `DEFAULT_STRATEGY` away from `baseline` because the reasoning-budget paper says a short
  budget wins. Those numbers are from an instruct model, Qwen3.5 is reasoning-trained, and this app
  has already found that removing thinking hurts. Run the harness first; that is what it is for.

## Baseline: this is a 0.8B model

Intermittent tool skipping is the expected behaviour, not a regression. The hand-gathered figures
in the README — the calculator called five times in ten for `98765 * 4321`, a previous-turn fact
recalled eight times in ten — predate the eval harness and are the bar a change has to beat. Only
chase a failure that is deterministic or clearly below that.

## How to investigate

1. **Capture the raw stream.** The parsers are pure functions over the model's raw text; everything
   downstream is reproducible from it. `runAgent` accumulates it in `raw` inside the `onChunk`
   callback — log it there, or read it off a failing round.
2. **Turn the capture into a test.** Paste the raw text into `src/agent/parse.test.ts` or
   `src/agent/loop.test.ts` and run `pnpm test`. Every parser quirk above is a one-line regression
   test, and that is the cheapest place to fix parsing.
3. **Check the prompt, not the model.** `node tools/verify-model.mjs` takes about a second and
   asserts that the weights are still fetchable, that the tool name, its parameters, the
   `<tool_call>` marker and the chat roles all reach the prompt, and that the reasoning budget's two
   preconditions hold. Run it after any change to how tools are passed to the pipeline.
4. **Do not try to generate in Node.** There is no way to. The model's Gated DeltaNet layers use the
   `CausalConvWithState` operator, which ONNX Runtime Web implements and the Node build does not, so
   loading the weights outside a browser fails with `is not a registered function/op`. Real
   generation happens in Chrome; see `verify-in-browser`.
5. **Measure anything behavioural.** `pnpm dev`, then <http://localhost:5173/?eval>, runs the
   scenarios in `src/eval/scenarios.ts` across every strategy and reports routing accuracy, answer
   accuracy, invented tool names and median reasoning length separately. Sampling is on, so a single
   repeat tells you nothing — raise the repeat count. Claims about tool-use rates belong here, not in
   a paragraph of reasoning.

## Do not

- Do not hand-assemble a tool-use prompt. Tool definitions are passed via the pipeline's `tools`
  option so the chat template renders them itself.
- Do not push an empty assistant message into the history. The next turn loses its context, which
  is the second reason `promoteReasoningIfEmpty` exists.
- Do not feed reasoning back to the model. `toTurns` in `src/store/chat.ts` deliberately sends only
  user-visible content.
