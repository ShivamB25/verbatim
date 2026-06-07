# Cloudflare Proxy Worker

A transparent **1:1 HTTP proxy** that runs on **Cloudflare Workers**. Pass it any URL and it forwards the request to that origin and streams the response straight back — same method, headers, body, status, and compressed bytes — nothing rewritten.

- **Runtime:** Cloudflare Workers (`workerd`, V8 isolates)
- **Framework:** [Hono](https://hono.dev) (Web-Standards, tiny, fast)
- **Toolchain:** [Bun](https://bun.com) for install/scripts; deploy via Wrangler

> Why TypeScript + Hono and not Go/Rust/Bun-server? Cloudflare Workers execute on V8 isolates — JS/TS is native there; Go and Rust only run via heavier WASM, and Bun is a *separate* runtime (not Cloudflare's). Because Hono is built on Web Standards, this exact code also runs unmodified under Bun, Deno, and Node if you ever want it to.

## How it works

The Worker is a true reverse proxy:

- Streams request **and** response bodies — never buffers (safe for large/streaming payloads).
- Strips hop-by-hop headers (`Connection`, `Transfer-Encoding`, `Upgrade`, …) per RFC 7230.
- Requests `br, gzip` from the origin and passes the compressed bytes + `Content-Encoding` through verbatim, so the payload is byte-identical.
- Drops the proxy's own `Host`/`cf-*` headers so the upstream sees a clean request.
- Preserves status, `statusText`, and all end-to-end response headers.

## Usage

Two ways to pass the target (both keep the target's own query string intact):

```
# Path style
https://<your-worker-host>/https://example.com/path?foo=bar

# Query style
https://<your-worker-host>/?url=https://example.com/path?foo=bar
```

Works with any method (GET/POST/PUT/PATCH/DELETE/…) and forwards the body.

## Develop

```bash
bun install
bun run dev        # wrangler dev — local workerd at http://localhost:8787
```

Then:

```bash
curl "http://localhost:8787/https://example.com/"
```

## Test

```bash
bun run test       # vitest inside the real workerd runtime
```

## Deploy

```bash
bun run deploy     # wrangler deploy (requires `wrangler login`)
```

## Configuration

Set in `wrangler.jsonc` under `vars` (or the Cloudflare dashboard):

| Var | Default | Meaning |
| --- | --- | --- |
| `ALLOWED_HOSTS` | `""` (any) | Comma-separated allowlist of target hostnames. Empty = open proxy. |
| `FOLLOW_REDIRECTS` | `"false"` | `"true"` follows upstream 3xx; `"false"` passes them through 1:1. |
| `ENABLE_CORS` | `"true"` | Attach permissive CORS headers for browser clients. |

> ⚠️ An open proxy (empty `ALLOWED_HOSTS`) will relay to **any** host. Set an allowlist before exposing it publicly.
