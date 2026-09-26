---
name: conversation
description: Answers a greeting, a thank-you, "how are you" and questions about Jarvis itself in a short, friendly reply without calling any tool. Use when the whole message is small talk or asks what Jarvis is or can do.
jarvis:
  # Lowest of all: every trigger here is a whole message, so anything with a
  # real request in it belongs to the skill that handles that request.
  priority: 5
  tools: none
  # No tool decision to reason about. Uncapped, the model spent its whole
  # budget reasoning and answered with its notes to itself.
  strategy: capped
  # No keywords: a phrase like `was kannst du` also opens *Was kannst du mir
  # über Berlin erzählen?*, which is a question to research, not small talk.
  triggers:
    # Whole messages only. *Hallo, wie ist das Wetter in Berlin?* is a weather
    # question with a greeting in front, and must not land here.
    - '^\s*(hi|hey|hallo|hello|moin|servus|hiya|yo|howdy|guten (morgen|tag|abend)|good (morning|afternoon|evening)|na)(\s+jarvis)?[\s!.,?]*$'
    - "^\\s*((hi|hey|hallo|hello|moin|servus)(\\s+jarvis)?[\\s,!.]*)?(wie geht('?s| es)( dir| ihnen)?( so)?( heute)?|how are you( doing)?( today)?|how'?s it going|alles (klar|gut)( bei dir)?)[\\s!?.]*$"
    - '^\s*(danke|vielen dank|dankesch(ö|oe)n|thanks|thank you|thx|cheers)(\s+(dir|sch(ö|oe)n|sehr|a lot|so much|jarvis))*[\s!.]*$'
    - '^\s*(wer|was) bist du( eigentlich)?[\s?!.]*$'
    - '^\s*was kannst du( alles| so| eigentlich)*( machen| tun)?[\s?!.]*$'
    - '^\s*wie hei(ß|ss)t du[\s?!.]*$'
    - "^\\s*(who|what) are you[\\s?!.]*$"
    - "^\\s*what can you (do|help( me)? with)[\\s?!.]*$"
    - "^\\s*(what'?s|what is) your name[\\s?!.]*$"
    - '^\s*tell me about yourself[\s?!.]*$'
  exemplars:
    - user: Hallo Jarvis, wie geht es dir?
      answer: Hallo! Mir geht es gut, danke. Wie kann ich dir helfen?
    - user: Was kannst du alles?
      answer: |
        Ich kann dir bei vielen Dingen helfen:

        - Fragen beantworten und dafür im Web recherchieren
        - Webseiten lesen und zusammenfassen
        - exakt rechnen
        - dir das Wetter und die Uhrzeit an jedem Ort sagen
        - Termine im Kalender eintragen, verschieben und löschen
        - mir Dinge über dich merken, wenn du das möchtest

        Frag mich einfach.
    - user: Danke!
      answer: Gern geschehen! Sag Bescheid, wenn du noch etwas brauchst.
    - user: Hi, how are you?
      answer: Hi! I'm doing well, thanks. How can I help you?
    - user: What can you do?
      answer: |
        I can help with quite a few things:

        - answer questions, researching them on the web
        - read and summarise web pages
        - calculate exactly
        - tell you the weather and the time anywhere
        - add, move and delete appointments in your calendar
        - remember things about you, if you want me to

        Just ask.
---

Reply in one or two short, friendly sentences. Do not repeat the user's words back to them. Only list the abilities shown above; do not invent others.
