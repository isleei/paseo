const { execFileSync } = require("node:child_process");
const path = require("node:path");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");

const EXECUTABLE_NAME = "Paimon";

function shouldFixupAdhoc() {
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    return false;
  }
  return process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false";
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName === "darwin" && shouldFixupAdhoc()) {
    const appPath = path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`);
    execFileSync(process.execPath, [path.join(__dirname, "fixup-adhoc-signature.mjs"), appPath], {
      stdio: "inherit",
    });
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
