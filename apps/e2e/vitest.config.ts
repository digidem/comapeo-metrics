import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
	test: {
		include: ['./**/*.test.ts'],
		testTimeout: 30_000,
		hookTimeout: 60_000,
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'lcov'],
			all: true,
		},
		poolOptions: {
			workers: {
				wrangler: { configPath: '../worker/wrangler.jsonc' },
				miniflare: {
					bindings: {
						AUTH_TOKEN: 'test-secret-token',
					},
				},
			},
		},
	},
})
