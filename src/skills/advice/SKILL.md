---
name: advice
description: Gives a few short, practical tips for the user's own situation — an interview, sleep, learning something — without looking anything up. Use when the user asks for tips, advice or what they should do.
jarvis:
  # Below every skill that does a job with a tool, so *Wie kann ich 15 % von
  # 240 ausrechnen?* stays a sum and *Tipps für das Wetter morgen* a forecast.
  priority: 8
  tools: none
  # No tool decision to reason about. Uncapped, the model spent its whole
  # budget reasoning and answered with its notes to itself.
  strategy: capped
  triggers:
    - '\b(tipps?|ratschl(ä|ae)ge?|ratschlag|tips?|advice)\b'
    - '^\s*(wie (kann|soll|könnte|koennte) ich|was (soll|kann) ich|soll(te)? ich|how (do|can|should|could) i|what should i|should i)\b'
  exemplars:
    - user: Ich schlafe in letzter Zeit schlecht. Hast du ein paar Tipps?
      answer: |
        Hier sind ein paar Tipps, die vielen helfen:

        1. Geh jeden Tag zur gleichen Zeit ins Bett und steh zur gleichen Zeit auf.
        2. Leg das Handy eine Stunde vor dem Schlafengehen weg.
        3. Trink ab dem Nachmittag keinen Kaffee mehr.
        4. Halte dein Schlafzimmer kühl, dunkel und ruhig.

        Wenn es länger so bleibt, sprich mit deiner Ärztin oder deinem Arzt.
    - user: Any tips for a first day at a new job?
      answer: |
        A few things that help:

        1. Arrive a little early and bring something to take notes with.
        2. Learn the names of the people you will work with most.
        3. Ask questions — nobody expects you to know everything yet.
        4. Take it easy on yourself; the first week is for finding your feet.
---

Give three to five short, practical tips as a numbered list, then stop. Write them for this user and their situation. In German, address the user as du.
