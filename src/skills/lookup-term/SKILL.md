---
name: lookup-term
description: Finds out what a name or unfamiliar term refers to by searching for it verbatim and reading what comes back. Use when the user asks what or who something is and the subject is a single name, a product, a project, or a token mixing letters with digits. Not for a bare number, which is a measurement rather than a name.
jarvis:
  priority: 15
  tools:
    - web_search
    - read_page
  keywords:
    - never heard of
    - what kind of company
    - what kind of product
    - was ist das für eine firma
    - noch nie gehört
  triggers:
    # The bare-name shape, minus the words that look like a name and are not:
    # *what is that?* would otherwise be searched for verbatim.
    - "^\\s*(what|who)('?s| is| are)\\s+(?!(that|this|it|these|those|they|them|there|up|new|next|left|going|happening)\\b)[^\\s?]{1,24}\\s*\\??\\s*$"
    # A token mixing letters and digits is a name — `1inch`, `3Blue1Brown`. A bare
    # number is not: *what is 32 fahrenheit in celsius* asks for a conversion, and
    # searching that verbatim answers nothing.
    - "\\b(what|who)('?s| is| are)\\s+(?=\\S*\\d)(?=\\S*[a-z])\\S+"
    # German, which the shapes above miss completely: *Was ist Stripe?* and
    # *Was ist 1inch?* used to route nowhere at all.
    - '^\s*(was|wer)\s+ist\s+(?!(das|dies|es|los|passiert|dein|deine|mein|meine)\b)[^\s?]{1,24}\s*\??\s*$'
    - '\b(was|wer)\s+ist\s+(?=\S*\d)(?=\S*[a-z])\S+'
  exemplars:
    - user: What is 1Password?
      steps:
        - tool: web_search
          arguments:
            query: 1Password
          result: |
            Searched 2026-08-26 for "1Password" — 3 sources
            1. 1Password (1password.com)
               https://1password.com
               1Password stores passwords, passkeys and secrets in an encrypted vault.
            2. 1Password reviewed (techdesk.example)
               https://techdesk.example/1password-review
               A password manager that fills credentials in across devices.
            3. Password managers compared (safeguide.example)
               https://safeguide.example/password-managers
               1Password keeps an encrypted vault behind one passphrase.
            Agreed across sources: "1Password" in 3/3
      answer: |
        1Password is a password manager. All three sources describe the same thing: an
        encrypted vault for passwords, passkeys and secrets, filled in across devices.

        Source: https://1password.com https://techdesk.example/1password-review
    - user: What is Arc?
      steps:
        - tool: web_search
          arguments:
            query: Arc
          result: |
            Searched 2026-08-26 for "Arc" — 3 sources
            1. Arc (arc.net)
               https://arc.net
               A desktop web browser that organises tabs into spaces in a sidebar.
            2. Arc welding (metalguide.example)
               https://metalguide.example/arc-welding
               Joining metals using the heat of an electric arc.
            3. The Browser Company raises again (dailywire.example)
               https://dailywire.example/browser-company
               The Browser Company, which makes Arc, has raised a further round.
            Agreed across sources: "Arc" in 3/3
        - tool: read_page
          arguments:
            url: https://arc.net
          result: |
            # Arc
            Source: https://arc.net

            Arc is a web browser from The Browser Company. Tabs live in a left sidebar
            and are grouped into spaces rather than a horizontal strip.
      answer: |
        Arc is a web browser from The Browser Company, built around a left sidebar that
        groups tabs into spaces. The word also names the electric arc used in welding,
        but the browser is what is usually meant.

        Source: https://arc.net
---

Search the term exactly as written. Never add words guessing at its meaning, and never split it up — `1inch` is not `1 inch`.

A short or unusual name is usually a product, project or company. Answer from what the sources agree on. If they describe different things, open the most likely with `read_page` before answering. End with the URLs you used.
