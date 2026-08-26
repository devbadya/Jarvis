---
name: arithmetic
description: Computes an exact answer with the calculator whenever the user asks for a sum, product, percentage, power or root. Use for any question containing an arithmetic expression or a request to work a number out.
jarvis:
  priority: 30
  tools:
    - calculator
  # `how much is` and `wie viel ist` were here and are question shells, not
  # arithmetic: they sent *How much is a Big Mac in Japan?* to the calculator.
  # The numbers a sum contains are what the triggers below match instead.
  keywords:
    - calculate
    - work out
    - square root
    - percent of
    - rechne
    - berechne
    - quadratwurzel
    - prozent von
    - wurzel aus
  triggers:
    - '\d\s*[+*/^%-]\s*\d'
    - '\d+(\.\d+)?\s*(percent|per cent|%)\s*(of|off)'
    - '\b(times|multiplied by|divided by|plus|minus)\b.*\d'
    - '\b(square root|sqrt|to the power of|squared|cubed)\b'
    - '\b(calculate|work out|compute)\b'
    # Both operands are required, so *add 3 more rows* is not a sum: the verb
    # alone says nothing about whether there is arithmetic to do.
    - '\b(add|addiere)\s+\d+([.,]\d+)?\s+(and|to|und|zu)\s+\d'
    # German, kept to the shapes that carry their own numbers, so no question
    # about a price can reach the calculator through them.
    - '\d\s*(mal|geteilt durch|hoch)\s*\d'
    - '\d+([.,]\d+)?\s*(prozent|%)\s*von\b'
    - '\b(wurzel aus|rechne .{0,20}aus)\b'
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
