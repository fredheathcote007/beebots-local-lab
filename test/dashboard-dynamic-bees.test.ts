import { describe, expect, it } from "vitest";
import { applyProfile, BEE_NAMES, beeMeta, type Profile } from "../dashboard/src/types.js";

describe("dynamic dashboard profiles", () => {
  it("renders extra IDs with generic styling while retaining the original portrait set", () => {
    const profile: Profile = {
      setup: false, mode: "dry", links: null,
      bees: [
        { id: "bee1", name: "Bizzy", tagline: "the grinder", style: "bizzy", styleLabel: "Breakout", img: "/bees/bizzy.jpg" },
        { id: "bee2", name: "Breezy", tagline: "the calm one", style: "breezy", styleLabel: "Trend", img: "/bees/breezy.jpg" },
        { id: "bee3", name: "Boozy", tagline: "the degen", style: "boozy", styleLabel: "Momentum", img: "/bees/boozy.jpg" },
        { id: "bee_00000000-0000-4000-8000-000000000001", name: "Clover", tagline: "", style: "bizzy", styleLabel: "Breakout", img: null },
      ],
    };
    applyProfile(profile);
    expect(BEE_NAMES).toHaveLength(4);
    expect(BEE_NAMES[3]).toBe(profile.bees[3]!.id);
    expect(beeMeta(profile.bees[3]!.id)).toMatchObject({ short: "Clover", color: "var(--bee-generic)", img: expect.stringContaining("data:image/svg+xml") });
    expect(beeMeta("bee1").img).toBe("/bees/bizzy.jpg");
  });
});
