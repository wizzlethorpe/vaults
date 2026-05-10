---
title: Mossfoot ambience
foundry:
  base: Playlist
  data:
    name: Mossfoot ambience
    description: Tavern background loop for sessions set at the Mossfoot Inn.
    mode: 0     # 0 = sequential, 1 = shuffle, 2 = simultaneous
    sounds:
      - name: Tavern jingle
        path: "@vault/Audio/tavern-jingle.ogg"
        volume: 0.6
        repeat: true
        description: A 17 KB OGG looped behind tavern scenes.
---

A one-track Playlist that points at the same [tavern-jingle.ogg](../Audio/tavern-jingle.ogg)
referenced from [[Features/Passthrough files]]. The `@vault/PATH` prefix
in the sound's `path` tells the Foundry sync to rewrite to a local cache
URL — the audio file is downloaded into the per-vault asset cache the
same way images are, so playback works offline and survives moving the
vault between deploys.

| Field | Value |
|---|---|
| Mode | `fm: foundry.data.mode` (0 = sequential) |
| Track | `fm: foundry.data.sounds.0.name` |
| Path | `fm: foundry.data.sounds.0.path` |
| Volume | `fm: foundry.data.sounds.0.volume` |
| Repeat | `fm: foundry.data.sounds.0.repeat` |
