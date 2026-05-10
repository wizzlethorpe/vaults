---
title: Mossfoot ambience
foundry:
  base: Playlist
  data:
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
        path: "@vault/Audio/mossfoot-tavern.ogg"
        volume: 0.6
        repeat: true
        description: 120s seamless tavern loop — bar crowd, distant patrons, hearth fire.
---

A one-track Playlist that points at [mossfoot-tavern.ogg](../Audio/mossfoot-tavern.ogg),
a layered tavern ambience mixed from the Sonniss GDC library via the
workspace's audio-mixer tool (bar-perspective crowd chatter at full
volume, distant beer-garden voices highpassed to sit behind, and a
hearth-fire crackle for the inn's fireplace; loudness-normalised to
-28 LUFS with a 6-second crossfade so the loop seam is inaudible).

The `@vault/PATH` prefix in the sound's `path` tells the Foundry sync to
rewrite to a local cache URL, so the audio file is downloaded into the
per-vault asset cache the same way images are; playback works offline
and survives moving the vault between deploys.

![[mossfoot-tavern.ogg]]

| Field | Value |
|---|---|
| Mode | `fm: foundry.data.mode` (0 = sequential) |
| Track | `fm: foundry.data.sounds.0.name` |
| Path | `fm: foundry.data.sounds.0.path` |
| Volume | `fm: foundry.data.sounds.0.volume` |
| Repeat | `fm: foundry.data.sounds.0.repeat` |
