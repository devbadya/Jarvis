---
name: arithmetic
description: Computes an exact answer with the calculator whenever the user asks for a sum, product, percentage, power or root. Use for any question containing an arithmetic expression or a request to work a number out.
jarvis:
  priority: 30
  tools:
    - calculator
  # Only what the triggers miss, and nothing a sentence might contain by
  # accident: bare `rechne` also starts "ich rechne damit, dass …".
  keywords:
    - how much is
    - rechne mir
    - rechne aus
    - berechne
    - wie viel ist
    - quadratwurzel
    - prozent von
  triggers:
    - '\d\s*[+*/^%-]\s*\d'
    - '\d+(\.\d+)?\s*(percent|per cent|%)\s*(of|off)'
    - '\b(times|multiplied by|divided by|plus|minus)\b.*\d'
    - '\b(square root|sqrt|to the power of|squared|cubed)\b'
    # A number has to be in the message, or this is "I work out every morning".
    - '\b(calculate|work out|compute)\b.*\d'
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
