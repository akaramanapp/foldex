import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderHtml } from "../src/html.js";
import { collectProjects, formatLine, resolveUserPath } from "../src/projects.js";
import { registerFolders } from "../src/register.js";
import { loadRecords, mutateRecords, newRecord } from "../src/store.js";
import { makeTree, useTempDirs } from "./helpers.js";

const dirs = useTempDirs();

describe("store", () => {
  it("starts empty and persists records atomically", async () => {
    expect(await loadRecords()).toEqual({});
    await mutateRecords((r) => {
      r["/x"] = newRecord("/x", "test");
    });
    const records = await loadRecords();
    expect(records["/x"]).toMatchObject({ path: "/x", status: "experiment", tags: [], source: "test" });
    expect(readdirSync(dirs.home())).toEqual(["projects.json"]);
  });

  it("keeps every write when updates run concurrently in one process", async () => {
    await Promise.all(["/a", "/b", "/c", "/d", "/e"].map((p) => mutateRecords((r) => void (r[p] = newRecord(p)))));
    expect(Object.keys(await loadRecords()).sort()).toEqual(["/a", "/b", "/c", "/d", "/e"]);
    expect(() => JSON.parse(readFileSync(path.join(dirs.home(), "projects.json"), "utf8"))).not.toThrow();
  });

  it("keeps working after a failed update", async () => {
    await expect(mutateRecords(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    await mutateRecords((r) => void (r["/ok"] = newRecord("/ok")));
    expect(Object.keys(await loadRecords())).toEqual(["/ok"]);
  });
});

describe("collectProjects", () => {
  it("merges stored records with scanned folders", async () => {
    const w = dirs.work();
    makeTree(w, { "scanned/package.json": "{}", "saved/go.mod": "module saved" });
    const saved = path.join(w, "saved");
    await mutateRecords((r) => {
      r[saved] = { ...newRecord(saved), summary: "Saves things", tags: ["io"], status: "active" };
    });

    const views = await collectProjects([path.join(w, "scanned"), saved]);
    const byPath = Object.fromEntries(views.map((v) => [v.path, v]));
    expect(byPath[path.join(w, "scanned")]).toMatchObject({ registered: false, status: "experiment" });
    expect(byPath[saved]).toMatchObject({ registered: true, summary: "Saves things", status: "active", tech: ["Go"] });
    expect(formatLine(byPath[path.join(w, "scanned")])).toContain("[no summary yet]");
  });

  it("removes the record of a deleted folder", async () => {
    const w = dirs.work();
    makeTree(w, { "app/package.json": "{}" });
    const app = path.join(w, "app");
    await mutateRecords((r) => void (r[app] = { ...newRecord(app), summary: "An app" }));
    expect((await collectProjects([])).map((v) => v.path)).toEqual([app]);

    rmSync(app, { recursive: true });
    expect(await collectProjects([])).toEqual([]);
    expect(await loadRecords()).toEqual({});
  });

  it("hides but keeps a project whose drive is unplugged (parent folder gone too)", async () => {
    const w = dirs.work();
    const onDrive = path.join(w, "Volumes", "External", "photo-tool");
    await mutateRecords((r) => void (r[onDrive] = { ...newRecord(onDrive), summary: "Sorts photos" }));

    expect(await collectProjects([])).toEqual([]);
    expect((await loadRecords())[onDrive]?.summary).toBe("Sorts photos");

    makeTree(onDrive, { "package.json": "{}" });
    expect((await collectProjects([]))[0]).toMatchObject({ path: onDrive, summary: "Sorts photos" });
  });
});

describe("registerFolders", () => {
  it("registers open folders once, even empty ones or a lone script, but skips roots", async () => {
    const w = dirs.work();
    makeTree(w, { "new-app/package.json": "{}", "fresh/.keep": "", "script/hero.js": "console.log(1)" });
    const app = path.join(w, "new-app");
    const fresh = path.join(w, "fresh");
    const script = path.join(w, "script");

    expect((await registerFolders([app, fresh, script, w], [w], "cursor")).sort()).toEqual([app, fresh, script].sort());
    expect(await registerFolders([app], [w], "cursor")).toEqual([]);
    expect((await loadRecords())[app]).toMatchObject({ source: "cursor", status: "experiment" });
    expect((await loadRecords())[app].summary).toBeUndefined();
  });

  it("skips scratch folders inside hidden directories, like Copilot's per-chat folders", async () => {
    const w = dirs.work();
    makeTree(w, { ".copilot/chats/abc/.keep": "", "visible/app/main.py": "print(1)" });
    expect(await registerFolders([path.join(w, ".copilot/chats/abc")], [])).toEqual([]);
    expect(await registerFolders([path.join(w, "visible/app")], [])).toEqual([path.join(w, "visible/app")]);
  });

  it("skips folders that only group other projects", async () => {
    const w = dirs.work();
    makeTree(w, { "experiments/a/package.json": "{}", "experiments/b/go.mod": "module b" });
    expect(await registerFolders([path.join(w, "experiments")], [])).toEqual([]);
  });

  it("skips a folder of projects even when it has a stray package.json", async () => {
    const w = dirs.work();
    makeTree(w, { "project/package.json": "{}", "project/a/package.json": "{}", "project/b/.git/config": "", "project/c/go.mod": "m" });
    expect(await registerFolders([path.join(w, "project")], [])).toEqual([]);
  });

  it("ignores folders that disappeared", async () => {
    const w = dirs.work();
    makeTree(w, { "tmp/package.json": "{}" });
    rmSync(path.join(w, "tmp"), { recursive: true });
    expect(await registerFolders([path.join(w, "tmp")], [])).toEqual([]);
  });
});

describe("rootToPath", () => {
  it("accepts file URLs and the plain paths Cursor sends, ignores remote URIs", async () => {
    const { rootToPath } = await import("../src/register.js");
    expect(rootToPath("file:///Users/me/app")).toBe("/Users/me/app");
    expect(rootToPath("/Users/me/app")).toBe("/Users/me/app");
    expect(rootToPath("vscode-remote://ssh/x")).toBeUndefined();
    expect(rootToPath("relative/path")).toBeUndefined();
  });
});

describe("resolveRoots", () => {
  it("defaults to the home folder when no roots are given", async () => {
    const { resolveRoots } = await import("../src/projects.js");
    expect(resolveRoots([])).toEqual([process.env.HOME]);
    expect(resolveRoots(["~/a", "/b"])).toEqual([path.join(process.env.HOME!, "a"), "/b"]);
  });
});

describe("resolveUserPath", () => {
  it("expands ~ because MCP configs pass args without a shell", () => {
    expect(resolveUserPath("~/projects")).toBe(path.join(process.env.HOME!, "projects"));
    expect(path.isAbsolute(resolveUserPath("rel"))).toBe(true);
  });
});

describe("renderHtml", () => {
  it("embeds data without letting it break out of the script tag", () => {
    const html = renderHtml([
      { path: "/p", name: "</script><img src=x onerror=alert(1)>", tech: [], tags: [], status: "experiment", registered: true },
    ]);
    const dataBlock = html.slice(html.indexOf('id="data"'), html.indexOf("</script>", html.indexOf('id="data"')));
    expect(dataBlock).not.toContain("</script");
    expect(dataBlock).toContain("\\u003c/script>");
  });
});
