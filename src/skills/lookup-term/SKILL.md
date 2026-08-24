---
name: lookup-term
description: Finds out what a name or unfamiliar term refers to by searching for it verbatim and reading what comes back. Use when the user asks what or who something is and the subject is a single name, a product, a project, or anything containing a digit.
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
    - "^\\s*(what|who)('s| is| are)\\s+[^\\s?]{1,24}\\s*\\??\\s*$"
    - "\\b(what|who)('s| is| are)\\s+\\S*\\d\\S*"
  exemplars:
    - user: What is 1Password?
      steps:
        - tool: web_search
          arguments:
            query: 1Password
          result: |
            1. 1Password — Password Manager for Families and Businesses
               https://1password.com
               1Password stores passwords, passkeys and secrets in an encrypted vault.
      answer: |
        1Password is a password manager. It keeps passwords, passkeys and other secrets
        in an encrypted vault and fills them in across devices.

        Source: https://1password.com
    - user: What is Arc?
      steps:
        - tool: web_search
          arguments:
            query: Arc
          result: |
            1. Arc — The Browser Company
               https://arc.net
               A desktop web browser that organises tabs into spaces in a sidebar.
            2. Arc welding - Wikipedia
               https://en.wikipedia.org/wiki/Arc_welding
               Joining metals using heat from an electric arc.
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

A short or unusual name is usually a product, project or company. Let the results say what it is. If they show several meanings, open the most likely with `read_page` before answering. End with the source URL.
