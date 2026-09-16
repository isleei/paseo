#!/usr/bin/env node
/**
 * Re-signs an unsigned (ad-hoc) Paimon/Electron .app so it launches on
 * macOS versions that enforce Team ID binding for Electron Framework.
 *
 * Background: ad-hoc signatures carry no Team ID, and dyld aborts the launch
 * with "different Team IDs" when the main executable or any Helper loads the
 * framework. Adding disable-library-validation to the ad-hoc entitlements
 * relaxes exactly that check. Release builds are unaffected — CI signs with a
 * real Developer ID instead and must never run this script.
 *
 * Usage: node ./scripts/fixup-adhoc-signature.mjs <path-to-.app>
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sign(binary, entitlements) {
  execFileSync("codesign", ["--force", "--sign", "-", "--entitlements", entitlements, binary], {
    stdio: "inherit",
  });
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("[fixup-adhoc-signature] macOS only");
  }
  const appPath = process.argv[2];
  if (!appPath || !appPath.endsWith(".app")) {
    throw new Error("Usage: fixup-adhoc-signature.mjs <path-to-.app>");
  }
  const contents = path.join(appPath, "Contents");
  const mainPlist = path.join(__dirname, "adhoc-entitlements", "entitlements.mac.adhoc.plist");
  const inheritPlist = path.join(
    __dirname,
    "adhoc-entitlements",
    "entitlements.mac.inherit.adhoc.plist",
  );

  const frameworksPath = path.join(contents, "Frameworks");
  const helperApps = fs
    .readdirSync(frameworksPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && / Helper(?: \(.+\))?\.app$/.test(entry.name))
    .map((entry) => path.join(frameworksPath, entry.name));
  if (helperApps.length === 0) {
    throw new Error(`[fixup-adhoc-signature] no Electron Helper apps found in ${frameworksPath}`);
  }

  for (const helperApp of helperApps) {
    sign(helperApp, inheritPlist);
  }
  sign(appPath, mainPlist);

  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`[fixup-adhoc-signature] ${appPath} re-signed for local launch`);
}

main();
