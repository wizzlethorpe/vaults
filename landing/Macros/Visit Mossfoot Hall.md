---
title: Visit Mossfoot Hall
foundry:
  base: Macro
  data:
    name: Visit Mossfoot Hall
    type: script
    scope: global
    command: |
      const scene = game.scenes.get("mossfootHall0001");
      if (!scene) {
        ui.notifications.warn("Mossfoot Great Hall scene not found.");
        return;
      }
      await scene.view();
      ui.notifications.info("Welcome to the Mossfoot.");
---

A `script`-type Macro that navigates Foundry to the [[Mossfoot Great Hall]]
scene by its pinned `foundry.id` (`mossfootHall0001`). Drop it on the
hotbar and click; it views the scene and posts a small toast.

> [!quote] What this macro runs
> ```javascript
> `fm: foundry.data.command`
> ```

Three vault features cooperate here:

1. The Mossfoot Hall scene's `foundry.id: mossfootHall0001` pins its
   Foundry UUID across vault id, page renames, and redeploys.
2. This page's `foundry.base: Macro` instantiates the macro on sync, so
   the GM doesn't have to copy-paste the script body.
3. `type: script` runs the body as JavaScript — the safer `type: chat`
   variant ([[Welcome guests]]) just posts text. Script macros are
   inherently arbitrary code; this one is short and read-before-clicking
   is recommended.
