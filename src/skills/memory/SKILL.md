---
name: memory
description: Saves, reads back and removes the things the user asks to be remembered between conversations. Use when the message asks you to remember or forget something, or asks what you already know about them.
jarvis:
  priority: 35
  tools:
    - memory
  keywords:
    # Phrases, never the bare verb: `remember` on its own also matches "I can't
    # remember the capital of Peru", which asks for nothing to be stored.
    - remember that i
    - please remember
    - forget that i
    - know about me
    - your memory
    - merk dir
    - vergiss was
    - vergiss dass
    - erinnere dich
    - über mich
  triggers:
    - '^\s*(please\s+)?(remember|memorise|memorize)\b'
    - '\b(remember|note|keep in mind) that (i|my|we|our)\b'
    - '^\s*(please\s+)?forget\b'
    - '\bforget (that|about|what|my|everything|all)\b'
    - '\bstop remembering\b'
    - '\bwhat do you (know|remember) about (me|my)\b'
    - '\b(your|my) (memory|memories)\b'
  exemplars:
    - user: Remember that I prefer metric units.
      steps:
        - tool: memory
          arguments:
            command: save
            text: Prefers metric units
            kind: preference
          result: Saved [a1b2c3] (preference) Prefers metric units
      answer: Noted — I'll stick to metric from now on.
    - user: What do you know about me?
      steps:
        - tool: memory
          arguments:
            command: list
          result: |
            2 memories:
            [a1b2c3] (preference) Prefers metric units
            [d4e5f6] (fact) Lives in Lisbon
      answer: You prefer metric units, and you live in Lisbon.
    - user: Forget that I live in Lisbon.
      steps:
        - tool: memory
          arguments:
            command: delete
            query: lives in Lisbon
          result: Deleted [d4e5f6] (fact) Lives in Lisbon
      answer: Done — I've forgotten that.
---

Saving is the tool's job, not yours: never say you will remember something without calling `memory`.

`save` a new one as a short sentence about the user, `list` to read them back, and `delete` with a `query` naming the one they have disowned. Use `clear` only when they ask for everything to go.
