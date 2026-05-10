---
title: Toggle feast
foundry:
  base: Macro
  data:
    name: Toggle feast
    type: script
    scope: global
    command: |
      const scene = game.scenes.get("mossfootHall0001");
      if (!scene) return ui.notifications.error("Mossfoot Great Hall scene not found.");
      const tile = scene.tiles.get("mossfootDinner01");
      if (!tile) return ui.notifications.warn("Feast tile not found on the scene.");
      await tile.update({ hidden: !tile.hidden });
      ui.notifications.info(`Feast ${tile.hidden ? "spread" : "cleared"}.`);
---

Toggles the feast overlay on [[Mossfoot Great Hall]] by reaching the
tile via its pinned `_id` (`mossfootDinner01`). Click once → the tables
appear; click again → they're cleared.

> [!quote] Macro body
> ```javascript
> `fm: foundry.data.command`
> ```

Reaching the placeable by `_id` rather than by name (`scene.tiles.find(t => t.name === "Dinner")`)
is the safer pattern: it survives the GM renaming the tile in the
sidebar, and it ignores any other tile that happens to share the name.
