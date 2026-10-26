import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import type { Settings } from "../src/settings.js";
import { composeEnv, diffConfig, effectiveConfig, runtimeEffectiveConfig } from "../src/tools/effective-config.js";

const intended = JSON.parse(readFileSync(new URL("../strategies/ARGON_INTENDED.json", import.meta.url), "utf8")) as Record<string, unknown>;

describe("effective-config tool", () => {
  it("reports the deterministic local chooser and no remote integrations", () => {
    const out = effectiveConfig(composeEnv({}));
    expect(out).toMatchObject({ mode: "dry", chooser: { provider: "code", apiKeyPresent: false }, keys: { gemini: false, jev: false, openai: false }, keeper: { hookFromEnv: false }, alerts: { webhookPresent: false } });
  });

  it("rejects legacy execution and remote-service credentials in file or runtime config", () => {
    expect(() => effectiveConfig(composeEnv({ GEMINI_API_KEY: "secret-value" }))).toThrow(/GEMINI_API_KEY/);
    expect(() => effectiveConfig(composeEnv({ BEE1_OKX_API_KEY: "secret-value" }))).toThrow(/BEE1_OKX_API_KEY/);
    expect(() => runtimeEffectiveConfig({ ...composeEnv({}), TYPESAFE_API_KEY: "secret-value", SETTINGS_PATH: "/nonexistent" })).toThrow(/TYPESAFE_API_KEY/);
  });

  it("reports config differences without changing paper-only behavior", () => {
    const eff = effectiveConfig(composeEnv({ BIZZY_MAX_TRADES_PER_DAY: "1", BOOZY_SPREAD_GATE_BPS: "15", MAX_FLAT_MINUTES: "30" }));
    expect(diffConfig(eff, intended).map((d) => d.knob)).toContain("bees.bizzy.maxTradesPerDay");
    expect(eff.mode).toBe("dry");
    expect(eff.chooser).toMatchObject({ provider: "code", apiKeyPresent: false });
  });

  it(".env.example keeps its empty optional secrets and compose defaults safe", () => {
    const example = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));
    const env = composeEnv(example);
    expect(effectiveConfig(env)).toMatchObject({ mode: "dry", chooser: { provider: "code", apiKeyPresent: false } });
    expect(env).toMatchObject({ DRY_RUN: "true", MODE: "dry", ENGINE_PORT: "8080", PAPER_CONTAINER_BIND: "true" });
  });

  it("rejects chooser keys persisted in a legacy Setup file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bees-effcfg-"));
    const path = join(dir, "settings.json");
    const s: Settings = { version: 1, jevKey: "jev-setup-file-value", acceptedRiskAt: 1, createdAt: 1, bees: [0, 1, 2].map((i) => ({ name: `Bee ${i}`, style: "breezy" as const, tagline: "", rules: "", coins: [], image: false })) };
    writeFileSync(path, JSON.stringify(s));
    expect(() => runtimeEffectiveConfig({ ...composeEnv({}), SETTINGS_PATH: path })).toThrow(/credential fields/);
  });

  it("rejects legacy broker credentials from settings without returning the secret value", () => {
    const dir = mkdtempSync(join(tmpdir(), "bees-effcfg-"));
    const path = join(dir, "settings.json");
    const secret = "legacy-okx-secret-must-not-leak";
    writeFileSync(path, JSON.stringify({ version: 1, acceptedRiskAt: 1, createdAt: 1, bees: [], broker: { apiKey: secret } }));
    let message = "";
    try { runtimeEffectiveConfig({ ...composeEnv({}), SETTINGS_PATH: path }); } catch (err) { message = (err as Error).message; }
    expect(message).toMatch(/credential fields/);
    expect(message).not.toContain(secret);
  });
});
