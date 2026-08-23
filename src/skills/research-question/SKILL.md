---
name: research-question
description: Answers a question about current or verifiable facts by searching the web, opening the most promising result and citing it. Use for anything recent, anything about a named person or organisation, and anything you would otherwise be guessing at.
jarvis:
  priority: 10
  tools:
    - web_search
    - read_page
  triggers:
    - '\b(latest|current|recent|news|today.s)\b'
    - '\bwho (is|was|are|won)\b'
    - '\b(20[2-9]\d)\b'
    - '\b(look up|search for|find out|google)\b'
    - '\bhow much does .{0,40} cost\b'
  exemplars:
    - user: Who is the chief executive of Fictional Airways?
      steps:
        - tool: web_search
          arguments:
            query: Fictional Airways chief executive
          result: |
            1. Leadership — Fictional Airways
               https://fictionalairways.example/leadership
               Ama Osei has led Fictional Airways as chief executive since 2023.
      answer: |
        Ama Osei, chief executive since 2023.

        Source: https://fictionalairways.example/leadership
---

Search first, then answer from the results. Open a result with `read_page` only when the snippet is not enough. Always end with the source URL.
