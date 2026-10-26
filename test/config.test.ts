import { describe, expect, it } from "vitest";
import { LIVE_ACK_PHRASE, loadConfig } from "../src/config.js";

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
});
