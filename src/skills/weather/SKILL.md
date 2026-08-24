---
name: weather
description: Reports the weather somewhere from a live reading that has already been reconciled across several forecast services. Use for current conditions, temperature, rain and the next few days.
jarvis:
  priority: 28
  tools:
    - weather
  # Only what the triggers below do not already reach. Phrases, not words:
  # `temperature` alone also means the one water boils at.
  keywords:
    - how warm
    - how cold
    - chance of rain
    - wie warm
    - wie kalt
    - regenwahrscheinlichkeit
  triggers:
    # `\b` would fire on weather.com and on /forecast, handing a linked page to a
    # weather lookup when `summarize-url` should have read it.
    - '(?<![\w./])(weather|forecast)(?![\w./])'
    - '\bhow (hot|cold|warm) is it\b'
    - '\bis it (raining|snowing|sunny|windy|humid)\b'
    - '\btemperature (in|outside|here|today|tonight|right now)\b'
    - '\b(will it|going to) (rain|snow)\b'
    # German, because the app answers in the language it is asked in and the
    # compound words a German question uses would not survive a word boundary:
    # Wettervorhersage and Unwetter both have to match.
    - '(?<![\w./])(un)?wetter'
    - '\b(regnet|schneit)\b'
    - '\bwie (warm|kalt|hei(ß|ss)) ist es\b'
    - '\btemperatur (in|drau(ß|ss)en|heute|jetzt|morgen)\b'
  exemplars:
    - user: What's the weather in Berlin?
      steps:
        - tool: weather
          arguments:
            place: Berlin
          result: |
            Berlin, Germany — 15:45 local (Europe/Berlin)
            Now: 19.6 °C, feels 19.5 °C, partly cloudy, wind 4 km/h from NW, humidity 59%
            Today Mon 24 Aug: 11.4 to 20.2 °C, overcast, 3% chance of rain
            Tue 25 Aug: 13.4 to 23.6 °C, overcast, 0% chance of rain
            Sources: Open-Meteo (ICON, GFS, ECMWF) and wttr.in, 3.4 °C apart on the temperature now, so it is approximate.
      answer: |
        Berlin is around 19.6 °C and partly cloudy, with a light wind from the north-west and
        humidity at 59%. Up to 20.2 °C later, and rain is unlikely at 3%.

        The two sources are 3.4 °C apart, so treat the temperature as approximate.

        Sources: Open-Meteo (ICON, GFS, ECMWF) and wttr.in
    - user: Will it rain in Lisbon tomorrow?
      steps:
        - tool: weather
          arguments:
            place: Lisbon
          result: |
            Lisbon, Portugal — 14:45 local (Europe/Lisbon)
            Now: 24.1 °C, feels 24.5 °C, partly cloudy, wind 20 km/h from W, humidity 66%
            Today Mon 24 Aug: 20.1 to 24.3 °C, overcast, 0.2 mm rain, 6% chance of rain
            Tue 25 Aug: 19.6 to 24 °C, light showers, 4 mm rain, 89% chance of rain
            Sources: Open-Meteo (ICON, GFS, ECMWF) and wttr.in, agreeing within 0.1 °C on the temperature now.
      answer: |
        Yes. Tomorrow, Tue 25 Aug, Lisbon has an 89% chance of rain and about 4 mm from light
        showers, between 19.6 and 24 °C.

        Sources: Open-Meteo (ICON, GFS, ECMWF) and wttr.in
---

You cannot know the weather; `weather` reads it live. Call it once, with the place as the user wrote it.

Answer from the lines it returns: `Now` for what it is doing at the moment, a dated line for a day ahead. Quote the figures and their units as they are given and add none of your own. When the sources line says the readings are apart, say that the temperature is approximate. If the message names no place, ask which one.
