import { build } from "esbuild";

await Promise.all([
  build({
    bundle: true,
    entryPoints: ["src/server/index.ts"],
    format: "cjs",
    logLevel: "info",
    outfile: "dist/server.js",
    platform: "node",
    sourcemap: false,
    target: ["node22"],
  }),
  build({
    bundle: true,
    entryPoints: ["src/client/index.ts"],
    format: "iife",
    logLevel: "info",
    outfile: "dist/client.js",
    platform: "browser",
    sourcemap: false,
    target: ["es2021"],
  }),
]);
