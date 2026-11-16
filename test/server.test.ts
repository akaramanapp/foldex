import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { loadRecords } from "../src/store.js";
import { makeTree, useTempDirs } from "./helpers.js";

const dirs = useTempDirs();

const opened: string[] = [];

async function connect(roots: string[], openFolders: string[] = []) {
  const server = createServer({ roots, openFile: (f) => opened.push(f) });
  const client = new Client({ name: "test-ide", version: "1.0.0" }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: openFolders.map((f) => ({ uri: pathToFileURL(f).href })),
  }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: res.content[0].text, isError: Boolean(res.isError) };
}

async function waitFor(check: () => Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out");
}

describe("MCP server", () => {
  it("exposes the tools and usage instructions", async () => {
    const client = await connect([dirs.work()]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_project", "list_pending", "list_projects", "open_index", "update_project"]);
    expect(client.getInstructions()).toContain("update_project");
  });

  it("open_index rebuilds the page and opens it", async () => {
    const w = dirs.work();
    makeTree(w, { "app/package.json": "{}" });
    opened.length = 0;
    const client = await connect([w]);
    const res = await call(client, "open_index");
    const file = path.join(dirs.home(), "index.html");
    expect(res.text).toContain("1 projects");
    expect(opened).toEqual([file]);
    expect(existsSync(file)).toBe(true);
  });

  it("auto-registers the open folder from MCP roots and writes the index page", async () => {
    const w = dirs.work();
    makeTree(w, { "fresh/package.json": "{}" });
    const fresh = path.join(w, "fresh");
    await connect([], [fresh]);
    await waitFor(async () => Boolean((await loadRecords())[fresh]));
    expect((await loadRecords())[fresh].source).toBe("test-ide");
    await waitFor(async () => existsSync(path.join(dirs.home(), "index.html")));
  });

  async function connectWithFolders(open: string[], folderSyncMs?: number) {
    const server = createServer({ roots: [], openFile: () => {}, folderSyncMs });
    const client = new Client({ name: "Visual Studio Code", version: "1" }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: open.map((f) => ({ uri: pathToFileURL(f).href })) }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    await new Promise((r) => setTimeout(r, 100));
    return client;
  }

  it("registers a folder opened after startup when the client says its folders changed", async () => {
    const w = dirs.work();
    makeTree(w, { "later/app.py": "print(1)" });
    const later = path.join(w, "later"), open: string[] = [];
    const client = await connectWithFolders(open);
    expect((await loadRecords())[later]).toBeUndefined();
    open.push(later);
    await client.sendRootsListChanged();
    await waitFor(async () => Boolean((await loadRecords())[later]));
    expect((await loadRecords())[later].source).toBe("Visual Studio Code");
  });

  it("re-checks open folders on a tool call for clients that never announce changes", async () => {
    const w = dirs.work();
    makeTree(w, { "later/app.py": "print(1)" });
    const later = path.join(w, "later"), open: string[] = [];
    const client = await connectWithFolders(open, 0);
    open.push(later);
    expect((await call(client, "list_projects")).text).toContain(later);
  });

  it("lists, summarizes, filters and fetches projects", async () => {
    const w = dirs.work();
    makeTree(w, {
      "csv-merge/requirements.txt": "pandas\n",
      "web/package.json": JSON.stringify({ name: "web", dependencies: { react: "1" } }),
      "old/go.mod": "module old",
    });
    const client = await connect([w]);

    let list = await call(client, "list_projects");
    expect(list.text).toContain("3 of 3 projects (3 without a summary");

    const csv = path.join(w, "csv-merge");
    const saved = await call(client, "update_project", { path: csv, summary: "Merges bank CSVs into Excel.", tags: ["Finance"], status: "active" });
    expect(saved.text).toContain(`Added ${csv}`);
    await call(client, "update_project", { path: path.join(w, "old"), summary: "Old thing.", status: "archived" });

    list = await call(client, "list_projects");
    expect(list.text).toContain("2 of 3 projects");
    expect(list.text).toContain("csv-merge: Merges bank CSVs into Excel. (active, Python/pandas");
    expect(list.text).toContain("#finance");
    expect(list.text).not.toContain("Old thing.");

    expect((await call(client, "list_projects", { status: "all" })).text).toContain("Old thing.");
    expect((await call(client, "list_projects", { query: "bank excel" })).text).toContain("1 of 3");
    expect((await call(client, "list_projects", { tech: "react" })).text).toContain("- web:");

    const pending = await call(client, "list_pending");
    expect(pending.text).toContain("1 projects without a summary");
    expect(pending.text).toContain("- web:");

    const byName = JSON.parse((await call(client, "get_project", { project: "csv-merge" })).text);
    expect(byName).toMatchObject({ path: csv, summary: "Merges bank CSVs into Excel.", tags: ["finance"], registered: true });
    expect(JSON.parse((await call(client, "get_project", { project: csv })).text).path).toBe(csv);

    const updated = await call(client, "update_project", { path: csv, summary: "Now a web app." });
    expect(updated.text).toContain("Updated");
    expect((await loadRecords())[csv]).toMatchObject({ summary: "Now a web app.", tags: ["finance"], status: "active" });
  });

  it("registers projects outside the configured roots", async () => {
    const w = dirs.work();
    makeTree(w, { "desktop/thing/index.html": "<p>hi</p>" });
    const thing = path.join(w, "desktop/thing");
    const client = await connect([]);
    expect((await call(client, "update_project", { path: thing, summary: "A landing page draft." })).isError).toBe(false);
    expect((await call(client, "list_projects")).text).toContain("thing: A landing page draft.");
  });

  it("rejects paths that are not folders and unknown names", async () => {
    const client = await connect([dirs.work()]);
    expect((await call(client, "update_project", { path: path.join(dirs.work(), "nope"), summary: "x" })).isError).toBe(true);
    expect((await call(client, "get_project", { project: "nope" })).isError).toBe(true);
  });
});
