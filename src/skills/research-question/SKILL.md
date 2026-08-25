---
name: research-question
description: Answers a question about current or verifiable facts by researching it across several web sources at once and citing the ones it used. Use for anything recent, anything about a named person or organisation, and anything you would otherwise be guessing at.
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
    - user: Who is the chief executive of Fictional Airways?
      steps:
        - tool: research
          arguments:
            question: Who is the chief executive of Fictional Airways?
          result: |
            Researched "Who is the chief executive of Fictional Airways?" across 3 sources, all read in full.

            1. Leadership — https://fictionalairways.example/leadership
               "Ama Osei has led Fictional Airways as chief executive since 2023."
            2. Fictional Airways names new chief — https://airtimes.example/osei-appointed
               "The board appointed Ama Osei in March 2023, succeeding Piet Hendriks."
            3. Fictional Airways — https://encyclopedia.example/fictional-airways
               "The airline was founded in 1974 and is based in Accra."
      answer: |
        Ama Osei. She was appointed in March 2023, succeeding Piet Hendriks.

        Sources: https://fictionalairways.example/leadership https://airtimes.example/osei-appointed
---

Call `research` once, with the question as it was asked. It searches and reads several sources for you, so do not search again afterwards. Answer from the quoted passages only, prefer what more than one source says, and end with a `Sources:` line listing every URL you used.
