---
title: Toggle ambient noise
foundry:
  base: Macro
  data:
    name: Toggle ambient noise
    type: script
    scope: global
    command: |
      const scene = game.scenes.get("mossfootHall0001");
      if (!scene) return ui.notifications.error("Mossfoot Great Hall scene not found.");
      const sound = scene.sounds.get("mossfootHallAmb1");
      if (!sound) return ui.notifications.warn("Ambient sound not found on the scene.");
      const newVolume = sound.volume > 0 ? 0 : 0.5;
      await sound.update({ volume: newVolume });
      ui.notifications.info(`Mossfoot Great Hall ambient ${newVolume ? "enabled" : "muted"}.`);
---

Mutes / unmutes the ambient `great-hall.ogg` track in the
[[Mossfoot Great Hall]] scene by addressing the AmbientSound document
via its pinned `_id` (`mossfootHallAmb1`). The audio file itself is
pulled into the per-vault Foundry cache via the `@vault/Audio/great-hall.ogg`
reference in the scene's `sounds[]`, so playback works offline.

> [!quote] Macro body
> ```fm javascript
> foundry.data.command
> ```
