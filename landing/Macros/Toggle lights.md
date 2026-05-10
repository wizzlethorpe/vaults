---
title: Toggle lights
foundry:
  base: Macro
  data:
    name: Toggle lights
    type: script
    scope: global
    command: |
      const scene = game.scenes.get("mossfootHall0001");
      if (!scene) return ui.notifications.error("Mossfoot Great Hall scene not found.");
      const newDarkness = scene.environment.darknessLevel >= 0.5 ? 0 : 1;
      await scene.update({ "environment.darknessLevel": newDarkness });
      ui.notifications.info(`Mossfoot Great Hall ${newDarkness === 0 ? "lit" : "dimmed"}.`);
---

Flips the [[Mossfoot Great Hall]] scene's darkness between `0` (fully
lit) and `1` (full dark). Operates on the scene by its pinned
`foundry.id` (`mossfootHall0001`), so it works whether or not the
scene is the active canvas.

> [!quote] Macro body
> ```fm javascript
> foundry.data.command
> ```

This is the simplest form of the lighting macro. The original Great
Hall scene used candle / floating-candle overlay tiles that swapped on
darkness change; we stripped those for the demo, so this version just
moves the darkness slider.
