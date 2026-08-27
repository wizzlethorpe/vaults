// Resolving `@moulinette/...` asset references against the reader's own
// Moulinette library.
//
// The point is composition without redistribution: a vault can point a Scene
// background at The MAD Cartographer's map and a Playlist at Michael Ghelfi's
// ambience, ship neither, and let each reader's own subscriptions decide what
// they get. Same principle as `foundry.base` naming a compendium UUID.
//
// Reference form:
//
//   @moulinette/<pack_ref>/<filepath>
//   @moulinette/10698/scenes/abandoned-mine-entrance.webp
//
// `pack_ref` is the number in a Moulinette marketplace URL: the module builds
// those as `/marketplace/product/<pack_ref>/<creator-slug>/<pack-slug>`, and
// only the first segment is an identifier — the two slugs are display names
// run through `.slugify()` for readability, so they change when a creator
// renames a pack. Keying on `pack_ref` + filepath means a reference stays
// valid across renames, and resolves to the same asset for every reader.
//
// This deliberately does not go through the module's public `api.searchAssets`.
// That searches, and searching is the wrong tool three times over: it matches
// against a *prettified* display name (`abandoned-mine-entrance.webp` indexes
// as "Abandoned Mine Entrance (webp)", so the filename never matches), it
// returns only the first page of 100, and it ranks by relevance, which would
// let two readers resolve one reference to different assets. Instead we read
// the same index the browser reads — `/all-assets`, which the cached cloud
// collection loads once into `cache.allAssets` — and match exactly.
//
// Everything here is best-effort. A reader with no Moulinette module, no
// subscription, or an asset that has moved gets an unresolved reference, and
// the caller drops the field rather than failing the sync.

export const MOULINETTE_PREFIX = "@moulinette/";

/** The collection that fetches `/all-assets`: the reader's whole entitled index. */
const CACHED_COLLECTION = "mou-cloud-cached";

/**
 * Parse a reference into `{ pack, file }`, or null when it isn't one.
 * The file segment keeps its slashes: creators nest folders inside a pack.
 */
export function parseMoulinetteRef(s) {
  if (typeof s !== "string" || !s.startsWith(MOULINETTE_PREFIX)) return null;
  const [pack, ...fileParts] = s.slice(MOULINETTE_PREFIX.length).split("/");
  const file = fileParts.join("/");
  if (!pack || !file) return null;
  return { pack, file };
}

/**
 * The reader's asset index, loaded once. Returns null when Moulinette isn't
 * installed, or when its internals have moved far enough that we can't read
 * them — `collections` and `cache` are not a public API, so this checks for
 * what it needs rather than assuming.
 */
async function loadIndex(log) {
  const mod = game.modules?.get("moulinette");
  if (!mod?.active) return null;
  const collection = mod.collections?.find((c) => c.getId?.() === CACHED_COLLECTION);
  if (!collection?.initialize || !collection.selectAsset) {
    log("Moulinette is installed but its asset index is not where we expect; skipping");
    return null;
  }
  try {
    // Populates mod.cache.allAssets; a no-op once it is warm.
    await collection.initialize();
  } catch (err) {
    log(`could not load the Moulinette index: ${err?.message ?? err}`);
    return null;
  }
  // `cache.allAssets` carries no contract, so its shape is checked rather than
  // assumed. `?? []` would cover an absent index but not a changed one, and a
  // non-array reaching `.find()` throws — which is the one thing this module
  // promises never to do to a sync.
  const assets = mod.cache?.allAssets;
  if (!Array.isArray(assets)) {
    log("Moulinette's asset index is not a list; skipping");
    return null;
  }
  return { collection, assets };
}

/**
 * Resolve one reference to a local file path, or null.
 *
 * `selectAsset` fetches the full descriptor by id and downloads it, returning
 * where it landed. The local cloud tree is a download *cache*, not proof of
 * entitlement: an entitled reader who has never opened this asset has no file
 * yet, so resolving has to be able to fetch.
 */
async function resolveOne(ref, index, log) {
  // `find`, not `filter`: a real library is tens of thousands of assets and
  // this runs once per distinct reference. pack_ref plus filepath identifies a
  // single asset, so there is no second match worth collecting — the array was
  // left over from a multi-match warning that the index rewrite removed.
  const match = index.assets.find(
    (a) => String(a?.pack_id) === ref.pack && a?.url === ref.file,
  );
  if (!match) {
    log(`no asset ${ref.file} in pack ${ref.pack} — not subscribed, or it moved`);
    return null;
  }

  try {
    const path = await index.collection.selectAsset(match);
    // Scene and Scene Packer assets download as JSON and report no path.
    // They are documents, not media, and a data tree wants a file.
    if (!path) {
      log(`${ref.pack}/${ref.file} is not a media asset; only files can be referenced`);
      return null;
    }
    return path;
  } catch (err) {
    log(`download failed for ${ref.pack}/${ref.file}: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Resolve every `@moulinette/...` string reachable from `value`, in place.
 *
 * An unresolved reference removes what contains it: an object key is deleted,
 * an array element is dropped. That is what makes the feature degrade the way
 * it should — a scene whose ambience the reader isn't subscribed to gets no
 * ambience, rather than a Playlist pointing at a file that isn't there.
 *
 * Results are memoised per call, since one adventure tends to reference the
 * same map or track from several pages.
 *
 * @returns `{ resolved, unresolved }` counts, for the sync summary.
 */
export async function resolveMoulinetteRefs(value, warn) {
  const cache = new Map();
  const stats = { resolved: 0, unresolved: 0 };
  const seenWarnings = new Set();
  const log = (msg) => {
    if (seenWarnings.has(msg)) return;
    seenWarnings.add(msg);
    warn(msg);
  };

  // Loaded on the first reference, so a vault with none pays nothing.
  let index;
  const lookup = async (s) => {
    if (cache.has(s)) return cache.get(s);
    const ref = parseMoulinetteRef(s);
    let path = null;
    if (!ref) {
      log(`malformed reference '${s}' — expected @moulinette/<pack_ref>/<filepath>`);
    } else {
      if (index === undefined) index = await loadIndex(log);
      if (index) path = await resolveOne(ref, index, log);
    }
    cache.set(s, path);
    if (path) stats.resolved++; else stats.unresolved++;
    return path;
  };

  /**
   * Walk `node`, resolving references in place. Returns false when the node
   * itself should be discarded by its parent.
   *
   * A node that *directly* loses a key to an unresolved reference is no longer
   * viable — a Playlist sound with its `path` deleted is worse than no sound,
   * and a `background` with no `src` is worse than no background. That
   * propagates exactly one level, so the parent drops it: the array entry
   * disappears, or the key does. It deliberately does not propagate further,
   * or one unresolved ambience would discard the whole document.
   */
  const walk = async (node) => {
    if (Array.isArray(node)) {
      const kept = [];
      for (const item of node) {
        if (typeof item === "string" && item.startsWith(MOULINETTE_PREFIX)) {
          const path = await lookup(item);
          if (path) kept.push(path);
          continue;
        }
        if (await walk(item)) kept.push(item);
      }
      node.length = 0;
      node.push(...kept);
      return true;
    }
    if (node && typeof node === "object") {
      let viable = true;
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (typeof v === "string" && v.startsWith(MOULINETTE_PREFIX)) {
          const path = await lookup(v);
          if (path) node[key] = path;
          else { delete node[key]; viable = false; }
          continue;
        }
        if (!(await walk(v))) delete node[key];
      }
      return viable;
    }
    return true;
  };

  await walk(value);
  return stats;
}
