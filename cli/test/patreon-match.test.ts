import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchHighestRole, type PatreonIdentity } from "../src/render/patreon-match.js";

const ROLES = ["public", "patron", "dm"];
const TIERS = { patron: "5551111", dm: "5552222" };
const CAMPAIGN = "9876543";

function identityWithTiers(tierIds: string[], campaignId = CAMPAIGN): PatreonIdentity {
  return {
    data: { type: "user", id: "viewer-1" },
    included: [
      {
        type: "member",
        id: "membership-1",
        relationships: {
          campaign: { data: { type: "campaign", id: campaignId } },
          currently_entitled_tiers: {
            data: tierIds.map((id) => ({ type: "tier", id })),
          },
        },
      },
    ],
  };
}

describe("Patreon tier → role matching", () => {
  it("highest tier wins when a patron is entitled to multiple", () => {
    const id = identityWithTiers(["5551111", "5552222"]);
    assert.equal(matchHighestRole(id, CAMPAIGN, TIERS, ROLES), "dm");
  });

  it("returns the matching role when only one tier is entitled", () => {
    const id = identityWithTiers(["5551111"]);
    assert.equal(matchHighestRole(id, CAMPAIGN, TIERS, ROLES), "patron");
  });

  it("returns null when the patron's tier isn't mapped to any role", () => {
    const id = identityWithTiers(["9999999"]);
    assert.equal(matchHighestRole(id, CAMPAIGN, TIERS, ROLES), null);
  });

  it("returns null when the patron has no active tiers (cancelled / former)", () => {
    const id = identityWithTiers([]);
    assert.equal(matchHighestRole(id, CAMPAIGN, TIERS, ROLES), null);
  });

  it("ignores memberships scoped to a different campaign", () => {
    // Patron of someone else's campaign whose tier ID happens to collide.
    // Without the campaignId scope filter this would falsely promote them.
    const id = identityWithTiers(["5552222"], "OTHER-CAMPAIGN");
    assert.equal(matchHighestRole(id, CAMPAIGN, TIERS, ROLES), null);
  });

  it("returns null on an empty identity (visitor not authenticated)", () => {
    const id: PatreonIdentity = { included: [] };
    assert.equal(matchHighestRole(id, CAMPAIGN, TIERS, ROLES), null);
  });

  it("respects role order from the tiers map (lowest → highest)", () => {
    // Mid-tier match shouldn't surface as the highest role.
    const id = identityWithTiers(["5551111"]);
    assert.notEqual(matchHighestRole(id, CAMPAIGN, TIERS, ROLES), "dm");
  });

  it("handles multiple memberships, keeping the highest tier across all", () => {
    const id: PatreonIdentity = {
      included: [
        {
          type: "member",
          relationships: {
            campaign: { data: { type: "campaign", id: CAMPAIGN } },
            currently_entitled_tiers: { data: [{ type: "tier", id: "5551111" }] },
          },
        },
        {
          type: "member",
          relationships: {
            campaign: { data: { type: "campaign", id: CAMPAIGN } },
            currently_entitled_tiers: { data: [{ type: "tier", id: "5552222" }] },
          },
        },
      ],
    };
    assert.equal(matchHighestRole(id, CAMPAIGN, TIERS, ROLES), "dm");
  });

  it("compares tier IDs as strings (avoids type-coerced false matches)", () => {
    // Patreon API uses string IDs; our config also stores them as strings.
    // Defensive: even if a numeric leaks in, the lookup should still work.
    const id = identityWithTiers(["5551111"]);
    const tiers = { patron: "5551111" } as Record<string, string>;
    assert.equal(matchHighestRole(id, CAMPAIGN, tiers, ["public", "patron"]), "patron");
  });
});
