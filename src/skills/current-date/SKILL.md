---
name: current-date
description: Grounds a question about the date, the time, the year or the day of the week in the clock rather than in the training data. Use when the user is asking what the date or the time is now.
jarvis:
  priority: 25
  tools:
    - current_time
  # `heute` and a bare `today` used to be enough to land here, and they matched
  # far more than a date question: *Was machst du heute?* and *What's today's
  # news?* both reached the clock. What is left names the date outright.
  keywords:
    - date today
    - what day is it
    - current year
    - time right now
    - welches datum
    - welcher tag
    - welches jahr
    - uhrzeit
    - wochentag
  triggers:
    # Anchored at the end, so *what is the time in Tokyo* is left to world-clock.
    # Answering another city's question with the user's own clock is wrong rather
    # than approximate; the follow-up exemplar is what a carry-over like *and in
    # Germany?* needs, because that fragment matches no trigger of its own.
    - "\\bwhat('?s| is) (the )?(date|time|day|month|year|week)( (today|now|right now|at the moment))?\\s*\\??\\s*$"
    - '\bwhat (date|time|day|month|year|week) is (it|today|this)\b(?!\s+in\b)'
    - "\\b(current|today'?s) (date|time|year|month|week|day)\\b"
    - '\bday of the week\b'
    - '\bis (it|today) (mon|tues|wednes|thurs|fri|satur|sun)day\b'
    # German, and for a different reason than the weather's compounds: a keyword
    # cannot say "unless a city follows", and those questions belong to world-clock.
    - '\bwie sp(ä|ae)t ist es\b(?!\s+in\b)'
    - '\bwie viel uhr ist es\b(?!\s+in\b)'
    - '\bist (heute|es) (montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b'
  exemplars:
    - user: What year is it?
      steps:
        - tool: current_time
          arguments: {}
          result: '10:51 GST (UTC+4, Asia/Dubai), Sun 23 Aug 2026'
      answer: It is 2026.
    - user: and in Germany?
      steps:
        - tool: current_time
          arguments:
            place: Germany
          result: 'Germany — 23:51 CEST (UTC+2, Europe/Berlin), Wed 26 Aug 2026'
      answer: In Germany it is 23:51 CEST on Wednesday 26 August 2026.
---

The clock is the only thing that knows the date; your training data does not. Call `current_time`, then answer from the first HH:MM it returned — that is the local wall clock, not a UTC hour.

If they named a place, pass it as `place` and answer from that reading. Call again rather than reuse an earlier one.
