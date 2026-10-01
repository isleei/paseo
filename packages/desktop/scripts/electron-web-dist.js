const fs = require("node:fs");
const path = require("node:path");

function inspectElectronWebDist(webDistDir) {
  const indexPath = path.join(webDistDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return { complete: false, reason: `${webDistDir}/index.html is missing` };
  }

  const html = fs.readFileSync(indexPath, "utf8");
  if (!html.includes("_expo/static/js")) {
    return {
      complete: false,
      reason: `${webDistDir}/index.html has no Expo JS bundle; expo export copied public/ but did not finish bundling`,
    };
  }

  return { complete: true };
}

function assertCompleteElectronWebDist(webDistDir) {
  const result = inspectElectronWebDist(webDistDir);
  if (!result.complete) {
    throw new Error(`Incomplete Electron web export: ${result.reason}`);
  }
}

module.exports = {
  inspectElectronWebDist,
  assertCompleteElectronWebDist,
};
