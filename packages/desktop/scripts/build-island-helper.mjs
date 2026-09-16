#!/usr/bin/env node
/**
 * Compiles the macOS Agent Island Swift helper (ported from Cindy) and stages
 * it for electron-builder.
 *
 * - Input:  packages/desktop/native/agent-island/
 * - Output: packages/desktop/resources/tools/agent-island/
 *   (paseo-macos-agent-island-helper + running-agent.gif + mascots/ + sounds/)
 * - No-op (exit 0) on non-macOS: the island is darwin-only and dev mode
 *   lazy-compiles via swiftc into userData on first use.
 * - `--arch=arm64|x64|universal` (default: host arch). Universal builds each
 *   slice with an explicit `-target` triple and merges with `lipo`, mirroring
 *   Cindy's forge pipeline.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(__dirname, "..");
const NATIVE_DIR = path.join(DESKTOP_DIR, "native", "agent-island");
const DEST_DIR = path.join(DESKTOP_DIR, "resources", "tools", "agent-island");
const SOURCE = path.join(NATIVE_DIR, "macos-agent-island-helper.swift");
const BINARY_NAME = "paseo-macos-agent-island-helper";
// Island requires NSPanel hover tracking available since macOS 14 Sonoma.
const DEPLOYMENT_TARGET = "14.0";

function parseArch() {
  const flag = process.argv.find((arg) => arg.startsWith("--arch="))?.slice("--arch=".length);
  if (flag === "arm64" || flag === "x64" || flag === "universal") return flag;
  return process.arch === "arm64" ? "arm64" : "x64";
}

function targetTriple(arch) {
  const tripleArch = arch === "arm64" ? "arm64" : "x86_64";
  return `${tripleArch}-apple-macosx${DEPLOYMENT_TARGET}`;
}

function runSwiftc(src, dest, target) {
  const result = spawnSync("swiftc", ["-target", target, src, "-O", "-o", dest], {
    stdio: "inherit",
  });
  if (result.error) throw new Error(`swiftc spawn failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`swiftc failed for ${target} (exit ${result.status})`);
}

function main() {
  // Always stage the directory so electron-builder's extraResources `from`
  // resolves on every platform (empty outside macOS).
  fs.mkdirSync(DEST_DIR, { recursive: true });
  if (process.platform !== "darwin") {
    console.log("[island-helper] skipping: macOS-only (current platform has no island binary).");
    return;
  }
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`[island-helper] helper source missing at ${SOURCE}`);
  }
  const arch = parseArch();
  const dest = path.join(DEST_DIR, BINARY_NAME);

  if (arch === "universal") {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-island-helper-"));
    try {
      const slices = ["arm64", "x64"].map((sliceArch) => {
        const out = path.join(tmpDir, `${BINARY_NAME}-${sliceArch}`);
        runSwiftc(SOURCE, out, targetTriple(sliceArch));
        return out;
      });
      execFileSync("lipo", ["-create", ...slices, "-output", dest], { stdio: "inherit" });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } else {
    runSwiftc(SOURCE, dest, targetTriple(arch));
  }
  fs.chmodSync(dest, 0o755);

  for (const asset of ["running-agent.gif", "mascots", "sounds"]) {
    const src = path.join(NATIVE_DIR, asset);
    const out = path.join(DEST_DIR, asset);
    if (!fs.existsSync(src)) throw new Error(`[island-helper] asset missing at ${src}`);
    fs.rmSync(out, { recursive: true, force: true });
    fs.cpSync(src, out, { recursive: true });
  }
  const sizeMb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(2);
  console.log(`[island-helper] ${arch} -> ${dest} (${sizeMb} MB)`);
}

main();
