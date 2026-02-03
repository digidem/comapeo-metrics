import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globalSetup: ["./global-setup.ts"],
    include: ["./**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    poolOptions: {
      workers: {
        wrangler: { configPath: "../worker/wrangler.jsonc" },
        miniflare: {
          bindings: {
            AUTH_TOKEN: "test-secret-token",
          },
        },
      },
    },
  },
});
