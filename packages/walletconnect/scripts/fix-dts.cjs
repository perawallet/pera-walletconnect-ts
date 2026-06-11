/**
 * Post-build DTS fixup.
 *
 * vite-plugin-dts with rollupTypes:true pipes through api-extractor's
 * publicTrimmedFilePath, which drops the WalletConnect default-export class
 * (a known api-extractor limitation with default exports). This script
 * re-runs the extraction using untrimmedFilePath so the class is preserved
 * in the published dist/index.d.ts.
 */
"use strict";

const { execSync } = require("node:child_process");
const { copyFileSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");

// api-extractor is a transitive dep of vite-plugin-dts; resolve it from the
// pnpm package tree (vite-plugin-dts is the parent package).
const viteDtsDir = resolve(
  require.resolve("vite-plugin-dts", { paths: [resolve(__dirname, "..")] }),
  "../..",
);
const apiExtractorPath = require.resolve("@microsoft/api-extractor", {
  paths: [viteDtsDir],
});
const { Extractor, ExtractorConfig } = require(apiExtractorPath);

const pkgDir = resolve(__dirname, "..");
const rawDtsDir = resolve(pkgDir, ".dts-raw");

// 1. Emit raw (un-rolled) declaration files via tsc.
mkdirSync(rawDtsDir, { recursive: true });
execSync(
  `node_modules/.bin/tsc --noEmit false --emitDeclarationOnly` +
    ` --declaration --declarationDir ${rawDtsDir}` +
    ` --outDir ${rawDtsDir}`,
  { cwd: pkgDir, stdio: "pipe" },
);

// 2. Re-roll each entry via api-extractor's untrimmedFilePath.
function rollDts(entryDts, outFile) {
  const configObject = {
    projectFolder: pkgDir,
    mainEntryPointFilePath: entryDts,
    compiler: { tsconfigFilePath: resolve(pkgDir, "tsconfig.json") },
    apiReport: { enabled: false, reportFileName: "report.api.md" },
    docModel: { enabled: false },
    dtsRollup: { enabled: true, untrimmedFilePath: outFile },
    tsdocMetadata: { enabled: false },
    messages: {
      compilerMessageReporting: { default: { logLevel: "none" } },
      extractorMessageReporting: { default: { logLevel: "none" } },
    },
  };
  const cfg = ExtractorConfig.prepare({
    configObject,
    configObjectFullPath: resolve(pkgDir, "api-extractor.json"),
    packageJsonFullPath: resolve(pkgDir, "package.json"),
  });
  Extractor.invoke(cfg, {
    localBuild: true,
    showVerboseMessages: false,
    showDiagnostics: false,
  });
}

rollDts(resolve(rawDtsDir, "src/index.d.ts"), resolve(pkgDir, "dist/index.d.ts"));
rollDts(resolve(rawDtsDir, "src/types/index.d.ts"), resolve(pkgDir, "dist/types/index.d.ts"));

// 3. Refresh .d.cts companions.
copyFileSync(resolve(pkgDir, "dist/index.d.ts"), resolve(pkgDir, "dist/index.d.cts"));
copyFileSync(resolve(pkgDir, "dist/types/index.d.ts"), resolve(pkgDir, "dist/types/index.d.cts"));

console.log("DTS fixup complete.");
