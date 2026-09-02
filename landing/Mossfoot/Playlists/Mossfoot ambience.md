---
title: Mossfoot ambience
foundry:
  source: Playlist
  patch:
    name: Mossfoot ambience
    description: Tavern background loop for sessions set at the Mossfoot Inn.
    mode: 0     # 0 = sequential, 1 = shuffle, 2 = simultaneous
    sounds:
      # Pinned _id so re-syncs update this sound in place. Foundry's
      # EmbeddedCollectionField._updateDiff matches incoming items by _id;
      # without one, every sync allocates a fresh randomID() and the
      # playlist accrues a duplicate sound each time.
      - _id: mossfootSnd00001
        name: Mossfoot common room
        path: "@vault/Mossfoot/Audio/mossfoot-tavern.ogg"
        volume: 0.6
        repeat: true
        description: 120s seamless tavern loop. bar crowd, distant patrons, hearth fire.
---

A one-track Playlist that points at [mossfoot-tavern.ogg](../Audio/mossfoot-tavern.ogg), a layered tavern ambience mixed from the [Sonniss GDC library](https://sonniss.com/gameaudiogdc/).

The `@vault/PATH` prefix in the sound's `path` tells the Foundry sync to rewrite to a local cache URL, so the audio file is downloaded into the per-vault asset cache the same way images are; playback works offline and survives moving the vault between deploys.

![[mossfoot-tavern.ogg]]

| Field | Value |
|---|---|
| Mode | `fm: foundry.patch.mode` (0 = sequential) |
| Track | `fm: foundry.patch.sounds.0.name` |
| Path | `fm: foundry.patch.sounds.0.path` |
| Volume | `fm: foundry.patch.sounds.0.volume` |
| Repeat | `fm: foundry.patch.sounds.0.repeat` |
