---
title: Toggle ambient noise
foundry:
  source: Macro
  patch:
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

Mutes and unmutes the ambient `great-hall.ogg` track in the [[Mossfoot Great Hall]] scene through the AmbientSound's pinned `_id` (`mossfootHallAmb1`). The audio file lands in the reader's own data directory through the `@vault/Mossfoot/Audio/great-hall.ogg` reference in the scene's `sounds`, so playback works offline. The macro reads `game.scenes`, so build the vault's grafts file into the world first.

> [!quote] Macro body
> ```fm javascript
> foundry.patch.command
> ```
