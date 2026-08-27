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
    # `ist` is optional: *wie viel uhr es in deutschland ist* puts it at the end.
    - '\bwie ?viel uhr\b.{0,20}\bin \S'
    - '\buhrzeit in \S'
    - '\bwelche[sn]? (datum|uhrzeit)\b.{0,24}\bin \S'
    - '\b(world clock|weltuhr)\b'
  exemplars:
    - user: What time is it in Tokyo?
      steps:
        - tool: current_time
          arguments:
            place: Tokyo
          result: 'Tokyo, Japan — 06:51 JST (UTC+9, Asia/Tokyo), Thu 27 Aug 2026'
      answer: In Tokyo it is 06:51 JST on Thursday 27 August 2026.
    - user: wie viel uhr es in deutschland ist
      steps:
        - tool: current_time
          arguments:
            place: Deutschland
          result: 'Germany — 22:40 CEST (UTC+2, Europe/Berlin), Thu 27 Aug 2026'
      answer: In Deutschland ist es 22:40 Uhr CEST.
---

You cannot know the time somewhere else. Call `current_time` with the place as written — `Berlin`, `Germany`, `Deutschland`, never the question around it. The first HH:MM is the local wall clock; quote that hour and the zone. Call again for a new reading. Never convert, reuse an earlier one, or treat a UTC offset as the time.
