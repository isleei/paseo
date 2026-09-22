#!/usr/bin/env node
// Ensures packages/app/dist (the Electron renderer export packaged as
// app-dist) is newer than every source tree the export compiles. The desktop
// `build` script packages that directory as-is, so an export predating the
// latest src change ships a renderer/daemon mismatch with no build error.
// Runs automatically as the package `prebuild` step; pass `--check` to only
// report freshness (exit 0 fresh, 2 stale) without exporting.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..");
const rootDir = resolve(desktopDir, "..", "..");
const appDir = join(rootDir, "packages", "app");

// Source trees the renderer export compiles (directly or via workspace dist).
const sourceDirs = [
  "packages/app/src",
  "packages/protocol/src",
  "packages/client/src",
  "packages/plugin/src",
  "packages/highlight/src",
].map((rel) => join(rootDir, rel));

// Workspace dists Metro resolves through package exports. A missing dist
// fails the export loudly, so treat it as stale too.
const distMarkers = ["packages/protocol/dist", "packages/client/dist"].map((rel) =>
  join(rootDir, rel),
);

const webDistDir = join(appDir, "dist");

function isWatchedFile(name) {
  // Generated outputs (regenerated on every protocol build) and tests never
  // change the renderer bundle; watching them would force an export every run.
  if (name === "node_modules" || name === ".git" || name === "generated") return false;
  if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return false;
  if (name.endsWith(".spec.ts") || name.endsWith(".spec.tsx")) return false;
  return true;
}

function eachFile(dir, onFile) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    handleEntries(current, entries, stack, onFile);
  }
}

function handleEntries(current, entries, stack, onFile) {
  for (const entry of entries) {
    if (!isWatchedFile(entry.name)) continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) stack.push(full);
    else if (entry.isFile()) onFile(full);
  }
}

function statMtimeMs(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

function newestMtimeMs(dir) {
  let newest = -1;
  eachFile(dir, (full) => {
    const mtime = statMtimeMs(full);
    if (mtime > newest) newest = mtime;
  });
  return newest;
}

function isFresh() {
  if (!existsSync(webDistDir)) return { fresh: false, reason: "packages/app/dist is missing" };
  for (const marker of distMarkers) {
    if (!existsSync(marker)) return { fresh: false, reason: `${marker} is missing` };
  }
  const distNewest = newestMtimeMs(webDistDir);
  let newestSrc = -1;
  let newestSrcFile = "";
  for (const dir of sourceDirs) {
    eachFile(dir, (full) => {
      const mtime = statMtimeMs(full);
      if (mtime > newestSrc) {
        newestSrc = mtime;
        newestSrcFile = full;
      }
    });
  }
  if (newestSrc > distNewest) {
    return { fresh: false, reason: `source newer than export: ${newestSrcFile}` };
  }
  return { fresh: true };
}

function run(cmd, args, env) {
  execFileSync(cmd, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

const checkOnly = process.argv.includes("--check");
const status = isFresh();
if (status.fresh) {
  console.log("[ensure-electron-web-dist] packages/app/dist is up to date, skipping export.");
  process.exit(0);
}
if (checkOnly) {
  console.log(`[ensure-electron-web-dist] STALE: ${status.reason}`);
  process.exit(2);
}
console.log(`[ensure-electron-web-dist] stale export (${status.reason}), rebuilding app deps...`);
run("npm", ["run", "build:app-deps"]);
// Run from packages/app like the root build:desktop target does.
console.log("[ensure-electron-web-dist] exporting Electron renderer...");
process.chdir(appDir);
execFileSync("npx", ["expo", "export", "--platform", "web"], {
  env: { ...process.env, PASEO_WEB_PLATFORM: "electron" },
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log("[ensure-electron-web-dist] export complete.");
