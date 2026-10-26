import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestUnixSocket, shadowFetch, SHADOW_MAX_REQUEST_BYTES, SHADOW_MAX_RESPONSE_BYTES } from "../src/local-shadow-transport.js";
import { LOCAL_SHADOW_RUNTIME } from "../src/config.js";

const init = (body = "{}", signal?: AbortSignal): RequestInit => ({ method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body, ...(signal ? { signal } : {}) });
const listen = (server: ReturnType<typeof createServer>, path: string): Promise<boolean> => new Promise((resolve, reject) => {
  server.once("error", (err: NodeJS.ErrnoException) => err.code === "EPERM" ? resolve(false) : reject(err));
  server.listen(path, () => resolve(true));
});

describe("private Decider transports", () => {
  it("uses only the pinned host endpoint and refuses alternate URLs", async () => {
    let observed = "";
    const mock = (async (url: string) => { observed = url; return new Response("{}", { status: 200 }); }) as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = mock;
    try {
      await shadowFetch("host-loopback", LOCAL_SHADOW_RUNTIME.url, init());
      expect(observed).toBe("http://127.0.0.1:18009/v1/systemone");
      await expect(shadowFetch("host-loopback", "http://example.test/", init())).rejects.toThrow(/pinned/i);
      await expect(shadowFetch("unix-socket", "http://example.test/", init())).rejects.toThrow(/permitted/i);
    } finally { globalThis.fetch = original; }
  });

  it("POSTs to a mock Unix HTTP server and returns its response without redirects", async ({ skip }) => {
    const dir = mkdtempSync(join(tmpdir(), "decider-uds-")); const socket = join(dir, "model.sock");
    const server = createServer((req, res) => {
      expect(req.method).toBe("POST"); expect(req.url).toBe("/v1/systemone");
      let body = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => { expect(body).toBe('{"hello":"bee"}'); res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); });
    });
    try {
      if (!await listen(server, socket)) skip("sandbox policy denied Unix socket bind (EPERM); rerun under project supervisor");
      const response = await requestUnixSocket(socket, init('{"hello":"bee"}'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
  });

  it("fails cleanly for a missing socket, oversized bodies, oversized replies, and slow peers", async ({ skip }) => {
    const dir = mkdtempSync(join(tmpdir(), "decider-uds-fail-")); const socket = join(dir, "missing.sock");
    try {
      await expect(requestUnixSocket(socket, init())).rejects.toBeTruthy();
      await expect(requestUnixSocket(socket, init("x".repeat(SHADOW_MAX_REQUEST_BYTES + 1)))).rejects.toThrow(/size limit/i);
      const server = createServer((_req, res) => { res.writeHead(200); res.end("x".repeat(SHADOW_MAX_RESPONSE_BYTES + 1)); });
      if (!await listen(server, socket)) skip("sandbox policy denied Unix socket bind (EPERM); rerun under project supervisor");
      chmodSync(socket, 0);
      await expect(requestUnixSocket(socket, init())).rejects.toMatchObject({ code: "EACCES" });
      chmodSync(socket, 0o600);
      await expect(requestUnixSocket(socket, init(), 1000)).rejects.toThrow(/size limit/i);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(socket, { force: true });
      const slow = createServer(() => {});
      if (!await listen(slow, socket)) skip("sandbox policy denied Unix socket bind (EPERM); rerun under project supervisor");
      await expect(requestUnixSocket(socket, init(), 25)).rejects.toMatchObject({ name: "TimeoutError" });
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects a redirect status as an ordinary bounded HTTP response", async ({ skip }) => {
    const dir = mkdtempSync(join(tmpdir(), "decider-uds-redirect-")); const socket = join(dir, "model.sock");
    const server = createServer((_req, res) => { res.writeHead(302, { location: "http://127.0.0.1:18009/other" }); res.end("redirect"); });
    try {
      if (!await listen(server, socket)) skip("sandbox policy denied Unix socket bind (EPERM); rerun under project supervisor");
      const response = await requestUnixSocket(socket, init());
      expect(response.status).toBe(302);
      expect(response.redirected).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
  });
});
