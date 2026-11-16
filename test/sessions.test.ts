import { utimesSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderHtml } from "../src/html.js";
import { claudeLinks, cliProjectDir } from "../src/sessions.js";
import { makeTree, useTempDirs } from "./helpers.js";

const dirs = useTempDirs();

function desktopSession(id: string, cwd: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ sessionId: id, cliSessionId: "x", cwd, originCwd: cwd, title: `title ${id}`, lastActivityAt: 1000, isArchived: false, ...extra });
}

describe("claudeLinks", () => {
  it("prefers the latest non-archived desktop session in the project folder", async () => {
    const p = path.join(dirs.work(), "app");
    const desktop = process.env.FOLDEX_CLAUDE_DESKTOP_DIR!;
    makeTree(path.join(desktop, "claude-code-sessions", "acct", "org"), {
      "local_old.json": desktopSession("local_old", p, { lastActivityAt: 1000 }),
      "local_new.json": desktopSession("local_new", path.join(p, "src"), { lastActivityAt: 3000 }),
      "local_archived.json": desktopSession("local_archived", p, { lastActivityAt: 9000, isArchived: true }),
      "local_other.json": desktopSession("local_other", `${p}-two`, { lastActivityAt: 9999 }),
      "local_broken.json": "{not json",
    });
    const links = await claudeLinks([p]);
    expect(links.get(p)).toEqual({ kind: "continue", url: "claude://code/continue?session=local_new", title: "title local_new" });
  });

  it("falls back to the latest CLI session, then to a new session in the folder", async () => {
    const withCli = path.join(dirs.work(), "cli-only");
    const fresh = path.join(dirs.work(), "fresh dir");
    const cliDir = cliProjectDir(withCli);
    const older = "11111111-1111-1111-1111-111111111111";
    const newer = "22222222-2222-2222-2222-222222222222";
    makeTree(cliDir, { [`${older}.jsonl`]: "{}", [`${newer}.jsonl`]: "{}" });
    utimesSync(path.join(cliDir, `${older}.jsonl`), 1, 1);

    const links = await claudeLinks([withCli, fresh]);
    expect(links.get(withCli)).toEqual({ kind: "resume", url: `claude://resume?session=${newer}` });
    expect(links.get(fresh)).toEqual({ kind: "new", url: `claude://code/new?folder=${encodeURIComponent(fresh)}` });
  });

  it("encodes CLI folders the way Claude Code does", () => {
    expect(path.basename(cliProjectDir("/Users/me/hero-search"))).toBe("-Users-me-hero-search");
    expect(path.basename(cliProjectDir("/Users/me/my app.v2"))).toBe("-Users-me-my-app-v2");
  });
});

describe("editor links", () => {
  const base = { tech: [], tags: [], status: "experiment" as const, registered: true };

  it("shows Cursor only once a project came from Cursor, and Claude when the app is there", async () => {
    const { detectEditors } = await import("../src/html.js");
    const p = (source?: string) => ({ ...base, path: "/p", name: "p", source });
    expect(detectEditors([p("claude-code")], false)).toEqual({ claude: true, cursor: false, vscode: false });
    expect(detectEditors([p("cursor-vscode")], false)).toEqual({ claude: false, cursor: true, vscode: false });
    expect(detectEditors([p("cursor-vscode")], true)).toEqual({ claude: true, cursor: true, vscode: false });
    expect(detectEditors([p("Visual Studio Code")], false)).toEqual({ claude: false, cursor: false, vscode: true });
    expect(detectEditors([p()], false)).toEqual({ claude: false, cursor: false, vscode: false });
  });

  it("renders a cursor:// link that opens the folder", async () => {
    const { cursorUrl } = await import("../src/html.js");
    expect(cursorUrl("/Users/me/my app")).toBe("cursor://file/Users/me/my%20app");
    expect(cursorUrl("C:\\code\\app")).toBe("cursor://file/C:/code/app");
    const html = renderHtml([{ ...base, path: "/a", name: "a" }], new Map(), new Date(), { claude: false, cursor: true, vscode: true });
    expect(html).toContain("cursor://file/a");
    expect(html).toContain("vscode://file/a");
  });
});

describe("renderHtml Claude link", () => {
  it("renders only a Claude link", () => {
    const base = { tech: [], tags: [], status: "experiment" as const, registered: true };
    const links = new Map([["/a", { kind: "new" as const, url: "claude://code/new?folder=%2Fa" }]]);
    const html = renderHtml([{ ...base, path: "/a", name: "a" }], links);
    expect(html).toContain("claude://code/new?folder=%2Fa");
    expect(html).not.toMatch(/(vscode|cursor):\/\/file/);
  });
});
