---
name: summarize-url
description: Reads a page the user has linked to and summarises it. Use when the message contains a URL, or asks what a page says.
jarvis:
  priority: 20
  tools:
    - read_page
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
---

Call `read_page` on the URL, then summarise only what came back. Finish with the source URL.
