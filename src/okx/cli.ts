// Compatibility stub for upstream utilities. Public prices use okx/public.ts; all CLI requests
// are rejected in this paper-only fork so stored or injected credentials cannot sign an order.

import type { BeeId, OkxCreds } from "../config.js";
import { redactString } from "../redact.js";

export class OkxCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OkxCliError";
  }
}

export interface CliCall {
  args: string[];
  /** Which bee's profile + keys to use. Omit for public (keyless) calls. */
  bee?: BeeId;
  creds?: OkxCreds;
  /** true = --demo (x-simulated-trading), false = --live. Demo has its own instrument ids, so public calls pass it too. */
  demo?: boolean;
}

export interface OkxCli {
  run<T = unknown>(call: CliCall): Promise<T>;
}

/** Pull an OKX error code like 51008 out of the CLI's stderr, if there is one. */
export function parseCliError(stderr: string, stdout: string): OkxCliError {
  const text = `${stderr}\n${stdout}`;
  const code = /\b(5\d{4}|50\d{3})\b/.exec(text)?.[1] ?? "CLI";
  // OKX's own reason, when the CLI prints the JSON response (the first line alone can be just "[").
  const okxMsg = /"sMsg"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? /"msg"\s*:\s*"([^"]+)"/.exec(text)?.[1];
  if (okxMsg) return new OkxCliError(code, redactString(okxMsg).slice(0, 240));
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("Error:")) ?? text.trim().split("\n")[0] ?? "okx cli failed";
  return new OkxCliError(code, redactString(line.replace(/^Error:\s*/, "")).slice(0, 240));
}

export function createOkxCli(_opts: { site: "eea"; timeoutMs: number; maxConcurrent?: number }): OkxCli {
  return {
    async run<T>(_call: CliCall): Promise<T> {
      throw new OkxCliError("PAPER_ONLY", "OKX private and demo execution is disabled in this paper-only fork");
    },
  };
}
