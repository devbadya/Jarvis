---
name: research-question
description: Answers a question about current or verifiable facts by researching it across several independent sources and citing them. Use for anything recent, anything about a named person or organisation, informal fact-asks about a person (wife, age, married) even without a question mark, and anything you would otherwise be guessing at.
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
    - user: Who is the current secretary-general of the UN?
      steps:
        - tool: research
          arguments:
            query: current United Nations secretary-general
          result: |
            Answer: António Guterres.

            Researched 2026-08-26 for "current United Nations secretary-general" across 2 sources, all read in full.

            1. António Guterres - Wikipedia — https://en.wikipedia.org/wiki/António_Guterres
               "António Guterres has served as secretary-general of the United Nations since 2017."
      answer: |
        António Guterres, since 2017.

        Source: https://en.wikipedia.org/wiki/António_Guterres
    - user: Wer ist der russische Präsident?
      steps:
        - tool: research
          arguments:
            query: russische Präsident
          result: |
            Answer: Wladimir Putin.

            Researched 2026-09-10 for "russische Präsident" across 1 source, all read in full.

            1. Präsident Russlands — https://de.wikipedia.org/wiki/Präsident_Russlands
               "Amtsträger ist seit 2012 Wladimir Putin."
      answer: |
        Wladimir Putin, seit 2012.

        Source: https://de.wikipedia.org/wiki/Präsident_Russlands
    - user: Wer ist der Bundeskanzler?
      steps:
        - tool: research
          arguments:
            query: Bundeskanzler
          result: |
            Answer: Friedrich Merz.

            Researched 2026-08-26 for "Bundeskanzler" across 1 source, all read in full.

            1. Bundeskanzler — https://de.wikipedia.org/wiki/Bundeskanzler_(Deutschland)
               "Friedrich Merz ist seit dem 6. Mai 2025 Bundeskanzler."
      answer: |
        Friedrich Merz, seit Mai 2025.

        Source: https://de.wikipedia.org/wiki/Bundeskanzler_(Deutschland)
    - user: What's the population of Tokyo?
      steps:
        - tool: research
          arguments:
            query: population of Tokyo
          result: |
            Answer: 13.96 million people.

            Researched 2026-09-09 for "population of Tokyo" across 1 source, all read in full.

            1. Tokyo - Wikipedia — https://en.wikipedia.org/wiki/Tokyo
               "Tokyo has a population of 13.96 million people."
      answer: |
        About 14 million.

        Source: https://en.wikipedia.org/wiki/Tokyo
    - user: und der von Frankreich?
      steps:
        - tool: research
          arguments:
            query: Präsident Frankreich
          result: |
            Answer: Emmanuel Macron.

            Researched 2026-09-10 for "Präsident Frankreich" across 1 source, all read in full.

            1. Macron — https://de.wikipedia.org/wiki/Emmanuel_Macron
               "Emmanuel Macron ist seit 2017 Staatspräsident Frankreichs."
      answer: |
        Emmanuel Macron.

        Source: https://de.wikipedia.org/wiki/Emmanuel_Macron
    - user: nein in Russland
      steps:
        - tool: research
          arguments:
            query: Präsident Russland
          result: |
            Answer: Wladimir Putin.

            Researched 2026-09-10 for "Präsident Russland" across 1 source, all read in full.

            1. Präsident Russlands — https://de.wikipedia.org/wiki/Präsident_Russlands
               "Amtsträger ist seit 2012 Wladimir Putin."
      answer: |
        Wladimir Putin.

        Source: https://de.wikipedia.org/wiki/Präsident_Russlands
---

Call `research` once. Copy the first line, in the language you were asked. Cite the source. Do not guess.

A follow-up or a correction (_und der von Frankreich?_, _nein in Russland_) keeps the last office and adds the new place.
