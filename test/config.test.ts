import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIVE_ACK_PHRASE, loadConfig } from "../src/config.js";
import { defaultProfiles, newProfile, saveProfiles } from "../src/bee-profiles.js";
import type { Settings } from "../src/settings.js";

describe("paper-only local config", () => {
  it("defaults to a deterministic chooser, paper execution, empty credentials, and loopback", () => {
    expect(loadConfig({})).toMatchObject({
      mode: "dry", creds: {}, hive: { url: "" }, update: { enabled: false },
      server: { bind: "127.0.0.1" }, jev: { provider: "code", apiKey: "", model: "code" },
    });
  });

  it("rejects mode flags, broker keys, all remote model credentials, and legacy settings keys without echoing values", () => {
    const secret = "must-never-be-printed";
    const unsafe = [
      { MODE: "live" }, { MODE: "demo" }, { DRY_RUN: "false" }, { DRY_RUN: "off" }, { LIVE_ACK: LIVE_ACK_PHRASE },
      { OKX_API_BASE: "https://attacker.example" },
      { BEE2_OKX_API_SECRET: secret }, { BEE1_OKX_DEMO_API_KEY: secret }, { BEE_CUSTOM_OKX_API_KEY: secret }, { OKX_API_KEY: secret },
      { GEMINI_API_KEY: secret }, { TYPESAFE_API_KEY: secret }, { OPENAI_API_KEY: secret },
      { ALERT_WEBHOOK_URL: `https://example.test/${secret}` }, { BEEKEEPER_WEBHOOK_URL: `https://example.test/${secret}` },
      { LAB_SECRET: secret },
    ];
    for (const env of unsafe) {
      let message = "";
      try { loadConfig(env); } catch (err) { message = (err as Error).message; }
      expect(message).toMatch(/paper-only fork refuses execution settings/i);
      expect(message).not.toContain(secret);
    }
    expect(() => loadConfig({}, { geminiKey: secret } as never)).toThrow(/settings\.geminiKey/);
    expect(() => loadConfig({}, { jevKey: secret } as never)).toThrow(/settings\.jevKey/);
  });

  it("uses a container-network bind only when explicitly marked by the local Compose service", () => {
    expect(loadConfig({ ENGINE_BIND: "0.0.0.0" }).server.bind).toBe("127.0.0.1");
    expect(loadConfig({ PAPER_CONTAINER_BIND: "true" }).server.bind).toBe("127.0.0.1");
    expect(loadConfig({ NODE_ENV: "production", PAPER_CONTAINER_BIND: "true" }).server.bind).toBe("0.0.0.0");
    expect(loadConfig({ PAPER_CONTAINER_BIND: "false" }).server.bind).toBe("127.0.0.1");
  });

  it("keeps the host shadow off by default and pins its endpoint identity", () => {
    expect(loadConfig({}).localShadow).toMatchObject({ enabled: false, transport: "host-loopback", socketPath: "/run/beebots-decider/decider.sock" });
    expect(() => loadConfig({ LOCAL_SHADOW_ENABLED: "true", PAPER_CONTAINER_BIND: "true" })).toThrow(/unix-socket/i);
    expect(() => loadConfig({ LOCAL_SHADOW_TRANSPORT: "http://elsewhere" })).toThrow(/LOCAL_SHADOW_TRANSPORT/i);
    expect(() => loadConfig({ LOCAL_SHADOW_ENABLED: "true", PAPER_CONTAINER_BIND: "true", LOCAL_SHADOW_TRANSPORT: "host-loopback" })).toThrow(/unix-socket/i);
    expect(loadConfig({ LOCAL_SHADOW_ENABLED: "true", PAPER_CONTAINER_BIND: "true", LOCAL_SHADOW_TRANSPORT: "unix-socket" }).localShadow).toMatchObject({ enabled: true, transport: "unix-socket" });
    expect(() => loadConfig({ LOCAL_SHADOW_MODEL: "other-model" })).toThrow(/pinned/i);
    expect(loadConfig({ LOCAL_SHADOW_MODEL: "decider-4b-v2.1" }).localShadow.enabled).toBe(false);
  });

  it("keeps Setup taglines and portraits attached to bee IDs when profiles are reordered", () => {
    const dir = mkdtempSync(join(tmpdir(), "bee-config-order-"));
    try {
      const profilesPath = join(dir, "bee-profiles.json");
      const profiles = defaultProfiles();
      const extra = newProfile("Clover", "bizzy");
      profiles.profiles = [extra, profiles.profiles[2]!, profiles.profiles[0]!, profiles.profiles[1]!];
      saveProfiles(profilesPath, profiles);
      const settings: Settings = {
        version: 1, acceptedRiskAt: 1, createdAt: 1,
        bees: [
          { name: "Bizzy", style: "bizzy", tagline: "bee one tagline", rules: "", coins: [], image: true },
          { name: "Breezy", style: "breezy", tagline: "bee two tagline", rules: "", coins: [], image: false },
          { name: "Boozy", style: "boozy", tagline: "bee three tagline", rules: "", coins: [], image: true },
        ],
      };
      const cfg = loadConfig({ BEE_PROFILES_PATH: profilesPath }, settings);
      expect(cfg.beeIds).toEqual([extra.id, "bee3", "bee1", "bee2"]);
      expect(cfg.slots.bee1).toMatchObject({ tagline: "bee one tagline", customImage: true });
      expect(cfg.slots.bee2).toMatchObject({ tagline: "bee two tagline", customImage: false });
      expect(cfg.slots.bee3).toMatchObject({ tagline: "bee three tagline", customImage: true });
      expect(cfg.slots[extra.id as keyof typeof cfg.slots]).toMatchObject({ tagline: "the grinder", customImage: false });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
