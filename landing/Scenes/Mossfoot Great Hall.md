---
title: Mossfoot Great Hall
image: mossfoot-great-hall.webp
foundry:
  # Pinning an explicit Foundry id means a macro on another page can
  # reference this Scene as `Scene.mossfootHall0001` directly, without
  # computing the SHA1 we'd otherwise derive from the page path. Stable
  # across renames and across vault redeploys.
  id: mossfootHall0001
  base: Scene
  # `@vault/PATH` strings inside foundry.data are rewritten at sync time
  # to local Foundry cache URLs (worlds/<id>/vaults-cache/<vault-id>/PATH).
  # Lets the scene reference vault-shipped assets without hardcoding the
  # deploy URL. Walls trace the outer room; one ambient sound plays at
  # the centre. Lights / overlay tiles / Levels-module metadata from the
  # original export were stripped to keep the demo legible.
  data:
    name: Mossfoot Great Hall
    navigation: true
    width: 3780
    height: 2800
    padding: 0.25
    tokenVision: true
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
    walls:
      - { c: [1120,  840, 1120, 3360] }
      - { c: [1120, 3360, 4480, 3360] }
      - { c: [4480, 3360, 4480, 2730] }
      - { c: [4480, 2730, 4620, 2590] }
      - { c: [4620, 2590, 4620, 1610] }
      - { c: [4620, 1610, 4480, 1470] }
      - { c: [4480, 1470, 4480,  840] }
      - { c: [4480,  840, 1120,  840] }
    tiles:
      # Feast overlay. Hidden by default; the [[Toggle feast]] macro flips
      # `hidden` to drape the tables across the empty hall.
      #
      # Coordinate math: Foundry V13+ Tile uses `texture.anchorX/Y` as the
      # sprite's anchor point within `(tile.x, tile.y)`. Both default to 0.5
      # if omitted, so we set them explicitly and supply `(x, y)` as the
      # tile's CENTER. With padding 0.25 on a 3780x2800 scene, the image
      # area centre sits at (padding*w + w/2, padding*h + h/2) = (2835, 2100).
      - _id: mossfootDinner01
        x: 2835
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
        path: "@vault/Audio/great-hall.ogg"
        x: 2870
        y: 2100
        radius: 30
        volume: 0.5
        easing: true
        walls: true
        repeat: true
    ownership: { default: 0 }
---

The grand hall of the Mossfoot Inn (well, that's what we're calling it
for this demo). A 27 × 20 grid map at 140 ppi, walls tracing the outer
room, one ambient sound covering the centre. On Foundry sync this
becomes a real `Scene` you can navigate to from the scene sidebar; both
the background image and the audio are pulled into the per-vault cache
and served locally, no deploy URL involved.

![[mossfoot-great-hall.webp|600]]

The empty hall above is the background. With the [[Toggle feast]] macro
flipped on, the dinner overlay drapes across the room:

![[mossfoot-great-hall-feast.webp|600]]

And the ambient track that plays while you're in the scene:

![[great-hall.ogg]]

Embedding both files via `![[...]]` here is what gates them into the
deploy (the image scanner only picks up wikilink embeds, not plain
markdown links). The Foundry sync then pulls them into the per-vault
cache via the `@vault/...` paths in the scene's `tiles[]` and
`sounds[]`.

> [!tip] Try the macros
> Three pinned-id macros target this scene:
>
> - [[Toggle feast]] — show / hide the dinner overlay (`mossfootDinner01`)
> - [[Toggle lights]] — flip scene darkness 0 ↔ 1
> - [[Toggle ambient noise]] — mute / unmute the ambient sound (`mossfootHallAmb1`)
>
> Each macro reaches the scene by its pinned `foundry.id`
> (`mossfootHall0001`) and the placeable by its pinned `_id`, with no
> SHA1 lookups or name-search.

> [!info] 
> This map is a simplified version of the Great Hall map from the Wizzlethorpe [World of Wizards](https://wizzlethorpe.com/modules/world-of-wizards/) map pack. The original map has floatin candles and more fun macros. You should check it out!

