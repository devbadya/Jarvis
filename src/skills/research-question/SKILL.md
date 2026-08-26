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
    - biography of
    - biografie von
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
    # A life is looked up, never recalled. Only *wer war X* used to route, so
    # *wie alt wurde X*, *wann starb X* and *erzähl mir über X* reached no skill
    # at all and were answered out of the model's memory — which is where an
    # invented age comes from. Routed here, the turn searches first.
    - '\bhow old (is|was|were)\b'
    - '\bwie alt (ist|war|wurde|sind|waren)\b'
    - '\bwhen (did|was)\b[^?]{0,40}\b(die|died|born)\b'
    - '\bwann (starb|gestorben)\b'
    - '\bwann (wurde|ist)\b[^?]{0,40}\b(geboren|gestorben)\b'
    - '\btell me about\b'
    # *Erzähl mir einen Witz* is not a lookup, so this needs the preposition that
    # makes the rest of the sentence a subject.
    - '\berz(ä|ae)hl(e|s)?\s+(mir|uns)\s+(etwas\s+)?(über|ueber|von)\b'
    # Second person excluded: *was haben wir gemacht* is about the conversation.
    - '\bwas (hat|haben)\s+(?!wir\b|du\b|ihr\b)[^?]{0,40}\b(gemacht|getan|erreicht)\b'
  exemplars:
    - user: Who is the chief executive of Fictional Airways?
      steps:
        - tool: web_search
          arguments:
            query: Fictional Airways chief executive
          result: |
            Searched 2026-08-26 for "Fictional Airways chief executive" — 3 sources
            1. Leadership (fictionalairways.example)
               https://fictionalairways.example/leadership
               Ama Osei has led Fictional Airways as chief executive since 2023.
            2. Fictional Airways names a new chief (dailywire.example)
               https://dailywire.example/fictional-airways-ceo
               The airline confirmed Ama Osei as chief executive in 2023.
            3. Fictional Airways profile (aviationweek.example)
               https://aviationweek.example/fictional-airways
               Chief executive: Jordan Hale, in post since 2021.
            Agreed across sources: "Ama Osei" in 2/3; "2023" in 2/3
            Sources disagree: "2023" (dailywire.example, fictionalairways.example) vs "2021" (aviationweek.example)
      answer: |
        Ama Osei, chief executive since 2023. Two of the three sources say so; aviationweek.example
        still lists Jordan Hale from 2021 and looks out of date.

        Source: https://fictionalairways.example/leadership https://dailywire.example/fictional-airways-ceo
    # German, and the point is the query rather than the answer: searching with
    # the words the question used is what brings German pages back, and the
    # answer then follows its sources into the right language. Translating the
    # question first is how a German question ends up answered from English
    # pages. The misspelling is here for the same reason — the query is passed
    # through untouched, and the correcting is left to the sources.
    - user: wer ist eln musk
      steps:
        - tool: web_search
          arguments:
            query: wer ist eln musk
          result: |
            Searched 2026-08-26 for "wer ist eln musk" — 2 sources
            1. Elon Musk (de.example)
               https://de.example/elon-musk
               Elon Musk ist ein Unternehmer und führt Tesla und SpaceX.
            2. Elon Musk im Profil (nachrichten.example)
               https://nachrichten.example/elon-musk
               Der Unternehmer Elon Musk leitet Tesla, SpaceX und X.
            The sources spell it "Elon" (the question wrote "eln"). Answer about that, and use their spelling.
      answer: |
        Du meinst Elon Musk. Er ist Unternehmer und führt Tesla, SpaceX und X.

        Source: https://de.example/elon-musk
---

Search once with the words the question used — never translated — then answer from the brief it returns, in the language the question was asked in. It carries several sites: give what they agree on, and say which site disagrees. Open one with `read_page` only when the brief is not enough. End with the URLs you used.
