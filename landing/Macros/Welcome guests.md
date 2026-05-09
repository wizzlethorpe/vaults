---
title: Welcome guests
foundry:
  base: Macro
  data:
    name: Welcome guests
    type: chat
    command: |
      The innkeeper of the Mossfoot looks up as you enter. "Wet outside?
      Fire's hot, stew's hotter. Coin first, questions after."
    scope: global
---

A `chat`-type Macro the GM can drop on the hotbar and click whenever the
party walks back into the [[The Mossfoot Inn|Mossfoot]]. Sends the inline
`command` text into chat verbatim — no script execution.

> [!quote] What this macro posts
> `fm: foundry.data.command`

Macro `type: "chat"` is the safe variant: the `command` is treated as
literal chat text. The other supported value, `type: "script"`, runs the
`command` as JavaScript inside Foundry's sandbox; this demo deliberately
avoids that to keep the imported document harmless without requiring a
GM to read code before clicking.
