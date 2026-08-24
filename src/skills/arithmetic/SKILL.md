---
name: arithmetic
description: Computes an exact answer with the calculator whenever the user asks for a sum, product, percentage, power or root. Use for any question containing an arithmetic expression or a request to work a number out.
jarvis:
  priority: 30
  tools:
    - calculator
  keywords:
    - calculate
    - work out
    - how much is
    - square root
    - percent of
    - rechne
    - berechne
    - wie viel ist
    - quadratwurzel
    - prozent von
  triggers:
    - '\d\s*[+*/^%-]\s*\d'
    - '\d+(\.\d+)?\s*(percent|per cent|%)\s*(of|off)'
    - '\b(times|multiplied by|divided by|plus|minus)\b.*\d'
    - '\b(square root|sqrt|to the power of|squared|cubed)\b'
    - '\b(calculate|work out|compute)\b'
  exemplars:
    - user: What is 6748 * 9?
      steps:
        - tool: calculator
          arguments:
            expression: 6748 * 9
          result: 6748 * 9 = 60732
      answer: 6748 × 9 = 60,732.
    - user: How much is 12 percent of 340?
      steps:
        - tool: calculator
          arguments:
            expression: 340 * 0.12
          result: 340 * 0.12 = 40.8
      answer: 12% of 340 is 40.8.
---

Call `calculator` for the arithmetic. Do not work it out yourself, even when it looks easy. Report the number the tool returned.
