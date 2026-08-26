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
    - suche im netz
    - schau nach
    - finde heraus
    - wer hat gewonnen
    - aktuelle nachrichten
  triggers:
    - '\b(latest|current|recent|news|today.s)\b'
    # `who is` without an exclusion also takes *Who is that?*, which is a
    # pronoun, not a person to look up. `who won` has no such problem.
    - '\bwho (is|was|are)\s+(?!(that|this|it|these|those|they|them|there)\b)'
    - '\bwho won\b'
    # Authorship and invention are looked up, and none of them is *who is*:
    # *Who wrote Dune?* reached no skill at all.
    - '\bwho (wrote|invented|founded|discovered|created|directed|composed|painted|designed|built)\b'
    - '\bwer hat\b.{0,40}\b(geschrieben|erfunden|gegr(ü|ue)ndet|entdeckt|komponiert|gebaut|entwickelt)\b'
    # A figure nobody carries in their head, and one a small model will otherwise
    # invent to three significant figures.
    - '\b(population of|einwohnerzahl|wie viele einwohner)\b'
    # A year on its own is not a question about it: *I was born in 2024* was
    # being sent to a search engine. An interrogative has to be there too.
    - '\b(what|which|who|when|where|why|how)\b[^.?!]{0,60}\b(20[2-9]\d)\b'
    - '\b(look up|search for|find out|google)\b'
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
    # *Aktueller Bundeskanzler* is a whole question with no interrogative in it.
    # Kept to two words and anchored, so it stays a fragment naming a subject,
    # and the exclusions are the subjects another skill owns — the clock and the
    # thermometer must not be answered with a search.
    - '^\s*aktuelle[rs]?\s+(?!(uhrzeit|zeit|datum|temperatur|wetter|jahr|tag|woche|monat)\b)[a-zäöüß]{3,}\s*\??\s*$'
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
