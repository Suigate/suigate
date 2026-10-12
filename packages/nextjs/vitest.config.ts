import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    pool: "forks",
    execArgv: ["--conditions=react-server"],
  },
  resolve: { conditions: ["react-server"] },
  ssr: { resolve: { conditions: ["react-server"] } },
});
