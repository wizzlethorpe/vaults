---
title: Mossfoot Great Hall
image: mossfoot-great-hall.webp
foundry:
  base: Scene
  # The Foundry module rewrites cover-image (`image:`) URLs for Actor
  # portraits but doesn't touch scene-texture paths, so background.src
  # points at the wiki's deploy URL the same way the playlist does.
  # Walls trace the room outline; lights / sounds / tiles / Levels-module
  # references from the original were stripped to keep the demo legible.
  data:
    name: Mossfoot Great Hall
    navigation: true
    width: 3780
    height: 2800
    padding: 0.25
    tokenVision: true
    background:
      src: https://test.vaults.wizzlethorpe.com/attachments/mossfoot-great-hall.webp
      tint: "#ffffff"
    grid:
      type: 1            # square
      size: 140          # pixels per square
      style: solidLines
      thickness: 1
      color: "#000000"
      alpha: 0.2
      distance: 5
      units: ft
    initial: { x: null, y: null, scale: null }
    fog:
      mode: 1
      colors: { explored: null, unexplored: null }
    environment:
      darknessLevel: 0
      darknessLock: false
      globalLight:
        enabled: true
        alpha: 0.5
        bright: false
        color: null
        coloration: 1
        luminosity: 0
        saturation: 0
        contrast: 0
        shadows: 0
        darkness: { min: 0, max: 0 }
      cycle: false
    walls:
      - { c: [1120,  840, 1120, 3360] }
      - { c: [1120, 3360, 4480, 3360] }
      - { c: [4480, 3360, 4480, 2730] }
      - { c: [4480, 2730, 4620, 2590] }
      - { c: [4620, 2590, 4620, 1610] }
      - { c: [4620, 1610, 4480, 1470] }
      - { c: [4480, 1470, 4480,  840] }
      - { c: [4480,  840, 1120,  840] }
    ownership: { default: 0 }
---

The grand hall of the Mossfoot Inn (well, that's what we're calling it
for this demo). A 27 × 20 grid map at 140 ppi, walls tracing the outer
room, no lights, no tokens, no ambient sound. On Foundry sync this
becomes a real `Scene` you can navigate to from the scene sidebar.

![[mossfoot-great-hall.webp|600]]

## What got stripped from the original

The source export was a fully-dressed scene with:

- 119 light placements (torches, hearth, chandeliers)
- 3 overlay tiles (a dinner-table layer, candle flames, floating candles)
- 1 ambient `great-hall.ogg` sound
- 1 map note pointing at a compendium journal entry
- Levels-module `levels[]` metadata on every placeable
- A `_stats.compendiumSource` reference

The simplified frontmatter above keeps just the background, walls, grid,
and a globally-lit environment. Everything else was removed because:

- references to other documents (the note's `entryId`, the compendium
  source) wouldn't resolve in another world,
- the audio asset would 404 since the Foundry module doesn't sync audio
  into its per-vault cache (same constraint that pushes [[Mossfoot ambience]]
  to use the deploy URL for its sound),
- the Levels module isn't a hard dependency of `vaults`, and the
  `levels: [...]` arrays on every wall / light / tile would just be
  ignored if the module isn't installed.

The cover image (`image: mossfoot-great-hall.webp`) ships with the page
the normal way and renders inline above; the scene background points at
the same file via the deployed URL.
