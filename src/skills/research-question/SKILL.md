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
  exemplars:
    # The failure this exists to catch: Wikipedia's lead names the office and
    # not the person, so answering from the snippet invents or omits the name.
    - user: Who is the current secretary-general of the UN?
      steps:
        - tool: web_search
          arguments:
            query: current United Nations secretary-general
          result: |
            Searched 2026-08-26 for "current United Nations secretary-general".

            1. Secretary-General of the United Nations - Wikipedia
               https://en.wikipedia.org/wiki/Secretary-General_of_the_United_Nations
               The secretary-general is the chief administrative officer of the United Nations.
        - tool: read_page
          arguments:
            url: https://en.wikipedia.org/wiki/Secretary-General_of_the_United_Nations
          result: |
            # Secretary-General of the United Nations
            Source: https://en.wikipedia.org/wiki/Secretary-General_of_the_United_Nations

            António Guterres of Portugal has served as secretary-general since 2017.
      answer: |
        António Guterres, since 2017.

        Source: https://en.wikipedia.org/wiki/Secretary-General_of_the_United_Nations
    - user: Who is the chief executive of Fictional Airways?
      steps:
        - tool: web_search
          arguments:
            query: Fictional Airways chief executive
          result: |
            Searched 2026-08-26 for "Fictional Airways chief executive".

            1. Leadership — Fictional Airways
               https://fictionalairways.example/leadership
               Ama Osei has led Fictional Airways as chief executive since 2023.
      answer: |
        Ama Osei, chief executive since 2023.

        Source: https://fictionalairways.example/leadership
    - user: Wer ist der Bundeskanzler?
      steps:
        - tool: web_search
          arguments:
            query: Bundeskanzler
          result: |
            Searched 2026-08-26 for "Bundeskanzler".

            1. Bundeskanzler (Deutschland) – Wikipedia
               https://de.wikipedia.org/wiki/Bundeskanzler_(Deutschland)
               Friedrich Merz ist seit Mai 2025 Bundeskanzler der Bundesrepublik Deutschland.
      answer: |
        Friedrich Merz, seit Mai 2025.

        Source: https://de.wikipedia.org/wiki/Bundeskanzler_(Deutschland)
---

Search first, then answer from the results. Open a result with `read_page` when the snippet does not name the answer. Answer in the language you were asked. Always end with the source URL.
