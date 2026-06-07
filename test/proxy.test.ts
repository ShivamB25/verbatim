import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src/index'

// Helper: drive the worker the way the runtime does.
async function call(path: string, init?: RequestInit) {
  const ctx = createExecutionContext()
  const req = new Request(`https://proxy.test${path}`, init)
  const res = await worker.fetch(req, env as never, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

describe('1:1 proxy worker', () => {
  it('returns 400 when no target URL is provided', async () => {
    const res = await call('/')
    expect(res.status).toBe(400)
  })

  it('rejects non-http(s) schemes', async () => {
    const res = await call('/ftp://example.com/file')
    expect(res.status).toBe(400)
  })

  it('proxies a real GET request 1:1 (path style)', async () => {
    const res = await call('/https://example.com/')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body.toLowerCase()).toContain('example domain')
  })

  it('proxies via ?url= query style', async () => {
    const res = await call('/?url=https://example.com/')
    expect(res.status).toBe(200)
  })

  it('answers CORS preflight locally', async () => {
    const res = await call('/https://example.com/', {
      method: 'OPTIONS',
      headers: { 'access-control-request-method': 'GET' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
