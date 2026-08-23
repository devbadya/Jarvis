---
name: write-model-skill
description: Author or change a runtime skill under src/skills/ - the SKILL.md files Jarvis's own 0.8B model loads to handle a kind of request better. Use when asked to improve how the model answers something, when editing src/skills/, or when a skill fires on the wrong messages. Not the same thing as .cursor/skills/, which is for coding agents working on this repository.
license: MIT
---

# Writing a skill for the model

## First, which kind of skill

This repository has two, and they are unrelated:

- `.cursor/skills/` — for coding agents working on the repository. That is where this file lives.
- `src/skills/` — shipped to Jarvis's own model at runtime, to make a 0.8B model handle a class of
  request properly. That is what this skill is about.

If a request to "add a skill" is ambiguous, resolve it before writing anything.

## The shape

A folder under `src/skills/` holding a `SKILL.md`. The frontmatter is the Agent Skills standard —
`name` and a `description` saying what and when — so a skill here could be published unchanged.
Everything specific to this app sits under a `jarvis:` mapping, and the body is guidance appended to
the system prompt.

```yaml
---
name: arithmetic
description: Computes an exact answer with the calculator whenever the user asks for one.
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

## Non-negotiables

- **The body is capped at 600 characters** (`MAX_GUIDANCE_CHARS`) and `parseSkill` throws over it.
  This is not a style preference. For a model this size few-shot exemplars are worth about +21.5
  points on tool use where prose documentation is worth about +5, and this app has already measured
  a longer system prompt dropping tool use to 1 in 6. If the guidance is growing, the content
  belongs in an exemplar.
- **Exemplars carry the real markup.** Each step is expanded into an assistant turn rendered by
  `renderToolCall` and a `tool` turn holding the result, placed ahead of the user's history. A test
  in `load.test.ts` round-trips every shipped exemplar back through `parseModelOutput`, so a skill
  cannot teach a shape the agent loop would then fail to parse.
- **One exemplar per behaviour, not per step.** A workflow like "search, then open the best result"
  needs both steps in a single exemplar; split across two the model has no reason to connect them.
- **Triggers are regex strings, compiled case-insensitively** by `compileTriggers`, and an invalid
  pattern throws at load. Match the _shape_ of a request — `^\s*(what|who)('s| is| are)\s+[^\s?]{1,24}\s*\??\s*$`
  — rather than keywords the user may not use. Matching never asks the model: routing through it
  spends exactly the capacity the skill exists to conserve.
- **`tools` narrows what the model sees**, because accuracy falls as the visible tool list grows. An
  empty or absent list means no restriction. Names must match real tools or they are dropped
  silently.
- **`priority` breaks ties.** Skills sort by priority descending, then by name, and the first
  trigger match wins. Give a narrow skill a higher priority than a broad one it overlaps with.
- **`strategy`, if set, must name a key in `STRATEGIES`.** It overrides the reasoning budget for
  that skill only.
- **`call` and `result` at the top of an exemplar are rejected on purpose.** They are the old
  single-step shape; accepting them would silently drop the tool call. Use `steps`.

## Steps

1. Create `src/skills/<name>/SKILL.md`. The folder name and the `name` field must agree.
2. Write the triggers first, then the exemplars, then the guidance — in that order, because the
   guidance is what should end up smallest.
3. Add trigger cases to `src/skills/activate.test.ts`: the messages that must fire it, and at least
   one near miss that must not.
4. Add an eval scenario in `src/eval/scenarios.ts`. Use `acceptCall` when the arguments are the
   point, not just which tool was called — `keepsTermIntact` exists because the model searched for
   `1 inch to measurement in centimeters` when asked about `1inch`, which is a correct tool call
   with an answer-destroying query.
5. `pnpm check`, then measure at <http://localhost:5173/?eval>. Sampling is on, so compare over
   several repeats.

## Limits worth knowing

Skills are inlined at build time by `import.meta.glob`, not fetched, so they survive going offline
without service-worker precaching. Regex routing stops scaling somewhere around twenty skills —
which is past the point where a 0.8B model's skill selection would fall apart anyway, so treat that
as the ceiling on the library rather than a problem to engineer around.
