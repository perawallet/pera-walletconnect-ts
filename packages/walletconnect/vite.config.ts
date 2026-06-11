import { copyFileSync } from "node:fs";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      // Flatten declarations into one self-contained file per entry so the
      // .d.cts copies below resolve under node16/nodenext as well (no
      // extensionless relative imports left inside the emitted types).
      rollupTypes: true,
      afterBuild() {
        // Produce .d.cts companions so that CJS consumers get proper types
        // (resolves the publint warning about types being interpreted as ESM
        // when resolving with the "require" condition).
        copyFileSync("dist/index.d.ts", "dist/index.d.cts");
        copyFileSync("dist/types/index.d.ts", "dist/types/index.d.cts");
      },
    }),
  ],
  esbuild: {
    // Keep WalletConnect & co. legible in consumer stack traces.
    keepNames: true,
  },
  build: {
    target: "es2022",
    lib: {
      entry: {
        index: "src/index.ts",
        "types/index": "src/types/index.ts",
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [/^@noble\//],
      output: {
        exports: "named",
      },
    },
  },
});
