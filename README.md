<div align="center">

# verbatim

**A transparent 1:1 HTTP proxy on the edge.**

Give it any URL — it forwards your request to that origin and streams the response straight back. Same method, headers, body, status, and compressed bytes. Nothing rewritten. *Verbatim.*

[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Hono](https://img.shields.io/badge/framework-Hono-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![Bun](https://img.shields.io/badge/toolchain-Bun-000000?logo=bun&logoColor=white)](https://bun.com)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

---

## Why these choices

Cloudflare Workers execute on `workerd` (V8 isolates), where **JavaScript/TypeScript is native**. Go and Rust only run via heavier WASM (slower cold starts, clunkier `fetch` interop), and Bun is a *separate* runtime — not Cloudflare's. So the genuine best-practice stack for a Worker is **TypeScript + [Hono](https://hono.dev)**, a tiny Web-Standards framework.

Bonus: because Hono is built on Web Standards, this exact code also runs unmodified under **Bun, Deno, and Node**.

> **Toolchain:** [Bun](https://bun.com) handles install and scripts; deploys go out through Wrangler.

## What "1:1" actually means here

`verbatim` is a true reverse proxy, not a rewriter:

- **Streams** request *and* response bodies — never buffers, so large/streaming payloads are safe (Workers' 128 MB limit never gets near).
- **Byte-identical payloads** — it requests `br, gzip` from the origin and passes the compressed bytes plus the `Content-Encoding` header through untouched, so nothing is re-encoded.
- **Strips hop-by-hop headers** (`Connection`, `Transfer-Encoding`, `Upgrade`, `TE`, `Trailer`, …) per RFC 7230 — these describe a single transport hop, not the message.
- **Clean upstream request** — drops the proxy's own `Host` and `cf-*` headers so the origin sees the request as if it came direct.
- **Preserves** status, `statusText`, and every end-to-end response header.
- **Redirects pass through 1:1** — a `302` comes back as a `302` with its `Location` intact (configurable).

## Usage

Two ways to pass a target — both keep the target's own query string exactly:

```
# Path style — everything after the slash is the target
https://<your-worker-host>/https://example.com/path?foo=bar

# Query style — only at the root path
https://<your-worker-host>/?url=https://example.com/path?foo=bar
```

> The root-only rule for `?url=` is deliberate: it means a path-style target carrying its *own* `?url=` (e.g. `/https://host/redirect-to?url=...`) is never mistaken for the query form.

Any method works (GET / POST / PUT / PATCH / DELETE / …) and the body is forwarded.

```bash
# GET
curl "https://<your-worker-host>/https://example.com/"

# POST with a body — forwarded verbatim
curl -X POST "https://<your-worker-host>/https://httpbin.org/post" \
  -H "content-type: application/json" \
  -d '{"hello":"world"}'
```

## Develop

```bash
bun install
bun run dev        # wrangler dev — local workerd at http://localhost:8787
```

```bash
curl "http://localhost:8787/https://example.com/"
```

## Test

```bash
bun run test       # vitest, running inside the real workerd runtime
```

## Deploy

```bash
bun run deploy     # wrangler deploy  (run `wrangler login` first)
```

## Configuration

Set under `vars` in [`wrangler.jsonc`](./wrangler.jsonc) (or in the Cloudflare dashboard):

| Var | Default | Meaning |
| --- | --- | --- |
| `ALLOWED_HOSTS` | `""` (any) | Comma-separated allowlist of target hostnames. Empty = open proxy. |
| `FOLLOW_REDIRECTS` | `"false"` | `"true"` follows upstream 3xx; `"false"` passes them through 1:1. |
| `ENABLE_CORS` | `"true"` | Attach permissive CORS headers for browser clients. |

> ⚠️ **Open proxy warning:** with an empty `ALLOWED_HOSTS`, `verbatim` will relay to **any** host. Set an allowlist before exposing it publicly.

## Project layout

```
src/index.ts        # the Worker — routing, URL extraction, header rules, streaming proxy
test/proxy.test.ts  # vitest suite (runs in workerd via @cloudflare/vitest-pool-workers)
wrangler.jsonc      # Worker config + env vars
vitest.config.ts    # workers test pool config
AGENTS.md           # guide for AI coding agents working in this repo
```

## License

MIT
