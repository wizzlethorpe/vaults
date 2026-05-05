// Pure tier-to-role matching logic, extracted so tests can exercise it
// without spinning up a Pages Function. The shipped middleware in
// auth-template.ts duplicates this logic verbatim — it has to live there
// as plain JS since the worker can't import TS modules at runtime. Keep
// the two copies in sync (small enough that drift is easy to spot in
// review).

interface PatreonIncluded {
  type: string;
  id?: string;
  relationships?: {
    campaign?: { data?: { type: string; id: string } | null };
    currently_entitled_tiers?: { data?: Array<{ type: string; id: string }> };
  };
}

export interface PatreonIdentity {
  data?: { type: string; id: string };
  included?: PatreonIncluded[];
}

/**
 * Walk the visitor's identity payload, find memberships scoped to the
 * configured campaign, and return the highest-ranked role whose mapped
 * tier ID appears in the visitor's currently-entitled tiers. Returns
 * null when no tier matches — the visitor may be a patron of someone
 * else's campaign, the creator's own account viewing their own deploy,
 * or a pledge that's downgraded out of all mapped tiers.
 *
 * `roles` is the lowest→highest ordered tier list; we iterate from the
 * top down so a patron entitled to multiple tiers gets the most
 * permissive role.
 */
export function matchHighestRole(
  identity: PatreonIdentity,
  campaignId: string,
  tiers: Record<string, string>,
  roles: string[],
): string | null {
  const memberships = (identity?.included ?? []).filter((it) => it.type === "member");
  const ourCampaign = memberships.filter((m) => {
    const camp = m.relationships?.campaign?.data;
    return camp && camp.type === "campaign" && String(camp.id) === String(campaignId);
  });
  const entitled = new Set<string>();
  for (const m of ourCampaign) {
    for (const t of m.relationships?.currently_entitled_tiers?.data ?? []) {
      if (t.type === "tier") entitled.add(String(t.id));
    }
  }
  if (entitled.size === 0) return null;
  for (let i = roles.length - 1; i >= 0; i--) {
    const r = roles[i]!;
    const tier = tiers[r];
    if (tier && entitled.has(String(tier))) return r;
  }
  return null;
}
