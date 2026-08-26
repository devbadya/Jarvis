---
name: research-question
description: Answers a question about current or verifiable facts by searching the web, opening the most promising result and citing it. Use for anything recent, anything about a named person or organisation, and anything you would otherwise be guessing at.
jarvis:
  priority: 10
  tools:
    - web_search
    - read_page
  keywords:
    - look it up
    - find out
    - search the web
    - who won
    - population of
    - how many people
    - suche im netz
    - schau nach
    - finde heraus
    - wer hat gewonnen
    - aktuelle nachrichten
    - wie viele einwohner
  triggers:
    - '\b(latest|current|recent|news|today.s)\b'
    # `who is` without an exclusion also takes *Who is that?*, which is a
    # pronoun, not a person to look up. `who won` has no such problem.
    - '\bwho (is|was|are)\s+(?!(that|this|it|these|those|they|them|there)\b)'
    - '\bwho won\b'
    # A year on its own is not a question about it: *I was born in 2024* was
    # being sent to a search engine. An interrogative has to be there too.
    - '\b(what|which|who|when|where|why|how)\b[^.?!]{0,60}\b(20[2-9]\d)\b'
    - '\b(look up|search for|find out|google)\b'
    # A figure, a date or an attribution: the three shapes where a 0.8B model
    # produces something plausible and unchecked, and the three that reached no
    # skill at all. Each excludes the version of itself that is about the user or
    # about the assistant, neither of which is on the web.
    - '\bhow many\b(?!\s+(?:tools?|memor))(?!.{0,20}\b(?:do|did|have) (?:i|we)\b)'
    - '\bhow (old|tall|high|long|deep|heavy|big|far|fast) (is|was|are|were)\b(?!\s+(?:you|i|we|my)\b)'
    - '\bwhen (was|were|did|is|will)\b(?!\s+(?:my|i|we|you)\b)'
    - '\bwho (wrote|invented|founded|discovered|created|directed|built|painted|composed|owns)\b'
    # German. `wie viele` in front of a unit belongs to `convert-units`, which
    # outranks this skill, so what is left here is a count of something real.
    - '\bwie viele?\b(?!\s+(?:uhr|erinnerung))(?!.{0,20}\bhabe ich\b)'
    - '\bwie (alt|hoch|gro(ß|ss)|lang|schwer|tief|weit|schnell) (ist|war|sind|waren)\b(?!\s+(?:du|sie|ich|wir|mein)\b)'
    - '\bwann (wurde|war|ist|sind|hat|kommt)\b(?!\s+(?:mein|ich|wir|du)\b)'
    - '\bwer hat\s+(?:das\s+|die\s+|den\s+)?\S+\s*(geschrieben|erfunden|gegründet|gebaut|entdeckt|komponiert|gemalt)\b'
    # A price is looked up, never worked out. `arithmetic` used to take these on
    # the strength of the words `how much is` alone.
    - '\bhow much (does|do|did) .{0,40} cost\b'
    - '\bhow much (is|are|was|were) (a|an|the)\b'
    - "\\bwhat('?s| is| are) (happening|going on)\\b"
    # German. The English shapes reach none of it, and *Wer ist Elon Musk?* is
    # the commonest question this skill exists for.
    - '\bwer (ist|war|sind|waren)\s+(?!(das|dies|es|los|sie|ihn|ihm|ihr|ihnen)\b)'
    - '\bwer hat gewonnen\b'
    - '\b(was|wie viel) kostet\b'
    # `los` on its own is a greeting — *Was ist los?* — so it only fires when
    # something follows, the way *Was ist los in Frankreich?* does.
    - '\bwas (ist|passiert) (gerade|heute|aktuell)\b'
    - '\bwas ist los\b(?!\s*\??\s*$)'
  exemplars:
    - user: Who is the chief executive of Fictional Airways?
      steps:
        - tool: web_search
          arguments:
            query: Fictional Airways chief executive
          result: |
            1. Leadership — Fictional Airways
               https://fictionalairways.example/leadership
               Ama Osei has led Fictional Airways as chief executive since 2023.
      answer: |
        Ama Osei, chief executive since 2023.

        Source: https://fictionalairways.example/leadership
---

Search first, then answer from the results. Open a result with `read_page` only when the snippet is not enough. Always end with the source URL.
