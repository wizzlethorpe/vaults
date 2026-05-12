
# Vaults

- vaults preview for pages that only contain base code is ugly (shows base code instead of rendered content).
- Stand up a foundry-side test harness. The CLI tests run end-to-end via buildSite + tmpdir vault, but instance.mjs / links.mjs / media.mjs / ids.mjs are unreachable from there — every Foundry-side fix in this branch (passthrough cache filter, audio/video src rewrite, embedded id auto-assignment, etc.) shipped without a regression test. Pure helpers (subdocId, ensureEmbeddedIds, isCacheable, the regex predicates) would be straightforward node --test fodder; the parts that touch Foundry globals (Document.create, FilePicker, game.scenes) need a Foundry mock layer.

# WANDS
