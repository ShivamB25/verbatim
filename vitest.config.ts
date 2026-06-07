import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

// Runs tests inside the real workerd runtime (not Node), so fetch/Response/streams
// behave exactly as they do in production.
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
})
