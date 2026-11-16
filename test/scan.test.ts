import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMeta, readmeExcerpt, scanRoots } from "../src/scan.js";
import { makeTree, useTempDirs } from "./helpers.js";

const dirs = useTempDirs();

describe("scanRoots", () => {
  it("finds projects by marker files and does not descend into them", async () => {
    const w = dirs.work();
    makeTree(w, {
      "app/package.json": "{}",
      "app/packages/inner/package.json": "{}",
      "group/tool/pyproject.toml": "",
      "group/notes/todo.txt": "not a project",
      "rusty/Cargo.toml": "",
      "dotnet/Thing.csproj": "",
    });
    const found = await scanRoots([w]);
    expect(found.map((p) => path.relative(w, p)).sort()).toEqual(["app", "dotnet", "group/tool", "rusty"]);
  });

  it("skips node_modules, hidden folders and anything deeper than maxDepth", async () => {
    const w = dirs.work();
    makeTree(w, {
      "node_modules/lib/package.json": "{}",
      ".cache/x/package.json": "{}",
      "a/b/c/d/package.json": "{}",
      "a/b/c/package.json": "{}",
    });
    const found = await scanRoots([w], 3);
    expect(found.map((p) => path.relative(w, p))).toEqual(["a/b/c"]);
  });

  it("treats a folder of projects with a stray package.json as a folder, not a project", async () => {
    const w = dirs.work();
    makeTree(w, {
      "project/package.json": "{}",
      "project/a/package.json": "{}",
      "project/b/.git/config": "",
      "project/c/go.mod": "module c",
      "project/scripts-only/agent.py": "print(1)",
      "project/empty/.DS_Store": "",
    });
    const found = (await scanRoots([w])).map((p) => path.relative(w, p)).sort();
    expect(found).toEqual(["project/a", "project/b", "project/c", "project/scripts-only"]);
  });

  it("keeps a git monorepo as one project", async () => {
    const w = dirs.work();
    makeTree(w, {
      "mono/.git/config": "",
      "mono/package.json": "{}",
      "mono/packages/a/package.json": "{}",
      "mono/packages/b/package.json": "{}",
      "mono/apps/web/package.json": "{}",
      "mono/apps/api/package.json": "{}",
      "mono/apps/cli/package.json": "{}",
    });
    expect(await scanRoots([w])).toEqual([path.join(w, "mono")]);
  });

  it("treats a root that is itself a project as one project", async () => {
    const w = dirs.work();
    makeTree(w, { "go.mod": "module x", "cmd/tool/main.go": "" });
    expect(await scanRoots([w])).toEqual([w]);
  });

  it("never treats Downloads, Desktop or Documents in the home folder as a project", async () => {
    const { isContainerFolder } = await import("../src/scan.js");
    expect(isContainerFolder(path.join(process.env.HOME!, "Downloads"))).toBe(true);
    expect(isContainerFolder(path.join(dirs.work(), "Downloads"))).toBe(false);
  });

  it("ignores roots that do not exist", async () => {
    expect(await scanRoots([path.join(dirs.work(), "nope")])).toEqual([]);
  });
});

describe("readMeta", () => {
  it("reads name, description and tech from package.json", async () => {
    const w = dirs.work();
    makeTree(w, {
      "package.json": JSON.stringify({ name: "invoice-bot", description: "Reads invoices", dependencies: { react: "1" }, devDependencies: { typescript: "5" } }),
    });
    const meta = await readMeta(w);
    expect(meta.name).toBe("invoice-bot");
    expect(meta.description).toBe("Reads invoices");
    expect(meta.tech).toEqual(expect.arrayContaining(["Node.js", "React", "TypeScript"]));
  });

  it("reads pyproject, frameworks, README and git remote", async () => {
    const w = dirs.work();
    makeTree(w, {
      "pyproject.toml": 'name = "csv-merge"\ndescription = "Merge CSVs"\ndependencies = ["pandas>=2", "fastapi"]\n',
      "README.md": "# csv-merge\n\n[![ci](x.svg)](y)\n\nMerges monthly bank CSV exports into a single Excel report.\n",
      ".git/config": '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:me/csv-merge.git\n\tfetch = +refs/heads/*\n',
      ".git/logs/HEAD": "x",
    });
    const meta = await readMeta(w);
    expect(meta.name).toBe("csv-merge");
    expect(meta.description).toBe("Merge CSVs");
    expect(meta.tech).toEqual(expect.arrayContaining(["Python", "pandas", "FastAPI"]));
    expect(meta.readme).toBe("Merges monthly bank CSV exports into a single Excel report.");
    expect(meta.remote).toBe("git@github.com:me/csv-merge.git");
    expect(meta.lastActivity).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("falls back to the folder name", async () => {
    const w = dirs.work();
    makeTree(w, { "my-script/requirements.txt": "requests\n" });
    const meta = await readMeta(path.join(w, "my-script"));
    expect(meta.name).toBe("my-script");
    expect(meta.tech).toEqual(["Python"]);
  });
});

describe("readmeExcerpt", () => {
  it("skips headings, badges, html and code, and strips markdown", () => {
    const md = '# Title\n\n<p align="center"><img src="x"></p>\n\n```sh\nnpm i\n```\n\nA **tiny** tool that [renames](http://x) photos by date.';
    expect(readmeExcerpt(md)).toBe("A tiny tool that renames photos by date.");
  });

  it("skips setext headings, list intros, bare links and template text", () => {
    expect(readmeExcerpt("LLVM Documentation\n==================\n\nInstall the dependencies:\n\nhttps://gitter.im/x?utm=badge)\n\nThe real description of this tool.")).toBe(
      "The real description of this tool.",
    );
    expect(readmeExcerpt("To make it easy for you to get started with GitLab, here's a list.")).toBeUndefined();
  });

  it("truncates long paragraphs", () => {
    const out = readmeExcerpt("word ".repeat(200), 50)!;
    expect(out.length).toBe(50);
    expect(out.endsWith("…")).toBe(true);
  });
});
