// The graft provider for a deployed vault: turn the module's one-line
// marker into entries graft can build, and resolve the references they
// carry. Everything else is fetched from the vault at build time, so
// pushing content never means reinstalling anything.

import { fetchSourceBatch, url as vaultUrl } from "./api.mjs";
import { collectRefs, byVariant, substituteRefs, isBody } from "./refs.mjs";
import { placeAssets } from "./assets.mjs";
import { referencedUuids, expandItems } from "./items.mjs";
import { tokenFor, promptForToken } from "./token.mjs";

export const PROVIDER_ID = "vaults";

/**
 * graft's progress bar, or a no-op when it is not there. Fetching happens
 * before graft has an entry to count, so without this the bar sits at 0%
 * for the slowest part of the build.
 */
function bar() {
  const p = globalThis.game?.modules?.get("graft")?.api?.progress;
  return {
    phase: (name, count) => { try { p?.phase?.(name, count); } catch { /* never fatal */ } },
    step: (message) => { try { p?.step?.(message); } catch { /* never fatal */ } },
  };
}

/**
 * A marker is the module's whole grafts.json: `[{ vault, gated }]`.
 *
 * An entry carrying an id is a built one coming back through on a later pass,
 * not a marker; treating it as one would refetch the vault every pass. An empty
 * URL is not a marker either — it would send every fetch at the current page.
 */
const isMarker = (entry) => typeof entry?.vault === "string" && !!entry.vault && !entry.id;

