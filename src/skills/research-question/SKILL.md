---
name: research-question
description: Answers a question about current or verifiable facts by researching it across several independent sources and citing them. Use for anything recent, anything about a named person or organisation, and anything you would otherwise be guessing at.
jarvis:
  priority: 10
  tools:
    - research
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
    - user: Who is the current secretary-general of the UN?
      steps:
        - tool: research
          arguments:
            query: current United Nations secretary-general
          result: |
            Researched 2026-08-26 for "current United Nations secretary-general" across 3 sources, all read in full.

            1. António Guterres - Wikipedia — https://en.wikipedia.org/wiki/António_Guterres
               "António Guterres has served as secretary-general of the United Nations since 2017."
            2. Secretary-General | United Nations — https://www.un.org/sg/en
               "António Guterres is the ninth Secretary-General of the United Nations."
      answer: |
        António Guterres, since 2017.

        Source: https://en.wikipedia.org/wiki/António_Guterres https://www.un.org/sg/en
    - user: Wer ist der Bundeskanzler?
      steps:
        - tool: research
          arguments:
            query: Bundeskanzler
          result: |
            Researched 2026-08-26 for "Bundeskanzler" across 3 sources, all read in full.

            1. Bundeskanzler (Deutschland) – Wikipedia — https://de.wikipedia.org/wiki/Bundeskanzler_(Deutschland)
               "Friedrich Merz ist seit dem 6. Mai 2025 Bundeskanzler der Bundesrepublik Deutschland."
            2. Bundeskanzler.de — https://www.bundeskanzler.de
               "Friedrich Merz führt die Bundesregierung."
      answer: |
        Friedrich Merz, seit Mai 2025.

        Source: https://de.wikipedia.org/wiki/Bundeskanzler_(Deutschland) https://www.bundeskanzler.de
---

Call `research` once. Answer from the quoted passages, in the language you were asked. Cite more than one source URL when several came back.
