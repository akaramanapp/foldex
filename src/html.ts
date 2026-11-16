import { spawn } from "node:child_process";
import path from "node:path";
import type { ProjectView } from "./projects.js";
import { existsSync } from "node:fs";
import { claudeDesktopDir, claudeLinks, type ClaudeLink } from "./sessions.js";
import { foldexHome, writeFileAtomic } from "./store.js";

export function htmlPath(): string {
  return path.join(foldexHome(), "index.html");
}

/** Serializes data for a <script> block without letting it close the tag early. */
function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Which editors get a link on each card. */
export interface Editors {
  claude: boolean;
  cursor: boolean;
  vscode: boolean;
}

/** Opens a folder in an editor that handles <scheme>://file/<path> (VS Code and its forks). */
export function editorUrl(scheme: "cursor" | "vscode", projectPath: string): string {
  const p = projectPath.replace(/\\/g, "/");
  return `${scheme}://file` + encodeURI(p.startsWith("/") ? p : "/" + p);
}
export const cursorUrl = (projectPath: string): string => editorUrl("cursor", projectPath);

export function renderHtml(
  projects: ProjectView[],
  links = new Map<string, ClaudeLink>(),
  generatedAt = new Date(),
  editors: Editors = { claude: true, cursor: false, vscode: false },
): string {
  const data = projects.map((p) => ({
    claude: editors.claude ? links.get(p.path) : undefined,
    cursor: editors.cursor ? cursorUrl(p.path) : undefined,
    vscode: editors.vscode ? editorUrl("vscode", p.path) : undefined,
    path: p.path,
    name: p.name,
    summary: p.summary,
    fallback: p.description ?? p.readme,
    tech: p.tech,
    tags: p.tags,
    status: p.status,
    last: p.lastActivity,
    remote: p.remote,
  }));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Foldex</title>
<style>
:root {
  --bg: #f7f7f5; --card: #ffffff; --text: #1c1c1a; --muted: #6b6b66; --line: #e4e3df;
  --accent: #2f5bd3; --chip: #efeeea; --warn: #b4560b; --warn-bg: #fdf0e3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --card: #1f1f1d; --text: #ecebe7; --muted: #9a9993; --line: #33322f;
    --accent: #8aa9ff; --chip: #2a2a27; --warn: #f0a35e; --warn-bg: #3a2a1b;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
.meta { color: var(--muted); font-size: 13px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 12px; }
input, select { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
input { flex: 1 1 260px; min-width: 0; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
.tab { border: 1px solid var(--line); background: var(--card); color: var(--muted); border-radius: 999px; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 13px; }
.tab[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.card h2 { margin: 0; font-size: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.summary { margin: 0; }
.fallback { margin: 0; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { background: var(--chip); border-radius: 6px; padding: 1px 7px; font-size: 12px; }
.badge { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 6px; padding: 1px 6px; background: var(--chip); color: var(--muted); }
.badge.pending { background: var(--warn-bg); color: var(--warn); }
.path { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); overflow-wrap: anywhere; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: auto; font-size: 13px; color: var(--muted); }
.foot a { color: var(--accent); text-decoration: none; margin-left: 10px; }
.foot a:hover { text-decoration: underline; }
.empty { color: var(--muted); padding: 40px 0; text-align: center; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Foldex</h1>
    <span class="meta" id="meta"></span>
  </header>
  <div class="controls">
    <input id="q" type="search" placeholder="Search projects, summaries, tags…" autofocus>
    <select id="tech"><option value="">All tech</option></select>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="grid" id="grid"></div>
</main>
<script id="data" type="application/json">${embedJson(data)}</script>
<script>
const projects = JSON.parse(document.getElementById("data").textContent);
const generatedAt = ${JSON.stringify(generatedAt.toISOString())};
const tabs = [
  ["live", "Active & experiments", p => p.status === "active" || p.status === "experiment"],
  ["active", "Active", p => p.status === "active"],
  ["experiment", "Experiments", p => p.status === "experiment"],
  ["done", "Done", p => p.status === "done"],
  ["archived", "Archived", p => p.status === "archived"],
  ["pending", "No summary", p => !p.summary],
  ["all", "All", () => true],
];
let tab = "live";
const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function ago(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso)) / 864e5);
  if (days < 1) return "today";
  if (days < 30) return days + "d ago";
  if (days < 365) return Math.floor(days / 30) + "mo ago";
  return Math.floor(days / 365) + "y ago";
}

const techs = [...new Set(projects.flatMap(p => p.tech))].sort();
for (const t of techs) $("tech").append(new Option(t, t));
$("meta").textContent = projects.length + " projects · updated " + new Date(generatedAt).toLocaleString();

function matches(p, q, tech) {
  if (tech && !p.tech.includes(tech)) return false;
  if (!q) return true;
  const hay = [p.name, p.summary, p.fallback, p.path, ...p.tech, ...p.tags].join(" ").toLowerCase();
  return q.split(/\\s+/).every(w => hay.includes(w));
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  const tech = $("tech").value;
  const base = projects.filter(p => matches(p, q, tech));

  $("tabs").replaceChildren(...tabs.map(([id, label, fn]) => {
    const b = el("button", "tab", label + " " + base.filter(fn).length);
    b.setAttribute("aria-pressed", String(id === tab));
    b.onclick = () => { tab = id; render(); };
    return b;
  }));

  const shown = base.filter(tabs.find(t => t[0] === tab)[2]);
  if (!shown.length) {
    $("grid").replaceChildren(el("p", "empty", projects.length ? "No projects match." : "No projects yet. Ask your AI to list your projects, or add root folders to the Foldex config."));
    return;
  }
  $("grid").replaceChildren(...shown.map(p => {
    const card = el("article", "card");
    const h = el("h2", null, p.name);
    if (p.status !== "experiment" && p.status !== "active") h.append(el("span", "badge", p.status));
    if (!p.summary) h.append(el("span", "badge pending", "no summary"));
    card.append(h);
    if (p.summary) card.append(el("p", "summary", p.summary));
    else if (p.fallback) card.append(el("p", "fallback", p.fallback));
    const chips = el("div", "chips");
    for (const t of p.tech) chips.append(el("span", "chip", t));
    for (const t of p.tags) chips.append(el("span", "chip", "#" + t));
    if (chips.childElementCount) card.append(chips);
    card.append(el("div", "path", p.path));
    const foot = el("div", "foot");
    foot.append(el("span", null, ago(p.last)));
    const links = el("span");
    if (p.claude) {
      const a = el("a", null, "Claude");
      a.href = p.claude.url;
      a.title = p.claude.kind === "continue" ? "Open session: " + (p.claude.title || "last session")
        : p.claude.kind === "resume" ? "Open the last Claude Code session in the Claude app"
        : "Start a new Claude session in this folder";
      links.append(a);
    }
    if (p.cursor) {
      const a = el("a", null, "Cursor");
      a.href = p.cursor;
      a.title = "Open this folder in Cursor";
      links.append(a);
    }
    if (p.vscode) {
      const a = el("a", null, "VS Code");
      a.href = p.vscode;
      a.title = "Open this folder in VS Code";
      links.append(a);
    }
    if (links.childElementCount) foot.append(links);
    card.append(foot);
    return card;
  }));
}
$("q").oninput = render;
$("tech").onchange = render;
render();
</script>
</body>
</html>
`;
}

/** Opens a local file with the system's default handler (the browser, for .html). */
export function openInBrowser(file: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin" ? ["open", [file]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", file]] : ["xdg-open", [file]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

/**
 * Shows a link only for editors the user actually uses with Foldex: Cursor or
 * VS Code once any project was registered from it, Claude when the Claude app
 * is installed or a project came from Claude.
 */
export function detectEditors(projects: ProjectView[], claudeAppInstalled: boolean): Editors {
  const sources = projects.map((p) => p.source ?? "");
  return {
    claude: claudeAppInstalled || sources.some((s) => /claude/i.test(s)),
    cursor: sources.some((s) => /cursor/i.test(s)),
    // Cursor's own client is named "cursor-vscode", so it must not count as VS Code.
    vscode: sources.some((s) => /visual studio code/i.test(s) || (/vscode/i.test(s) && !/cursor/i.test(s))),
  };
}

export async function writeHtml(projects: ProjectView[]): Promise<string> {
  const file = htmlPath();
  const links = await claudeLinks(projects.map((p) => p.path)).catch(() => new Map<string, ClaudeLink>());
  const editors = detectEditors(projects, existsSync(claudeDesktopDir()));
  await writeFileAtomic(file, renderHtml(projects, links, new Date(), editors));
  return file;
}
