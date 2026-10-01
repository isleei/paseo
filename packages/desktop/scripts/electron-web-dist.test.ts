import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { inspectElectronWebDist, assertCompleteElectronWebDist } =
  require("./electron-web-dist.js") as {
    inspectElectronWebDist: (webDistDir: string) => { complete: boolean; reason?: string };
    assertCompleteElectronWebDist: (webDistDir: string) => void;
  };

const createdDirs: string[] = [];

function makeDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "electron-web-dist-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("electron web dist completeness", () => {
  it("rejects a public-only export with no JS bundle", () => {
    const dir = makeDist();
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head><title>%WEB_TITLE%</title></head><body><div id="root"></div></body></html>\n`,
    );

    expect(inspectElectronWebDist(dir)).toEqual({
      complete: false,
      reason: `${dir}/index.html has no Expo JS bundle; expo export copied public/ but did not finish bundling`,
    });
    expect(() => assertCompleteElectronWebDist(dir)).toThrow(/Incomplete Electron web export/);
  });

  it("accepts an export whose HTML references the Expo JS bundle", () => {
    const dir = makeDist();
    mkdirSync(join(dir, "_expo/static/js/web"), { recursive: true });
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head><script src="/_expo/static/js/web/index-abc.js" defer></script></head><body><div id="root"></div></body></html>\n`,
    );

    expect(inspectElectronWebDist(dir)).toEqual({ complete: true });
    expect(() => assertCompleteElectronWebDist(dir)).not.toThrow();
  });
});
