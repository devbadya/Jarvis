---
name: world-clock
description: Reads the live clock in a named city, country or timezone. Use when the user asks what the time or the date is somewhere other than here.
jarvis:
  priority: 26
  tools:
    - current_time
  # Phrases that name another clock. `time in` as a trigger would also catch
  # *once upon a time in…*; as a keyword it still needs those two words in a
  # row, which a date question about a place does have and a story does not.
  keywords:
    - current time in
    - local time in
    - uhrzeit in
    - datum in
    - world clock
    - weltuhr
    - timezone in
    - time zone
    - zeitzone
  triggers:
    - "\\bwhat('?s| is) the (date|time|day) in \\S"
    - '\bwhat (date|time|day) is it in \S'
    - '\b(current|local) time in \S'
    - '\bwie sp(ä|ae)t ist es in \S'
    - '\bwie ?viel uhr ist es in \S'
    - '\buhrzeit in \S'
    - '\bwelche[sn]? (datum|uhrzeit)\b.{0,24}\bin \S'
    - '\b(world clock|weltuhr)\b'
  exemplars:
    - user: What time is it in Tokyo?
      steps:
        - tool: current_time
          arguments:
            place: Tokyo
          result: 'Tokyo, Japan — Thu 27 Aug 2026, 06:51:00 JST (Asia/Tokyo) — instant 2026-08-26T21:51:00.000Z'
      answer: In Tokyo it is Thursday 27 August 2026, 06:51 JST.
---

You cannot know the time somewhere else. Call `current_time` with the place as written — `Berlin`, `Germany`, never the question around it. Answer from that line: quote the clock, the date and the zone as given. Call again for a new reading; never reuse an earlier one or convert it yourself.
