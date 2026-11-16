import { promises as fs } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { htmlPath, openInBrowser, writeHtml } from "./html.js";
import { collectProjects, formatLine, resolveUserPath, type ProjectView } from "./projects.js";
import { autoRegister } from "./register.js";
import { readMeta } from "./scan.js";
import { mutateRecords, newRecord, STATUSES } from "./store.js";
import { VERSION } from "./version.js";

export const INSTRUCTIONS = `Foldex keeps an index of every project on this computer, with a short summary of what each one does.

Follow these rules without being asked, and without asking the user first:
- When you finish a task in which you wrote the first code of a project, call update_project with the folder's absolute path and a 1-2 sentence summary of what it does, based on what the user asked for. This includes a folder the user just created and opened you in, a folder that was empty or nearly empty, and a single-file script. If unsure whether the current folder already has a summary, call get_project with its path.
- When a project's purpose or scope changes significantly, call update_project again to refresh its summary.
- Before starting a new project or a sizable feature, call list_projects to check whether the user already built something similar, and mention it if so.
- When you notice projects without a summary, offer to read and summarize them with update_project.

Summaries describe what the project does for the user (e.g. "Merges monthly bank CSVs into one Excel report"), not the tech stack.`;

const statusSchema = z.enum(STATUSES);

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function error(t: string) {
  return { content: [{ type: "text" as const, text: t }], isError: true };
}

export interface FoldexOptions {
  /** Root folders scanned for projects on every call. */
  roots: string[];
  /** Opens the index page; replaceable in tests. */
  openFile?: (file: string) => void;
  /** How often a tool call may re-ask the client for its open folders. */
  folderSyncMs?: number;
}

