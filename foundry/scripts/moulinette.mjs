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
//   @moulinette/<type>/<creator>/<pack>/<file>
//   @moulinette/audio/Michael Ghelfi/Ambiences/Tavern (Loop).ogg
//
// Only `map`, `image` and `audio` are supported, because those are the three
// types Moulinette's own public API accepts. Documents (Actor, Item, Scene-as-
// JSON) are deliberately excluded: reaching them means an integer asset id and
// an internal drag/drop path, and the cloud API truncates a malformed id at
// the first non-digit and returns a *different* asset rather than erroring —
// a reference that drifts would silently import someone else's content.
//
// Everything here is best-effort. A reader with no Moulinette module, no
// subscription, or an asset that has moved gets an unresolved reference, and
// the caller drops the field rather than failing the sync.

/** Moulinette's numeric asset-type enum, for the three types we resolve. */
const ASSET_TYPES = { map: 2, image: 3, audio: 7 };

export const MOULINETTE_PREFIX = "@moulinette/";

/**
 * Parse a reference into its parts, or null when it isn't one / is malformed.
 * The file segment may itself contain slashes: creators nest their packs.
 */
export function parseMoulinetteRef(s) {
  if (typeof s !== "string" || !s.startsWith(MOULINETTE_PREFIX)) return null;
  const rest = s.slice(MOULINETTE_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length < 4) return null;
  const [typeRaw, creator, pack, ...fileParts] = parts;
  const type = ASSET_TYPES[String(typeRaw).toLowerCase()];
  if (!type || !creator || !pack || fileParts.length === 0) return null;
  return { type, typeName: String(typeRaw).toLowerCase(), creator, pack, file: fileParts.join("/") };
}

/** The Moulinette module, or null when it isn't installed / active. */
function moulinette() {
  const mod = game.modules?.get("moulinette");
  return mod?.active && mod.api ? mod : null;
}

/**
 * Resolve one reference to a local file path, or null.
 *
 * Search *locates*; the exact creator + pack + filename comparison *decides*.
 * Matching on search relevance alone would let two readers resolve the same
 * reference to different assets, which for a shared adventure is worse than
 * not resolving at all.
 */
async function resolveOne(ref, log) {
  const mod = moulinette();
  if (!mod) return null;

  let results;
  try {
    // Search on the bare filename: Moulinette matches on terms, and the
    // creator/pack are used to disambiguate rather than to search.
    const terms = ref.file.split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    results = await mod.api.searchAssets(terms, ref.type);
  } catch (err) {
    log(`search failed for ${ref.creator}/${ref.pack}/${ref.file}: ${err?.message ?? err}`);
    return null;
  }

  const candidates = (results?.assets ?? []).filter((a) =>
    a.creator === ref.creator
    && a.pack === ref.pack
    && typeof a.filepath === "string"
    && (a.filepath === ref.file || a.filepath.endsWith("/" + ref.file)));

  if (candidates.length === 0) {
    log(`no match for ${ref.creator} / ${ref.pack} / ${ref.file} — not subscribed, or it moved`);
    return null;
  }
  if (candidates.length > 1) {
    log(`${candidates.length} assets match ${ref.creator}/${ref.pack}/${ref.file}; using the first`);
  }

  const asset = candidates[0];
  const collection = mod.collections?.find((c) => c.getId() === asset.collection);
  if (!collection?.downloadAsset) {
    log(`collection '${asset.collection}' cannot download; Moulinette's API may have changed`);
    return null;
  }
  try {
    // The local moulinette-v2/cloud/... tree is a download *cache*, not an
    // entitlement marker: an entitled reader who has never opened this asset
    // has no local file yet, so resolving has to be able to fetch it.
    const dl = await collection.downloadAsset(asset);
    return dl?.path || null;
  } catch (err) {
    log(`download failed for ${ref.creator}/${ref.pack}/${ref.file}: ${err?.message ?? err}`);
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

  const lookup = async (s) => {
    if (cache.has(s)) return cache.get(s);
    const ref = parseMoulinetteRef(s);
    let path = null;
    if (!ref) {
      log(`malformed reference '${s}' — expected @moulinette/<map|image|audio>/<creator>/<pack>/<file>`);
    } else {
      path = await resolveOne(ref, log);
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
