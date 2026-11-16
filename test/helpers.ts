import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

/** Creates files under `root`; keys are relative paths, values file contents. */
export function makeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** Fresh temp workspace and FOLDEX_HOME for each test. */
export function useTempDirs(): { work: () => string; home: () => string } {
  let work = "";
  let home = "";
  beforeEach(() => {
    work = mkdtempSync(path.join(os.tmpdir(), "foldex-work-"));
    home = mkdtempSync(path.join(os.tmpdir(), "foldex-home-"));
    process.env.FOLDEX_HOME = home;
    // Keep tests away from the real Claude app data.
    process.env.FOLDEX_CLAUDE_DESKTOP_DIR = path.join(home, "claude-desktop");
    process.env.CLAUDE_CONFIG_DIR = path.join(home, "claude-code");
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    delete process.env.FOLDEX_HOME;
    delete process.env.FOLDEX_CLAUDE_DESKTOP_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
  });
  return { work: () => work, home: () => home };
}
