const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");

const EXECUTABLE_NAME = "Paimon";

function hasTeamIdentifier(appPath) {
  const result = spawnSync("codesign", ["-d", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }

  const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = details.match(/^TeamIdentifier=(.+)$/m);
  return result.status === 0 && match?.[1].trim() !== "not set";
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName === "darwin") {
    const appPath = path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`);
    if (!hasTeamIdentifier(appPath)) {
      execFileSync(process.execPath, [path.join(__dirname, "fixup-adhoc-signature.mjs"), appPath], {
        stdio: "inherit",
      });
    }
  }

  if (process.env.PASEO_DESKTOP_SMOKE !== "1") {
    return;
  }

  if (context.electronPlatformName !== "darwin") {
    return;
  }

  await smokePackagedDesktopApp({
    appPath: path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`),
  });
};
