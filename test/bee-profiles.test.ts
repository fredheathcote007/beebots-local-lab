import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProfiles, newProfile, readProfiles, saveProfiles } from "../src/bee-profiles.js";

describe("staged owner bee profiles", () => {
  it("defaults to the original stable IDs and stores privately across reloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "bee-profiles-"));
    try {
      const path = join(dir, "profiles.json");
      expect(readProfiles(path).profiles.map((p) => p.id)).toEqual(["bee1", "bee2", "bee3"]);
      const ps = defaultProfiles(); ps.profiles.push(newProfile("Clover", "breezy"));
      saveProfiles(path, ps);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readProfiles(path).profiles).toHaveLength(4);
      expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects legacy credentials, collisions, and invalid profile counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "bee-profiles-"));
    try {
      const path = join(dir, "profiles.json");
      const ps = defaultProfiles(); ps.profiles.push(newProfile("Keybee", "bizzy"));
      expect(() => saveProfiles(path, { ...ps, profiles: [...ps.profiles, { ...ps.profiles[3]!, id: "bee1" }] })).toThrow(/unique/);
      expect(() => saveProfiles(path, { ...ps, profiles: ps.profiles.slice(0, 2) })).toThrow();
      // Strict v2 schema fails closed rather than accepting a legacy credential field.
      writeFileSync(path, JSON.stringify({ ...ps, geminiKey: "private" }));
      expect(() => readProfiles(path)).toThrow(/invalid/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("requires every original portfolio to remain present and active, regardless of order", () => {
    const dir = mkdtempSync(join(tmpdir(), "bee-profiles-required-"));
    try {
      const path = join(dir, "profiles.json"), base = defaultProfiles();
      const missingBee1 = { ...base, profiles: [...base.profiles.slice(1), newProfile("Clover", "bizzy")] };
      expect(() => saveProfiles(path, missingBee1)).toThrow(/bee1 must be present and active/);
      const archivedBee2 = { ...base, profiles: base.profiles.map((p) => p.id === "bee2" ? { ...p, active: false } : p) };
      expect(() => saveProfiles(path, archivedBee2)).toThrow(/bee2 must be present and active/);

      const profiles = [...base.profiles].reverse();
      saveProfiles(path, { ...base, profiles });
      expect(readProfiles(path).profiles.map((p) => p.id)).toEqual(["bee3", "bee2", "bee1"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects nested unknown fields and reuses Setup reserved-name checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "bee-profiles-"));
    try {
      const path = join(dir, "profiles.json"), ps = defaultProfiles();
      const nested = { ...ps, profiles: [...ps.profiles, { id: "bee_00000000-0000-4000-8000-000000000001", name: "Clover", style: "bizzy" as const, rules: "", coins: [], active: true, apiKey: "secret" }] };
      expect(() => saveProfiles(path, nested as never)).toThrow();
      const reserved = { ...ps, profiles: [...ps.profiles, { id: "bee_00000000-0000-4000-8000-000000000001", name: "Bizzie Bee", style: "bizzy" as const, rules: "", coins: [], active: true }] };
      expect(() => saveProfiles(path, reserved)).toThrow(/reserved/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses symlink profile paths for reads and writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "bee-profiles-"));
    try {
      const target = join(dir, "target.json"), path = join(dir, "profiles.json");
      writeFileSync(target, JSON.stringify(defaultProfiles())); symlinkSync(target, path);
      expect(() => readProfiles(path)).toThrow(/symlink/);
      expect(() => saveProfiles(path, defaultProfiles())).toThrow(/symlink/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
