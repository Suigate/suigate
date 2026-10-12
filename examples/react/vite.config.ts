import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: true } },
  },
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@mysten/sui",
      "@mysten/dapp-kit-react",
      "@mysten/dapp-kit-core",
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["../../packages/react/test/setup.ts"],
    include: ["test/**/*.test.tsx"],
    restoreMocks: true,
  },
});
