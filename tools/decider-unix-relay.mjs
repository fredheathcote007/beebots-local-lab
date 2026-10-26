#!/usr/bin/env node
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import process from "node:process";
import { Buffer } from "node:buffer";

// This user-owned host runtime directory is private and requires no privileged /run provisioning.
const SOCKET_DIR = "/run/user/1000/beebots-decider";
const SOCKET_PATH = `${SOCKET_DIR}/decider.sock`;
const MODEL_PATH = "/v1/systemone";
const MAX_REQUEST = 64 * 1024;
const MAX_RESPONSE = 64 * 1024;
const TIMEOUT_MS = 12_000;
const EXPECTED_UID = 1000;

if (process.getuid?.() !== EXPECTED_UID) throw new Error(`relay must run as UID ${EXPECTED_UID}`);
// Directories need owner execute permission; chmod the socket itself to 0600 after bind.
process.umask(0o077);
await mkdir(SOCKET_DIR, { recursive: true, mode: 0o700 });
const dir = await lstat(SOCKET_DIR);
if (!dir.isDirectory() || dir.uid !== EXPECTED_UID || (dir.mode & 0o777) !== 0o700) throw new Error("relay directory must be a UID 1000 directory with mode 0700");

try {
  const existing = await lstat(SOCKET_PATH);
  if (!existing.isSocket() || existing.uid !== EXPECTED_UID) throw new Error("refusing to remove unexpected socket path entry");
  await new Promise((resolve, reject) => {
    const probe = connect(SOCKET_PATH);
    probe.once("connect", () => { probe.destroy(); reject(new Error("another relay is already listening")); });
    probe.once("error", (err) => err.code === "ECONNREFUSED" || err.code === "ENOENT" ? resolve() : reject(err));
  });
  await unlink(SOCKET_PATH);
} catch (err) {
  if (err?.code !== "ENOENT") throw err;
}

const clients = new Set();
const server = createHttpServer((incoming, outgoing) => {
  if (incoming.method !== "POST" || incoming.url !== MODEL_PATH) {
    outgoing.writeHead(404, { connection: "close" }).end();
    return;
  }
  const advertised = Number(incoming.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(advertised) || advertised < 0 || advertised > MAX_REQUEST) {
    outgoing.writeHead(413, { connection: "close" }).end();
    incoming.destroy();
    return;
  }
  const chunks = [];
  let size = 0;
  let finished = false;
  const finish = (status, body, headers = {}) => {
    if (finished) return;
    finished = true;
    outgoing.writeHead(status, { "content-type": headers["content-type"] ?? "application/json", connection: "close" });
    outgoing.end(body);
  };
  incoming.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_REQUEST) {
      finish(413, "request too large");
      incoming.destroy();
      return;
    }
    chunks.push(chunk);
  });
  incoming.on("end", () => {
    if (finished) return;
    const body = Buffer.concat(chunks);
    const upstream = httpRequest({ host: "127.0.0.1", port: 18009, path: MODEL_PATH, method: "POST", headers: { "content-type": "application/json", "content-length": body.length }, timeout: TIMEOUT_MS }, (response) => {
      const answer = [];
      let answerSize = 0;
      response.on("data", (chunk) => {
        answerSize += chunk.length;
        if (answerSize > MAX_RESPONSE) {
          response.destroy();
          finish(502, "model response too large");
          return;
        }
        answer.push(chunk);
      });
      response.on("end", () => finish(response.statusCode ?? 502, Buffer.concat(answer), { "content-type": response.headers["content-type"] }));
      response.on("error", () => finish(502, "model response failed"));
    });
    const abort = () => upstream.destroy();
    outgoing.once("close", abort);
    upstream.setTimeout(TIMEOUT_MS, () => upstream.destroy(new Error("model timeout")));
    upstream.on("error", () => finish(502, "model unavailable"));
    upstream.end(body);
  });
  incoming.on("error", () => finish(400, "request failed"));
  outgoing.setTimeout(TIMEOUT_MS, () => outgoing.destroy());
});
server.on("connection", (socket) => { clients.add(socket); socket.once("close", () => clients.delete(socket)); });
server.requestTimeout = TIMEOUT_MS;
server.headersTimeout = 2_000;
server.maxHeadersCount = 16;
// The engine permits at most three in-flight model calls; bound other local clients too.
server.maxConnections = 8;
server.listen(SOCKET_PATH, () => chmod(SOCKET_PATH, 0o600).catch((err) => { process.stderr.write(`socket chmod failed: ${err}\n`); process.exitCode = 1; server.close(); }));

let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  server.close(() => unlink(SOCKET_PATH).catch(() => {}));
  for (const socket of clients) socket.destroy();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
