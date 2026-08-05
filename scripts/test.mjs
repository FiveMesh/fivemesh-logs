import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";

const outputDirectory = await mkdtemp(join(tmpdir(), "fivemesh-logs-tests-"));
const outputFile = join(outputDirectory, "query-validation.test.mjs");

try {
  await build({
    bundle: true,
    entryPoints: ["tests/query-validation.test.ts"],
    format: "esm",
    logLevel: "silent",
    outfile: outputFile,
    platform: "node",
    target: ["node20"],
  });
  const result = spawnSync(process.execPath, ["--test", outputFile], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outputDirectory, { force: true, recursive: true });
}
