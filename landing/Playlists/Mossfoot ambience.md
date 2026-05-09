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
        path: https://test.vaults.wizzlethorpe.com/Audio/tavern-jingle.ogg
        volume: 0.6
        repeat: true
        description: A 17 KB OGG looped behind tavern scenes.
---

A one-track Playlist that points at the same [tavern-jingle.ogg](../Audio/tavern-jingle.ogg)
referenced from [[Features/Passthrough files]]. The Foundry module currently
syncs images into a per-vault local cache but does **not** mirror audio,
so the playlist sound's `path` has to be a URL Foundry can reach. The
demo uses this vault's deploy URL directly; if you fork the landing and
deploy it elsewhere, swap the URL.

| Field | Value |
|---|---|
| Mode | `fm: foundry.data.mode` (0 = sequential) |
| Track | `fm: foundry.data.sounds.0.name` |
| Path | `fm: foundry.data.sounds.0.path` |
| Volume | `fm: foundry.data.sounds.0.volume` |
| Repeat | `fm: foundry.data.sounds.0.repeat` |
