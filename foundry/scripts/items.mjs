// Items an entry names rather than carries.
//
// A page can stock a statblock or a merchant from compendium items instead of
// inlining them:
//
//   items:
//     - uuid: "Compendium.dnd5e.items.Item.rQ6sO7HDWzqMhSI3"
//       system: { price: { value: 50, denomination: gp }, quantity: 2 }
//
// `uuid` alone does not mark one of these: an advancement's
// `configuration.items[].uuid` is a *grant*, naming an item a character may
// later gain, and resolving those would rewrite the class rather than the
// character. `_id` is the discriminator — a reference carries the id the
// vault assigned; a grant has none.

/** Deep-merge `patch` over `target`, in place. Arrays replace. */
function merge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)
      && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      merge(target[k], v);
    } else target[k] = v;
  }
  return target;
}

/**
 * Is this a reference to an item the vault is placing?
 *
 * Both keys, and that is the whole rule: a `uuid` naming what to fetch, and an
 * `_id` saying the vault means to place it. A grant has the first and not the
 * second.
 */
export const isReference = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value)
  && typeof value.uuid === "string" && typeof value._id === "string";

/** Every reference anywhere in a value, in encounter order. */
function eachReference(value, visit) {
  if (Array.isArray(value)) {
    for (const v of value) eachReference(v, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (isReference(value)) { visit(value); return; }
  for (const v of Object.values(value)) eachReference(v, visit);
}

/** Every uuid an entry's items refer to, in order, without duplicates. */
export function referencedUuids(entries) {
  const out = [];
  const seen = new Set();
  eachReference(entries, (ref) => {
    if (!seen.has(ref.uuid)) { seen.add(ref.uuid); out.push(ref.uuid); }
  });
  return out;
}

/**
 * Replace each reference with the item it names, the page's own keys merged
 * over it.
 *
 * `resolved` maps uuid to the item's data. A uuid that is not in it drops that
 * one item and reports why: a merchant missing a ware is a better build than a
 * merchant missing entirely, and an Actor that fails to validate takes every
 * item with it.
 *
 * @returns `{ patched, warnings }`
 */
export function expandItems(entries, resolved) {
  const warnings = [];

  const expand = (value, owner) => {
    if (Array.isArray(value)) {
      const out = [];
      for (const v of value) {
        if (isReference(v)) {
          const item = resolve(v, owner, resolved, warnings);
          if (item) out.push(item);
          continue;
        }
        out.push(expand(v, owner));
      }
      return out;
    }
    if (!value || typeof value !== "object") return value;
    // The nearest thing with a name is what a warning should blame.
    const named = typeof value.name === "string" ? value.name : owner;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, expand(v, named)]));
  };

  // An entry with nothing to expand is returned as it is. Most are, and a
  // Scene carrying four hundred walls is not worth copying to change nothing.
  const patched = entries.map((entry) =>
    (referencedUuids([entry]).length > 0 ? expand(entry, undefined) : entry));
  return { patched, warnings };
}

/** One reference, as the item it names with the page's own keys over it. */
function resolve(ref, owner, resolved, warnings) {
  const { uuid, ...overrides } = ref;
  const source = resolved.get(uuid);
  if (!source) {
    warnings.push({ id: owner ?? uuid, reason: `${uuid} did not resolve; that item was skipped` });
    return null;
  }
  const data = structuredClone(source);
  // The page's `_id` wins: it is the deterministic one the entry was written
  // against, and graft merges an items array by that key.
  delete data._id;
  // What a manual compendium import records, so the item keeps a trail back to
  // its source for Foundry's own update-from-compendium.
  if (uuid.startsWith("Compendium.")) {
    data._stats = { ...data._stats, compendiumSource: uuid };
  }
  return merge(data, overrides);
}
