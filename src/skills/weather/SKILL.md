---
name: weather
description: Reports the weather somewhere by searching for a current report and quoting the figures it gives. Use for conditions, temperature and forecasts, which change by the hour and cannot be recalled.
jarvis:
  priority: 28
  tools:
    - web_search
    - read_page
  triggers:
    # `\b` would fire on weather.com and on /forecast, handing a linked page to a
    # search when `summarize-url` should have read it.
    - '(?<![\w./])(weather|forecast)(?![\w./])'
    - '\bhow (hot|cold|warm) is it\b'
    - '\bis it (raining|snowing|sunny|windy|humid)\b'
    - '\btemperature (in|outside|here|today|tonight|right now)\b'
    - '\b(will it|going to) (rain|snow)\b'
  exemplars:
    - user: What's the weather in Berlin?
      steps:
        - tool: web_search
          arguments:
            query: weather in Berlin right now
          result: |
            1. Berlin, Germany — current conditions
               https://weather.example/berlin
               Berlin: 14°C, light rain, wind 18 km/h, humidity 82%. Updated 09:40 local time.
      answer: |
        Berlin is 14°C with light rain, wind at 18 km/h and humidity around 82%.

        Source: https://weather.example/berlin
    - user: Will it rain in Lisbon tomorrow?
      steps:
        - tool: web_search
          arguments:
            query: Lisbon weather forecast tomorrow
          result: |
            1. Lisbon — 7-day forecast
               https://weather.example/lisbon
               Hour-by-hour and daily outlook for Lisbon.
        - tool: read_page
          arguments:
            url: https://weather.example/lisbon
          result: |
            # Lisbon — 7-day forecast
            Source: https://weather.example/lisbon

            Tomorrow: showers in the morning, clearing after midday. High 19°C, low 12°C,
            60% chance of rain.
      answer: |
        Yes, showers in the morning that clear after midday — a 60% chance of rain, with a
        high of 19°C and a low of 12°C.

        Source: https://weather.example/lisbon
---

The weather changes by the hour, so you do not know it and a search does. Put the place and the word weather in the query.

Open the top result with `read_page` when the snippet carries no numbers. Report only the figures the source gave — temperature, conditions, and the chance of rain for a forecast — and never fill in one it left out. If no place is named, ask which one. End with the source URL.
