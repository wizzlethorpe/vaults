---
title: Mossfoot ambience
foundry:
  source: Playlist
  patch:
    name: Mossfoot ambience
    description: Tavern background loop for sessions set at the Mossfoot Inn.
    mode: 0     # 0 = sequential, 1 = shuffle, 2 = simultaneous
    sounds:
      # Pinned _id so a rebuild compares equal and writes nothing. Without
      # it each build would mint a new id and rewrite the playlist.
      - _id: mossfootSnd00001
        name: Mossfoot common room
        path: "@vault/Mossfoot/Audio/mossfoot-tavern.ogg"
        volume: 0.6
        repeat: true
        description: 120s seamless tavern loop. bar crowd, distant patrons, hearth fire.
---

A one-track Playlist that points at [mossfoot-tavern.ogg](../Audio/mossfoot-tavern.ogg), a layered tavern ambience mixed from the [Sonniss GDC library](https://sonniss.com/gameaudiogdc/).

The `@vault/PATH` prefix in the sound's `path` becomes the path graft's `http` handler downloads the file to, the same as an image, so playback works offline and survives moving the vault between deploys.

![[mossfoot-tavern.ogg]]

| Field | Value |
|---|---|
| Mode | `fm: foundry.patch.mode` (0 = sequential) |
| Track | `fm: foundry.patch.sounds.0.name` |
| Path | `fm: foundry.patch.sounds.0.path` |
| Volume | `fm: foundry.patch.sounds.0.volume` |
| Repeat | `fm: foundry.patch.sounds.0.repeat` |
