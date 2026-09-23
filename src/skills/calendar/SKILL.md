---
name: calendar
description: Adds, lists, moves and cancels events on the calendar kept in this browser. Use when the user asks what is scheduled, or wants an appointment booked, changed or dropped.
jarvis:
  priority: 32
  tools:
    - calendar
  keywords:
    - my calendar
    - in my calendar
    - on my calendar
    - mein kalender
    - im kalender
    - in den kalender
    - termin eintragen
    - termin absagen
    - termin verschieben
    - was habe ich morgen vor
  triggers:
    - '\b(add|put|schedule|book|cancel|move|reschedule).{0,60}\b(calendar|appointment|meeting|call)\b'
    - '\b(on|to|in|from) my calendar\b'
    - "\\bwhat('?s| is) on my (calendar|schedule)\\b"
    - '\b(am i free|do i have (anything|plans|a meeting))\b'
    # A clock after *to* is a reschedule. *move the chair to the window* has no digit.
    - '\b(move|reschedule).{0,40}\bto\s+\d'
    - '\b(in den|im|aus dem|mein|meinen|meinem) kalender\b'
    - '^\s*(bitte\s+)?trag(e)?\b.{0,80}\b(termin|kalender|uhr)\b'
    - '\b(verschieb\w*|absag\w*|loesch\w*|lösch\w*|sag\w*).{0,40}\btermin\b'
    - '\b(habe|hab) ich (heute|morgen).{0,30}(termin|vor)\b'
    - '\bwas steht (heute|morgen|in meinem kalender)\b'
  exemplars:
    - user: Put a dentist appointment on Friday at 15:00 in my calendar.
      steps:
        - tool: calendar
          arguments:
            command: add
            title: Dentist
            when: Friday 15:00
          result: Added [a1b2c3] Fri 25 Sep 2026, 15:00 — Dentist
      answer: Booked. Dentist, Friday at 15:00.
    - user: What's on my calendar?
      steps:
        - tool: calendar
          arguments:
            command: list
          result: |
            1 event:
            [a1b2c3] Fri 25 Sep 2026, 15:00 — Dentist
      answer: You have the dentist on Friday at 15:00.
    - user: Move the dentist to 16:00.
      steps:
        - tool: calendar
          arguments:
            command: update
            query: dentist
            when: '16:00'
          result: Updated [a1b2c3] Fri 25 Sep 2026, 16:00 — Dentist
      answer: Moved. The dentist is now at 16:00.
    - user: Cancel the dentist appointment.
      steps:
        - tool: calendar
          arguments:
            command: delete
            query: dentist
          result: Deleted [a1b2c3] Fri 25 Sep 2026, 16:00 — Dentist
      answer: Cancelled. The dentist is off the calendar.
---

Call `calendar` for the user's schedule. Do not say an event was added, moved or cancelled unless the tool said so.

Pass `when` in their words (`Friday 15:00`, `morgen 15 Uhr`). `list` before `update` or `delete` when more than one event could match, then repeat with the id.
