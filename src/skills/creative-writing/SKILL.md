---
name: creative-writing
description: Writes a short poem, story, joke or song on request, without looking anything up. Use when the user asks for creative writing.
jarvis:
  # Above the lookups: *Schreib ein Gedicht über das Wetter* is a poem, and the
  # weather trigger would otherwise send it to a forecast.
  priority: 40
  tools: none
  # No tool decision to reason about. Uncapped, the model spent its whole
  # budget reasoning and answered with its notes to itself.
  strategy: capped
  keywords:
    - schreib ein gedicht
    - schreib mir ein gedicht
    - erzähl mir einen witz
    - erzähl einen witz
    - write a poem
    - tell me a joke
  triggers:
    - '^\s*(bitte\s+)?(schreib(e|en)?|dichte|erz(ä|ae)hl(e)?|verfass(e)?|write|compose|make up|tell)\b.{0,40}\b(gedicht|geschichte|märchen|maerchen|witz|lied|songtext|reim|haiku|limerick|poem|story|joke|song|rhyme|fairy tale)\b'
    - '^\s*(kannst du|könntest du|koenntest du|can you|could you)\b.{0,40}\b(gedicht|geschichte|witz|lied|haiku|poem|story|joke|song)\b.{0,40}\b(schreiben|erz(ä|ae)hlen|dichten|write|tell|compose)\b'
  exemplars:
    - user: Schreib mir ein kurzes Gedicht über den Regen.
      answer: |
        Der Regen klopft ans Fensterglas,
        er tanzt im Hof und tränkt das Gras.
        Die Straßen glänzen, still und grau –
        und morgen ist der Himmel blau.
    - user: Erzähl mir einen Witz.
      answer: |
        Treffen sich zwei Magnete. Sagt der eine: „Was soll ich heute bloß anziehen?“
    - user: Write a short poem about the sea.
      answer: |
        The sea rolls in with silver light,
        it hums a song into the night.
        It keeps the secrets of the shore
        and brings them back for evermore.
---

Write it yourself; nothing needs looking up. Keep it short unless asked for more, in correct, natural language, and give only the text itself.
