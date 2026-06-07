import { Hono } from 'hono'

/**
 * Environment bindings, configured in wrangler.jsonc `vars` (or the dashboard).
 * All are strings because Workers env vars are always strings.
 */
type Bindings = {
  /** Comma-separated allowlist of permitted target hostnames. Empty = allow any host. */
  ALLOWED_HOSTS?: string
  /** "true" to follow upstream redirects; otherwise 3xx are passed through 1:1. */
  FOLLOW_REDIRECTS?: string
  /** "true" to attach permissive CORS headers for browser clients. */
  ENABLE_CORS?: string
}

/**
 * Hop-by-hop headers must not be forwarded by a proxy (RFC 7230 §6.1).
 * They describe a single transport connection, not the end-to-end message.
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const app = new Hono<{ Bindings: Bindings }>()

/**
 * Extract the target URL from the incoming request.
 *
 * Two supported forms (both preserve the target's own query string exactly):
 *   1. Path style:  https://proxy.dev/https://example.com/a?b=c
 *   2. Query style: https://proxy.dev/?url=https://example.com/a?b=c
 *
 * The path style is parsed from the RAW request URL (not the parsed pathname)
 * so that encoding, `//`, and the target's query string survive untouched.
 */
function extractTargetUrl(rawUrl: string): URL | null {
  const self = new URL(rawUrl)

  // Root path → query style. We only consult `?url=` here so that a path-style
  // target carrying its OWN `?url=` (e.g. /https://host/redirect-to?url=...)
  // is never mistaken for the query form.
  if (self.pathname === '/' || self.pathname === '') {
    const viaQuery = self.searchParams.get('url')
    return viaQuery ? safeParseHttpUrl(viaQuery) : null
  }

  // Path style: everything after the leading "/", verbatim from the raw URL,
  // so the target's own encoding and query string survive untouched.
  const afterOrigin = rawUrl.slice(self.origin.length + 1)
  if (!afterOrigin) return null

  return safeParseHttpUrl(afterOrigin)
}

/** Parse a string into a URL, accepting only http(s) schemes. */
function safeParseHttpUrl(value: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed
}

/** Check the target host against the optional allowlist. Empty allowlist = open proxy. */
function isHostAllowed(host: string, allowedHosts?: string): boolean {
  if (!allowedHosts || allowedHosts.trim() === '') return true
  const allow = allowedHosts
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return allow.includes(host.toLowerCase())
}

/** Build the outbound request headers: copy client headers, drop hop-by-hop + host. */
function buildForwardHeaders(incoming: Headers): Headers {
  const out = new Headers()
  incoming.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower)) return
    // Host is set automatically by the runtime from the target URL; never forward
    // the proxy's own Host. Cloudflare injects cf-* headers we also strip for a clean 1:1.
    if (lower === 'host') return
    if (lower.startsWith('cf-')) return
    if (lower === 'x-forwarded-host' || lower === 'x-forwarded-proto') return
    out.append(key, value)
  })
  // Request compressed bytes from origin and pass them through verbatim (see below).
  out.set('accept-encoding', 'br, gzip')
  return out
}

/** Build the response headers returned to the client: strip hop-by-hop, preserve the rest. */
function buildResponseHeaders(upstream: Headers, enableCors: boolean): Headers {
  const out = new Headers()
  upstream.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return
    out.append(key, value)
  })
  if (enableCors) {
    out.set('access-control-allow-origin', '*')
    out.set('access-control-expose-headers', '*')
  }
  return out
}

app.all('*', async (c) => {
  const enableCors = c.env.ENABLE_CORS !== 'false'

  // CORS preflight — answer locally without proxying.
  if (c.req.method === 'OPTIONS' && c.req.header('access-control-request-method')) {
    if (!enableCors) return c.body(null, 204)
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': '*',
        'access-control-allow-headers':
          c.req.header('access-control-request-headers') ?? '*',
        'access-control-max-age': '86400',
      },
    })
  }

  const target = extractTargetUrl(c.req.url)

  if (!target) {
    return c.json(
      {
        error: 'Missing or invalid target URL.',
        usage: {
          path: 'https://<proxy-host>/https://example.com/path?query=1',
          query: 'https://<proxy-host>/?url=https://example.com/path',
        },
      },
      400,
    )
  }

  if (!isHostAllowed(target.hostname, c.env.ALLOWED_HOSTS)) {
    return c.json({ error: `Target host "${target.hostname}" is not allowed.` }, 403)
  }

  const followRedirects = c.env.FOLLOW_REDIRECTS === 'true'

  // Stream the request body through for non-GET/HEAD; never buffer it.
  const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'

  const init: RequestInit = {
    method: c.req.method,
    headers: buildForwardHeaders(c.req.raw.headers),
    body: hasBody ? c.req.raw.body : undefined,
    redirect: followRedirects ? 'follow' : 'manual',
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), init)
  } catch (err) {
    return c.json(
      {
        error: 'Upstream fetch failed.',
        target: target.toString(),
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
    )
  }

  // Stream the response body back without buffering. Because we requested
  // br/gzip and pass the body + Content-Encoding header through untouched,
  // the original compressed bytes are returned verbatim (true 1:1).
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream.headers, enableCors),
  })
})

export default app
