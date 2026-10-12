import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    server: {
      deps: {
        inline: [
          /@mysten\/dapp-kit/,
          /@lit\//,
          /@lit-labs\//,
          /@nanostores\/lit/,
          /\/lit\//,
          /lit-element/,
          /lit-html/,
        ],
      },
    },
  },
  ssr: { resolve: { conditions: ["browser"] } },
  resolve: {
    conditions: ["browser"],
    dedupe: [
      "react",
      "react-dom",
      "@mysten/sui",
      "@mysten/dapp-kit-core",
      "@mysten/dapp-kit-react",
    ],
  },
});
