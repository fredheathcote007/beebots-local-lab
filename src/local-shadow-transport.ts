import { request as httpRequest } from "node:http";
import { LOCAL_SHADOW_RUNTIME, LOCAL_SHADOW_SOCKET_PATH, type LocalShadowTransport } from "./config.js";

export const SHADOW_MAX_REQUEST_BYTES = 64 * 1024;
export const SHADOW_MAX_RESPONSE_BYTES = 64 * 1024;
export const SHADOW_TIMEOUT_MS = 12_000;

/** Sends only to the compiled-in endpoint selected by the validated transport. */
export async function shadowFetch(
  transport: LocalShadowTransport,
  url: string,
  init: RequestInit,
  timeoutMs = SHADOW_TIMEOUT_MS,
): Promise<Response> {
  if (init.method !== "POST" || init.redirect !== "error") throw new Error("shadow transport requires POST and redirect=error");
  if (transport === "host-loopback") {
    if (url !== LOCAL_SHADOW_RUNTIME.url) throw new Error("shadow URL is not the pinned loopback endpoint");
    const body = typeof init.body === "string" ? init.body : "";
    if (Buffer.byteLength(body) > SHADOW_MAX_REQUEST_BYTES) throw new Error("shadow request exceeds size limit");
    return fetch(url, init);
  }
  if (transport !== "unix-socket" || url !== LOCAL_SHADOW_RUNTIME.url) throw new Error("shadow transport target is not permitted");
  return requestUnixSocket(LOCAL_SHADOW_SOCKET_PATH, init, timeoutMs);
}

/** Separate socket path is exposed only for isolated tests; runtime config always uses the pinned path above. */
export async function requestUnixSocket(socketPath: string, init: RequestInit, timeoutMs = SHADOW_TIMEOUT_MS): Promise<Response> {
  if (init.method !== "POST" || init.redirect !== "error") throw new Error("shadow transport requires POST and redirect=error");
  const body = typeof init.body === "string" ? init.body : "";
  if (Buffer.byteLength(body) > SHADOW_MAX_REQUEST_BYTES) throw new Error("shadow request exceeds size limit");
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error, response?: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
      if (err) reject(err); else resolve(response!);
    };
    const req = httpRequest({ socketPath, path: "/v1/systemone", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > SHADOW_MAX_RESPONSE_BYTES) {
          req.destroy(new Error("shadow response exceeds size limit"));
          return;
        }
        chunks.push(bytes);
      });
      res.on("end", () => {
        const status = res.statusCode ?? 502;
        const responseBody = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
        finish(undefined, new Response(responseBody, { status, headers: { "content-type": res.headers["content-type"] ?? "application/octet-stream" } }));
      });
      res.on("error", (err) => finish(err));
    });
    const onAbort = () => req.destroy(Object.assign(new Error("shadow request aborted"), { name: "AbortError" }));
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("shadow request timed out"), { name: "TimeoutError" })), timeoutMs);
    timer.unref?.();
    if (init.signal?.aborted) onAbort();
    else init.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => finish(err));
    req.end(body);
  });
}
