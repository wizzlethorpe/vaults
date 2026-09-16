---
title: Mossfoot Great Hall
image: mossfoot-great-hall.webp
foundry:
  # Pinning an explicit Foundry id means a macro on another page can
  # reference this Scene as `Scene.mossfootHall0001` directly, without
  # computing the SHA1 we'd otherwise derive from the page path. Stable
  # across renames and across vault redeploys.
  source: Scene
  # `@vault/PATH` strings inside foundry.patch name files graft places at
  # vaults/<vault>/PATH, so the scene names vault-shipped assets without a
  # deploy URL. Walls trace
  # the outer room; one ambient sound plays at the centre.
  patch:
    _id: mossfootHall0001
    name: Mossfoot Great Hall
    navigation: true
    width: 3780
    height: 2800
    padding: 0.25
    tokenVision: true
    levels:
      - _id: defaultLevel0000
        name: Level
        elevation: { bottom: 0, top: 20 }
        background:
          src: "@vault/attachments/mossfoot-great-hall.webp"
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
    # Pinned _ids on every wall, so a rebuild compares equal and writes
    # nothing. Without them each build would mint new ids and rewrite the scene.
    walls:
      - { _id: mossfootHallW001, c: [1120,  840, 1120, 3360] }
      - { _id: mossfootHallW002, c: [1120, 3360, 4480, 3360] }
      - { _id: mossfootHallW003, c: [4480, 3360, 4480, 2730] }
      - { _id: mossfootHallW004, c: [4480, 2730, 4620, 2590] }
      - { _id: mossfootHallW005, c: [4620, 2590, 4620, 1610] }
      - { _id: mossfootHallW006, c: [4620, 1610, 4480, 1470] }
      - { _id: mossfootHallW007, c: [4480, 1470, 4480,  840] }
      - { _id: mossfootHallW008, c: [4480,  840, 1120,  840] }
    tiles:
      # Feast overlay. Hidden by default; the [[Toggle feast]] macro flips
      # `hidden` to drape the tables across the empty hall.
      #
      # Coordinate math: V14 Tile uses `texture.anchorX/Y` as the sprite
      # anchor within `(tile.x, tile.y)`; both are set to 0.5 here, so
      # `(x, y)` is the tile's centre.
      #
      # The image-area centre isn't naively `(padding*w + w/2, padding*h + h/2)`
      # because V14 grid-aligns the image origin: padding offset is rounded
      # UP to a grid step. With grid.size=140 and padding=0.25 on a 3780x2800
      # scene:
      #   x_offset = ceil(0.25 * 3780 / 140) * 140 = ceil(6.75) * 140 = 980
      #   y_offset = ceil(0.25 * 2800 / 140) * 140 = 5 * 140 = 700
      # Image-area centre = (980 + 1890, 700 + 1400) = (2870, 2100).
      - _id: mossfootDinner01
        x: 2870
        y: 2100
        width: 3780
        height: 2800
        elevation: 1
        sort: 1
        hidden: true
        texture:
          src: "@vault/attachments/mossfoot-great-hall-feast.webp"
          anchorX: 0.5
          anchorY: 0.5
          fit: fill
          tint: "#ffffff"
    sounds:
      # Pinned _id so a macro can flip the sound on/off by known id without
      # walking the scene's ambient-sound collection. The radius covers the
      # whole hall at the 140 ppi grid scale.
      - _id: mossfootHallAmb1
        path: "@vault/Mossfoot/Audio/great-hall.ogg"
        x: 2870
        y: 2100
        radius: 100
        volume: 0.5
        easing: true
        walls: true
        repeat: true
    ownership: { default: 0 }
---

The grand hall of the Mossfoot Inn. A 27 by 20 grid map at 140 pixels per square, walls tracing the outer room, one ambient sound covering the centre. In Foundry this becomes a `Scene` in your world; the background image and the audio are downloaded into the vault's own directory and served locally.

```battlemap
grid: 140
default_level: 0
name: Mossfoot Great Hall
levels:
  - name: Empty Hall
    layers:
      - "attachments/mossfoot-great-hall.webp"
  - name: Feast Laid
    layers:
      - "attachments/mossfoot-great-hall-feast.webp"
```

Use the [[Toggle feast]] macro in foundry to toggle the dinner overlay.

And the ambient track that plays while you're in the scene:

![[great-hall.ogg]]

Both files reach the deploy through the `@vault/` paths in the scene's `levels`, `tiles` and `sounds`; the embed above is here so the track can be heard on the web page. Graft downloads both into the vault's own directory.

> [!tip] Try the macros
> Three pinned-id macros target this scene:
>
> - [[Toggle feast]]: show or hide the dinner overlay (`mossfootDinner01`)
> - [[Toggle lights]]: flip scene darkness between 0 and 1
> - [[Toggle ambient noise]]: mute or unmute the ambient sound (`mossfootHallAmb1`)
>
> Each macro reaches the scene by its pinned `patch._id` (`mossfootHall0001`) and the placeable by its pinned `_id`. They read `game.scenes`, so build the vault's grafts file into the world first.