/** Stable directory name for a vault's cache: host and path, so two vaults on one host stay apart. */
function vaultKey(vaultUrl) {
  try {
    const u = new URL(vaultUrl);
    return `${u.hostname}${u.pathname}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  } catch { return "vault"; }
}

async function fetchEntries(vault) {
  // Through url(), which carries the bearer: fetched bare, this quietly
  // returns the public entry list with nothing marking the rest as missing.
  const res = await fetch(vaultUrl(vault, "/_foundry/grafts.json"));
  if (!res.ok) throw new Error(`GET /_foundry/grafts.json → ${res.status}`);
  const data = await res.json();
  const entries = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries)) throw new Error("the vault's grafts.json holds no entries");
  return { entries, assets: (!Array.isArray(data) && data.assets) || {} };
}

/**
 * Resolve references to a fixed point: a body is a reference, and its images
 * are named inside the HTML it resolves to, so each pass fetches what the
 * last one uncovered until a pass finds nothing new. A reference that cannot
 * be fetched is asked for once, or the loop would never settle.
 */
const MAX_PASSES = 8;

async function resolveRefs(vault, vaultId, entries, assets, io = { fetchSourceBatch, placeAssets }) {
  const resolved = new Map();
  const warnings = [];
  const attempted = new Set();

  for (let pass = 1; ; pass++) {
    const pending = new Map();
    for (const [raw, ref] of collectRefs([entries, [...resolved.values()]])) {
      if (!attempted.has(raw)) pending.set(raw, ref);
    }
    if (pending.size === 0) break;
    if (pass > MAX_PASSES) {
      // Not expected: references only nest one deep today. Reported rather
      // than looped, because a build that never finishes explains nothing.
      warnings.push({
        id: "(vault)",
        reason: `references were still appearing after ${MAX_PASSES} passes; ${pending.size} left unresolved`,
      });
      break;
    }
    for (const raw of pending.keys()) attempted.add(raw);
    await resolveRound(vault, vaultId, pending, resolved, warnings, assets, io);
    fold(resolved);
  }
  return { resolved, warnings };
}

/**
 * Replace references inside resolved values with what is already resolved.
 *
 * This is what makes a body stop naming its own images. A value is never
 * substituted into itself: a page that referenced its own body would otherwise
 * grow by a copy of itself on every pass.
 */
function fold(resolved) {
  for (const [raw, value] of resolved) {
    if (typeof value !== "string" || !value.includes("@vaults/")) continue;
    const others = new Map(resolved);
    others.delete(raw);
    resolved.set(raw, substituteRefs(value, others));
  }
}

async function resolveRound(vault, vaultId, refs, resolved, warnings, assets, io) {
  const bodies = new Map();
  const files = new Map();
  for (const [raw, ref] of refs) (isBody(ref.path) ? bodies : files).set(raw, ref);
  const ui = bar();

  if (bodies.size > 0) ui.phase("Reading pages", bodies.size);
  for (const [variant, paths] of byVariant(bodies)) {
    const list = [...paths];
    let fetched;
    try {
      fetched = await io.fetchSourceBatch(vault, list, vault.gated ? variant : null);
    } catch (err) {
      warnings.push({ id: variant, reason: `could not read page bodies (${err.message})` });
      continue;
    }
    for (const [raw, ref] of bodies) {
      if (ref.variant !== variant) continue;
      const body = fetched.get(ref.path);
      if (body === undefined) {
        warnings.push({ id: `${variant}/${ref.path}`, reason: "not served by the vault" });
      } else resolved.set(raw, body);
      ui.step(ref.path.split("/").pop());
    }
  }

  if (files.size > 0) {
    ui.phase("Downloading assets", files.size);
    const { placed, failed } = await io.placeAssets(
      vault, vaultId, byVariant(files), (name) => ui.step(name), assets);
    for (const [raw, ref] of files) {
      const local = placed.get(`${ref.variant}/${ref.path}`);
      if (local) resolved.set(raw, local);
    }
    warnings.push(...failed);
  }
}

/** Look each uuid up in the reader's world, skipping what is not an Item. */
async function resolveUuids(uuids) {
  const out = new Map();
  for (const uuid of uuids) {
    let doc = null;
    try { doc = await fromUuid(uuid); } catch { /* reported by the caller */ }
    if (doc?.documentName === "Item") out.set(uuid, doc.toObject());
  }
  return out;
}

/**
 * The providers to run again over what this one produced.
 *
 * graft runs providers from a queue, not to a fixed point: Moulinette ran
 * before this provider and saw only the marker line. The one producing the
 * references is the one that knows to send it round again.
 */
function enqueueFor(entries) {
  return JSON.stringify(entries).includes("@moulinette/") ? ["moulinette"] : [];
}

export function vaultsProvider() {
  return {
    id: PROVIDER_ID,
    label: "Wizzlethorpe Vaults",

    async hydrate(entries) {
      const markers = entries.filter(isMarker);
      if (markers.length === 0) return entries;

      const out = entries.filter((e) => !isMarker(e));
      const warnings = [];

      for (const marker of markers) {
        const vaultId = vaultKey(marker.vault);
        // A gated vault needs a bearer before anything can be read, including
        // the entry list. Asking once here beats a wall of 401s later.
        const token = marker.gated
          ? (tokenFor(marker.vault) ?? await promptForToken(marker.vault))
          : null;
        if (marker.gated && !token) {
          warnings.push({ id: marker.vault, reason: "not connected, so nothing was built from it" });
          continue;
        }
        const vault = { url: marker.vault, token, gated: !!marker.gated };

        let vaultEntries;
        let assets;
        try {
          ({ entries: vaultEntries, assets } = await fetchEntries(vault));
        } catch (err) {
          warnings.push({ id: marker.vault, reason: err.message });
          continue;
        }

        const { resolved, warnings: refWarnings } = await resolveRefs(vault, vaultId, vaultEntries, assets);
        warnings.push(...refWarnings);

        // Items a page names by uuid, resolved from the reader's own installed
        // compendiums. This cannot happen at build time: the CLI has no
        // Foundry, and which compendiums exist is a fact about the reader.
        const { patched, warnings: itemWarnings } = expandItems(
          vaultEntries, await resolveUuids(referencedUuids(vaultEntries)));
        warnings.push(...itemWarnings);

        out.push(...substituteRefs(patched, resolved));
      }

      return { entries: out, warnings, enqueue: enqueueFor(out) };
    },
  };
}

export const __test = { isMarker, vaultKey, fetchEntries, bar, resolveRefs, enqueueFor };
