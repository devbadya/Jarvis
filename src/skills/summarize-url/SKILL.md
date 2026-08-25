---
name: summarize-url
description: Reads a page the user has linked to and summarises it. Use when the message contains a URL, or asks what a page says.
jarvis:
  priority: 20
  tools:
    - read_page
  # Written as people write them: a keyword only matches contiguously, so
  # "fasse zusammen" would miss "fasse mir die Seite zusammen".
  keywords:
    - summarise
    - summarize
    - summary
    - read this page
    - zusammenfassen
    - zusammenfassung
    - seite zusammen
    - was steht auf der seite
  triggers:
    - 'https?://\S+'
    - '\b(summari[sz]e|tl;?dr|what does .{0,20}(page|article|link) say)\b'
  exemplars:
    - user: What does https://example.com/pricing say?
      steps:
        - tool: read_page
          arguments:
            url: https://example.com/pricing
          result: |
            # Pricing — Example
            Source: https://example.com/pricing

            Three plans. Free covers one project. Team is $12 per user per month and adds
            shared workspaces. Enterprise is priced on request and adds SSO.
      answer: |
        Three plans: Free for a single project, Team at $12 per user per month with shared
        workspaces, and Enterprise on request with SSO.

        Source: https://example.com/pricing
    # No steps, which is the lesson: *fasse die Seite zusammen* names no page, and
    # `read_page` cannot be called without an address. Asking costs one turn;
    # inventing a URL costs the answer.
    - user: Fasse mir die Seite zusammen
      steps: []
      answer: Welche Seite meinst du? Schick mir den Link, dann lese ich sie.
---

Call `read_page` on the URL, then summarise only what came back. Finish with the source URL.

If no URL is in the conversation, ask which page. Never guess an address, and never summarise a page you have not read.
