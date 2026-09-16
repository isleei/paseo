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
  const appName = path.basename(appPath, ".app");
  const mainPlist = path.join(__dirname, "adhoc-entitlements", "entitlements.mac.adhoc.plist");
  const inheritPlist = path.join(
    __dirname,
    "adhoc-entitlements",
    "entitlements.mac.inherit.adhoc.plist",
  );

  sign(path.join(contents, "MacOS", appName), mainPlist);
  for (const helper of ["Helper", "Helper (GPU)", "Helper (Plugin)", "Helper (Renderer)"]) {
    sign(
      path.join(contents, "Frameworks", `${appName} ${helper}.app`, "Contents", "MacOS", `${appName} ${helper}`),
      inheritPlist,
    );
  }

  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`[fixup-adhoc-signature] ${appPath} re-signed for local launch`);
}

main();
