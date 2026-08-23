---
name: current-date
description: Grounds any question about today, now, the current year or the day of the week in the clock rather than in the training data. Use whenever the answer depends on what the date is at this moment.
jarvis:
  priority: 25
  tools:
    - current_time
  triggers:
    - '\b(today|tonight|right now|at the moment|currently)\b'
    - "\\bwhat('s| is)? the (date|time|day)\\b"
    - '\bwhat year\b'
    - '\b(this|current) (year|month|week)\b'
    - '\bday of the week\b'
  exemplars:
    - user: What year is it?
      steps:
        - tool: current_time
          arguments: {}
          result: '2026-08-23T06:51:00.000Z (local: 23/08/2026, 10:51:00, timezone: Asia/Dubai)'
      answer: It is 2026.
---

The clock is the only thing that knows the date; your training data does not. Call `current_time`, then answer from what it returned.
