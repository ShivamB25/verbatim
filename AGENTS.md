# AGENTS.md

Guidance for AI coding agents (and humans) working in **verbatim** — a transparent 1:1 HTTP proxy on Cloudflare Workers.

## TL;DR

- **Runtime:** Cloudflare Workers (`workerd`, V8 isolates). Not Node, not Bun-server.
- **Framework:** [Hono](https://hono.dev) (Web Standards).
- **Language:** TypeScript, strict mode.
- **Toolchain / package manager:** **Bun**. Use `bun`, never `npm`/`yarn`/`pnpm`.
- **The whole Worker lives in `src/index.ts`.** Keep it that way unless a change genuinely warrants splitting.

## Commands

```bash
bun install        # install deps
bun run dev        # wrangler dev — local workerd at http://localhost:8787
bun run test       # vitest inside the real workerd runtime
bun run typecheck  # tsc --noEmit (scoped to src/)
bun run deploy     # wrangler deploy (needs `wrangler login`)
```

Always run `bun run typecheck` and `bun run test` before committing.

## The one rule: stay verbatim

This proxy must forward requests and responses **byte-for-byte**. Before changing anything in the request/response path, make sure you are not breaking fidelity. The invariants:

1. **Never buffer bodies.** Stream with `new Response(upstream.body, …)` and pass `c.req.raw.body` through. Do not call `.text()` / `.arrayBuffer()` / `.json()` on proxied bodies — it breaks streaming and risks the 128 MB memory limit.
2. **Don't re-encode payloads.** We send `Accept-Encoding: br, gzip` upstream and pass the compressed bytes plus the `Content-Encoding` header through untouched. Do not read/transform the body, or the encoding header and bytes will desync.
3. **Strip hop-by-hop headers** on both directions (`HOP_BY_HOP_HEADERS` set in `src/index.ts`). These are per-transport-hop, not end-to-end (RFC 7230 §6.1).
4. **Strip the proxy's own identity** from the upstream request: `Host` and `cf-*` headers. The runtime sets the correct `Host` from the target URL.
5. **Preserve** status, `statusText`, and end-to-end response headers exactly.
6. **Redirects** default to `redirect: 'manual'` so 3xx pass through 1:1. Only follow when `FOLLOW_REDIRECTS === 'true'`.

## URL extraction — read before touching `extractTargetUrl`

Two input forms, and the distinction is load-bearing:

- **Path style** (`/https://target/...`): used whenever `pathname !== '/'`. The target is sliced from the **raw** URL string (not the parsed `pathname`) so encoding and the target's own query string survive untouched.
- **Query style** (`/?url=...`): used **only** at the root path (`pathname === '/'`).

⚠️ **Gotcha:** the query form is root-only on purpose. A path-style target can carry its *own* `?url=` (e.g. `/https://host/redirect-to?url=https://example.com`). If you make `?url=` win unconditionally, you'll proxy the wrong URL. There is a test covering exactly this — keep it green.

Only `http:` and `https:` schemes are accepted (`safeParseHttpUrl`).

## Security

- `ALLOWED_HOSTS` (env var) is a comma-separated allowlist of target hostnames. **Empty = open proxy** (relays anywhere). Don't change the default silently; if you touch host checks, keep `isHostAllowed` and its semantics intact.
- Don't add logging that captures request bodies, auth headers, or cookies.

## Conventions

- TypeScript strict; no `any`. Prefer small pure helpers (see the existing ones).
- Env vars are **always strings** in Workers — compare against `'true'` / `'false'`, never truthiness of the raw value.
- Match the existing comment density and style. Comments explain *why*, not *what*.
- Keep dependencies minimal; this is a tiny Worker. Justify any new dependency.

## Testing

- Tests run in the **real workerd runtime** via `@cloudflare/vitest-pool-workers` (not Node), so `fetch`/`Response`/streams behave like production.
- `@cloudflare/vitest-pool-workers` and `vitest` versions are **pinned and matched** (pool-workers `0.5.x` ↔ vitest `2.1.x`). If you bump one, bump the other to a compatible pair, or the `/config` export / runtime will break.
- Some tests hit real hosts (`example.com`, `httpbin.org`) to prove end-to-end fidelity. Keep at least one real round-trip test.

## Git / repo hygiene

- This is a **public** repo. Don't commit secrets, `.dev.vars`, tokens, or internal tooling files.
- Do **not** add AI co-author trailers or attribution to commits.
- Conventional, descriptive commit messages.

## Deploying

- `bun run deploy` runs `wrangler deploy`. Worker name is `verbatim` (in `wrangler.jsonc`).
- The bundled test runtime may warn that it doesn't support the newest `compatibility_date` — that's a test-pool-only warning; production Wrangler supports it.
