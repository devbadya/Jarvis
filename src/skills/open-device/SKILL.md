---
name: open-device
description: Opens an app or an http(s) link on the computer running the device agent. Use when the user asks to open or launch something on this computer.
jarvis:
  priority: 34
  tools:
    - open
  keywords:
    - öffne mal
    - starte mal
  triggers:
    - '^\s*(please\s+)?open\s+(?!source\b|up\b)'
    - '^\s*(please\s+)?launch\b'
    - '^\s*(bitte\s+)?(öffne|oeffne|starte)\b'
  exemplars:
    - user: Open Safari.
      steps:
        - tool: open
          arguments:
            target: Safari
          result: Opened Safari.
      answer: Opened Safari.
    - user: Öffne https://example.com
      steps:
        - tool: open
          arguments:
            target: https://example.com
          result: Opened https://example.com/
      answer: Geöffnet. https://example.com
---

Call `open` with the app name or the http(s) link. Do not say it opened unless the tool said so. A phone is not this computer. If they did not name a target, ask what to open.
