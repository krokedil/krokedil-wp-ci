import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["integration/snapshot/**/*"],
  },
});
