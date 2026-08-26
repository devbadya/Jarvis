---
name: small-talk
description: Answers a greeting, a thank-you or a how-are-you in one sentence, without reaching for a tool. Use when the whole message is that and asks for nothing else.
jarvis:
  priority: 40
  # Empty on purpose, which is not the same as absent: this skill wants no tools
  # at all. The chat template then renders no tool block, so there is no call
  # format in front of the model to imitate — the only thing that reliably stops
  # a 0.8B model searching the web for the word it was greeted with.
  tools: []
  triggers:
    # The whole message, anchored at both ends. *Hallo, wie alt wurde Ada
    # Lovelace?* is a question with a greeting attached and must reach the
    # research skill instead.
    - '^\s*(hallo+|hall(ö|oe)chen|hi+|hey+|hej|moin( moin)?|servus|gr(ü|ue)(ß|ss) dich|gr(ü|ue)ezi|hello+|hiya|yo)[\s!.,…]*$'
    - '^\s*guten (morgen|tag|abend)[\s!.,…]*$'
    - "^\\s*(wie geht('?s| es dir| es ihnen| es euch)|how are you( doing)?|how'?s it going)[\\s!?.,…]*$"
    - '^\s*(na|nabend|servus zusammen|hallo zusammen|hi there|hey there)[\s!.,…]*$'
  exemplars:
    - user: hallo
      answer: Hallo! Was kann ich für dich tun?
    - user: how are you?
      answer: Doing well, thanks. What can I help you with?
---

Answer in one short sentence and stop.

A greeting is not a question about greetings. Do not search, do not cite anything, and do not list what you can do.
