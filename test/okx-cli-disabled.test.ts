import { describe, expect, it } from "vitest";
import { createOkxCli } from "../src/okx/cli.js";

describe("paper-only OKX execution boundary", () => {
  it("never forwards injected credentials to the OKX CLI and does not reveal them", async () => {
    const secret = "test-secret-that-must-not-leak";
    const cli = createOkxCli({ site: "eea", timeoutMs: 1000 });
    await expect(cli.run({
      args: ["futures", "place-order"],
      bee: "bee1",
      demo: false,
      creds: { apiKey: "test-key", secretKey: secret, passphrase: "test-passphrase" },
    })).rejects.toMatchObject({ code: "PAPER_ONLY" });
    await expect(cli.run({ args: ["account", "config"] })).rejects.toThrow(/disabled in this paper-only fork/);
    const error = await cli.run({ args: ["futures", "place-order"], creds: { apiKey: "k", secretKey: secret, passphrase: "p" } }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).not.toContain(secret);
  });
});