export function createServer({ roots, openFile = openInBrowser, folderSyncMs = 30_000 }: FoldexOptions): McpServer {
  const server = new McpServer({ name: "foldex", version: VERSION }, { instructions: INSTRUCTIONS });

  async function refreshHtml(projects?: ProjectView[]): Promise<void> {
    try {
      await writeHtml(projects ?? (await collectProjects(roots)));
    } catch (err) {
      console.error("foldex: could not write index.html:", err);
    }
  }

  /**
   * Registers the client's open folders. VS Code starts the server before a
   * folder is open and adds it later, so this runs at startup, whenever the
   * client says its folders changed, and (throttled) before tool calls for
   * clients that never say so.
   */
  let lastSync = 0;
  async function syncOpenFolders(force = false): Promise<void> {
    if (!force && Date.now() - lastSync < folderSyncMs) return;
    lastSync = Date.now();
    try {
      if ((await autoRegister(server.server, roots)).length) await refreshHtml();
    } catch (err) {
      console.error("foldex: auto-registration failed:", err);
    }
  }

  server.server.oninitialized = () => {
    syncOpenFolders(true).finally(() => refreshHtml());
  };
  server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    await syncOpenFolders(true);
  });

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the user's local projects with one line each: summary, status, tech, last activity and path. " +
        "Use it to answer questions about the user's projects and, before starting something new, to check whether a similar project already exists. " +
        "Archived projects are hidden unless status is 'archived' or 'all'.",
      inputSchema: {
        query: z.string().optional().describe("Case-insensitive words that must all appear in the name, summary, tags, tech or path."),
        status: z.enum([...STATUSES, "all"]).optional(),
        tech: z.string().optional().describe("Only projects using this technology, e.g. 'Python' or 'React'."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, status, tech }) => {
      await syncOpenFolders();
      const all = await collectProjects(roots);
      const words = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
      const shown = all.filter((p) => {
        if (status === undefined ? p.status === "archived" : status !== "all" && p.status !== status) return false;
        if (tech && !p.tech.some((t) => t.toLowerCase() === tech.toLowerCase())) return false;
        const hay = [p.name, p.summary, p.description, p.readme, p.path, ...p.tech, ...p.tags].join(" ").toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      const pending = shown.filter((p) => !p.summary).length;
      const header =
        `${shown.length} of ${all.length} projects` +
        (pending ? ` (${pending} without a summary; you can read those and call update_project)` : "") +
        `. Browsable page: ${htmlPath()}`;
      return text([header, ...shown.map(formatLine)].join("\n"));
    },
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Details of one project: stored summary, tags and status plus live metadata (README excerpt, tech, last activity, git remote).",
      inputSchema: {
        project: z.string().describe("Absolute path, or the project's name or folder name."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => {
      await syncOpenFolders();
      const all = await collectProjects(roots);
      const looksLikePath = project.includes("/") || project.includes("\\") || project.startsWith("~");
      if (looksLikePath) {
        const p = resolveUserPath(project);
        const found = all.find((v) => v.path === p);
        if (found) return text(JSON.stringify(found, null, 2));
        const stat = await fs.stat(p).catch(() => undefined);
        if (!stat?.isDirectory()) return error(`No project at ${p}.`);
        return text(JSON.stringify({ path: p, ...(await readMeta(p)), registered: false }, null, 2));
      }
      const needle = project.toLowerCase();
      const matches = all.filter((v) => v.name.toLowerCase() === needle || path.basename(v.path).toLowerCase() === needle);
      if (matches.length === 1) return text(JSON.stringify(matches[0], null, 2));
      if (matches.length > 1) return text(`Several projects match "${project}"; call again with one of these paths:\n${matches.map(formatLine).join("\n")}`);
      return error(`No project named "${project}". Use list_projects with a query to search.`);
    },
  );

  server.registerTool(
    "update_project",
    {
      title: "Save project summary",
      description:
        "Add a project to the index or update it. Call this at the end of any task where you wrote the first code in a folder (even one the user created, or a single script), and again when its purpose changes significantly. " +
        "Works for any folder on disk, including ones outside the configured root folders.",
      inputSchema: {
        path: z.string().describe("Absolute path of the project folder."),
        summary: z.string().min(1).describe("1-2 sentences on what the project does for the user."),
        tags: z.array(z.string()).optional().describe("A few lowercase keywords, e.g. ['pdf', 'invoices']. Replaces existing tags."),
        status: statusSchema.optional().describe("New projects default to 'experiment'."),
      },
    },
    async ({ path: rawPath, summary, tags, status }) => {
      await syncOpenFolders();
      const p = resolveUserPath(rawPath);
      const stat = await fs.stat(p).catch(() => undefined);
      if (!stat?.isDirectory()) return error(`${p} is not an existing folder. Create the project folder first.`);
      const { remote } = await readMeta(p);
      const source = server.server.getClientVersion()?.name;
      const created = await mutateRecords((records) => {
        const existing = records[p];
        records[p] = {
          ...(existing ?? newRecord(p, source)),
          summary: summary.trim(),
          ...(tags ? { tags: tags.map((t) => t.trim().toLowerCase()).filter(Boolean) } : {}),
          ...(status ? { status } : {}),
          remote: remote ?? existing?.remote,
          updatedAt: new Date().toISOString(),
        };
        return !existing;
      });
      await refreshHtml();
      return text(`${created ? "Added" : "Updated"} ${p}. Index page: ${htmlPath()}`);
    },
  );

  server.registerTool(
    "list_pending",
    {
      title: "Projects without a summary",
      description: "Projects that have no summary yet. Read each one (README, manifest, main files) and call update_project to summarize it.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      await syncOpenFolders();
      const pending = (await collectProjects(roots)).filter((p) => !p.summary);
      if (!pending.length) return text("Every project has a summary.");
      return text([`${pending.length} projects without a summary:`, ...pending.map(formatLine)].join("\n"));
    },
  );

  server.registerTool(
    "open_index",
    {
      title: "Open project index page",
      description:
        "Rebuild the project index page and open it in the user's browser. Use when the user asks to open, show or see their projects page, project index or Foldex.",
      inputSchema: {},
    },
    async () => {
      await syncOpenFolders();
      const projects = await collectProjects(roots);
      const file = await writeHtml(projects);
      openFile(file);
      return text(`Opened the project index (${projects.length} projects) in the browser: ${file}`);
    },
  );

  return server;
}
