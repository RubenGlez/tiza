import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: false,
    sourcemap: true,
  },
  {
    entry: ["src/server.ts"],
    format: ["cjs"],
    outExtension: () => ({ js: ".js" }),
    clean: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
