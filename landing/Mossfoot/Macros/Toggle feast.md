---
title: Toggle feast
foundry:
  source: Macro
  patch:
    name: Toggle feast
    type: script
    scope: global
    command: |
      const scene = game.scenes.get("mossfootHall0001");
      if (!scene) return ui.notifications.error("Mossfoot Great Hall scene not found.");
      const tile = scene.tiles.get("mossfootDinner01");
      if (!tile) return ui.notifications.warn("Feast tile not found on the scene.");
      await tile.update({ hidden: !tile.hidden });
      ui.notifications.info(`Feast ${tile.hidden ? "cleared" : "spread"}.`);
---

Toggles the feast overlay on [[Mossfoot Great Hall]] through the tile's pinned `_id` (`mossfootDinner01`). Click once and the tables appear; click again and they are cleared. The macro reads `game.scenes`, so the scene must have been imported into the world with **Keep Document IDs** checked.

> [!quote] Macro body
> ```fm javascript
> foundry.patch.command
> ```

Reaching the placeable by `_id` rather than by name (`scene.tiles.find(t => t.name === "Dinner")`) survives the GM renaming the tile and ignores any other tile that shares the name.
