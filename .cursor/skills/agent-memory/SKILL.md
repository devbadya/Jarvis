---
name: agent-memory
description: Change what Jarvis remembers between sessions - the IndexedDB store under src/memory/, the `memory` tool, recall injection into the system prompt, or the Memory panel. Use when editing src/memory/, src/tools/memory.ts, src/components/MemoryPanel.tsx, or the memory branches of the chat store.
license: MIT
---

# Memory

Six pieces, in dependency order:

| File                   | Owns                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `src/memory/db.ts`     | IndexedDB. Persistence only, no rules about what may be stored           |
| `src/memory/text.ts`   | Tokenising and normalising, shared by recall, matching and deduplication |
| `src/memory/manage.ts` | Every rule: dedupe, the length cap, the store cap, soft deletion         |
| `src/memory/select.ts` | Which memories a turn is owed, and how they are rendered                 |
| `src/memory/topic.ts`  | Working memory: last established place from this transcript              |
| `src/tools/memory.ts`  | The one tool the model calls, over `manage.ts`                           |

The store and the panel sit on top; nothing else reaches into `db.ts`.

`text.ts` is shared for a reason worth knowing: there were three ways of comparing memory text and the
weakest was the one behind `delete`, where raw word matching missed "Lives in Berlin" for "forget that
I live in Berlin" — on `that`, and again on the plural. `tokenize` drops filler and folds plurals and
is used by both recall and `findMemories`; `normalizeText` keeps the whole sentence and decides only
what counts as a repeat, where a false positive would silently drop what the user just said.

## Non-negotiables

- **Deleting is `deletedAt`, not removal.** `readAllRecords` returns the trash along with everything
  else, so any new reader has to filter — `loadMemory` is the one that already does. The model can
  reach delete and clear through a tool, and an unrecoverable one is a 0.8B model away from wiping
  what someone spent months telling it.
- **Recall is injected, never requested.** `composeTurns(history, activation, recall)` appends the
  rendered block to the system prompt. Do not add a "call `memory` first" instruction instead: this
  app measured a longer system prompt dropping tool use to 1 in 6, and the whole point of injecting
  is that the model spends nothing to remember.
- **`MAX_RECALL_CHARS` is a budget, not a default.** Roughly 100 tokens, competing with the skill
  guidance and the answer. Raising it is a change to the prompt and needs the harness at
  <http://localhost:5173/?eval>, not an opinion. A scenario can declare `memories`, which the runner
  puts through the real selection and into the system prompt, so the harness does see recall — but
  it builds the records in memory rather than writing them, so a sweep leaves nothing behind.
- **A skill whose tools are all missing never reaches the router**, which is what keeps the `memory`
  skill quiet once the user switches memory off. `usableSkills` in `src/skills/activate.ts` filters
  the catalogue first, which is why `SkillEntry` carries `tools`: deciding it by loading every skill
  would give back exactly what the catalogue exists to avoid. Without the filter the skill's
  exemplars teach a call to a tool that is no longer in the list, and the model spends the round
  being told there is no such thing.
- **The memory skill's keywords are phrases, never bare verbs.** `remember` on its own matches "I
  can't remember the capital of Peru", which asks for nothing to be stored — the same trap the
  catalogue's own notes describe for `temperature` and the weather skill.
- **The bin is capped by count as well as by age.** Saving and deleting can be repeated for ever
  without ever exceeding `MAX_MEMORIES`, so retention alone does not bound the database.
- **No background extraction.** Writes are explicit — the model calls the tool, or the user types in
  the panel. ChatGPT's dreaming and mem0's extractor both spend a second model call per
  conversation; here that call runs on the user's own GPU and would double the cost of a turn.
- **The conversation topic is derived, never stored.** `topic.ts` reads the last weather place off
  the transcript and injects one line, the same way recall is injected. It fires on a follow-up,
  a weather turn with no place, or an anaphor (_der Bürgermeister_, _there_). It stays off a
  fresh named subject — _Wer ist Elon Musk?_ after Frankfurt weather must not receive Frankfurt.
  Memory off still pins it: that toggle is IndexedDB, not this chat.
- **Contradictions are kept.** "Lives in Berlin" and "Lives in Lisbon" both stay; recall prefers the
  newest and the panel shows both. mem0 shipped the UPDATE/DELETE version of this and moved back to
  append-only, and deciding two sentences are the same slot needs a model this app cannot spare.
- **The tool's command aliases earn their keep.** Qwen emits `remember` and `forget`, not `save` and
  `delete`. A rejected call costs one of four tool rounds; a lookup costs nothing.
- **Changing `MemoryRecord` needs `DB_VERSION` bumped** and an upgrade path in `onupgradeneeded`.
  Users have rows on disk from the previous shape.

## Tests

jsdom has no IndexedDB, so `src/test/setup.ts` installs `fake-indexeddb/auto`. Without it every
memory test would pass against `db.ts`'s "not available" path and assert nothing. Tests share one
database per file — empty it in `beforeEach` rather than deleting the database, which blocks on open
connections.

`select.ts` is pure and gets ordinary unit tests. Anything that writes belongs in `manage.test.ts`
or `tools/memory.test.ts`, against the fake.

## Verifying it for real

`fake-indexeddb` is not IndexedDB, and jsdom is not a browser. Drive the real modules from a real
page — Chrome is enough, no GPU needed, since none of this touches the model:

```js
const { memory } = await import('/src/tools/memory.ts')
await memory.execute({ command: 'save', text: 'Prefers metric units', kind: 'preference' })
await memory.execute({ command: 'list' })
```

Then DevTools → Application → IndexedDB → `jarvis-memory` → `memories` for the rows, and reload to
prove they outlived the tab.
