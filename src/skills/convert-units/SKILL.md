---
name: convert-units
description: Converts a quantity into different units with the convert tool. Use when the user asks what a length, mass, temperature, volume, speed, area, amount of data or duration is in other units.
jarvis:
  # Above `arithmetic`, because a conversion looks like a sum to a model that has
  # a calculator and no converter — and the calculator refuses it, correctly.
  priority: 32
  tools:
    - convert
  keywords:
    - in celsius
    - in fahrenheit
    - in inches
    - in kilometers
    - how many ounces
    - how many pounds
    - umgerechnet
    - in kilometer
    - wie viele gramm
    - wie viele zentimeter
  triggers:
    - '\b(convert|umrechnen|rechne .{0,20}um)\b'
    # `N <something> in <unit>`, with the target anchored at the end so that
    # *20 minutes to Berlin* is not read as a conversion into a city.
    - "\\b\\d+(?:[.,]\\d+)?\\s*(?:°\\s*)?[\\w/²³'\"]{1,16}\\s+(?:in|to|nach|as)\\s+(?:°\\s*)?(?:mm|cm|dm|m|km|inch(?:es)?|in|ft|feet|foot|yards?|yd|miles?|mi|meilen|zoll|kilometer|meter|zentimeter|millimeter|mg|kg|kilo(?:gramm)?|g|gramm|grams?|lbs?|pounds?|pfund|oz|ounces?|unzen?|stones?|tonnen?|ml|cl|liters?|litres?|liter|gallons?|gal|cups?|tassen?|pints?|quarts?|celsius|fahrenheit|kelvin|c|f|k|km/?h|kph|mph|m/s|knots?|kn|ha|hektar|acres?|m²|km²|cm²|sq ?ft|kb|mb|gb|tb|kib|mib|gib|bytes?|ms|sekunden?|seconds?|minuten?|minutes?|stunden?|hours?|tage?|days?|wochen?|weeks?)\\b\\s*\\??\\s*$"
    # The other way round, which is how the question is usually asked in German.
    - '\bwie viele?\s+(?:zentimeter|meter|kilometer|zoll|meilen|gramm|kilo(?:gramm)?|pfund|unzen?|liter|milliliter|grad|minuten|stunden|tage|wochen)\b'
    - '\bhow many\s+(?:centimet|millimet|met|kilomet|inch|feet|foot|yard|mile|gram|kilo|pound|ounce|stone|litre|liter|millilit|gallon|cup|degree|minute|hour|day|week|byte|megabyte|gigabyte)'
  exemplars:
    - user: What is 32 fahrenheit in celsius?
      steps:
        - tool: convert
          arguments:
            value: 32
            from: fahrenheit
            to: celsius
          result: 32 °F = 0 °C
      answer: 32 °F is 0 °C — freezing point.
    - user: Wie viel sind 5 Meilen in Kilometer?
      steps:
        - tool: convert
          arguments:
            value: 5
            from: Meilen
            to: Kilometer
          result: 5 mi = 8.04672 km
      answer: 5 Meilen sind 8,05 km.
---

Call `convert` for any change of unit. Never work it out yourself: this is the arithmetic you get wrong.

Pass the number in `value` and both units as the user wrote them — the tool knows their names in both languages. Give the number it returns, rounded to what the question needs, and keep the units it used.
