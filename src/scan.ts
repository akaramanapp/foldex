import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Files whose presence makes a folder a project. */
const MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
  "pubspec.yaml",
  "Package.swift",
  "deno.json",
];

/** Folders never descended into while looking for projects. */
const SKIP_DIRS = new Set([
  "node_modules",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
  "vendor",
  "Library",
  "Applications",
]);

export const DEFAULT_MAX_DEPTH = 3;

export interface ProjectMeta {
  name: string;
  description?: string;
  readme?: string;
  tech: string[];
  lastActivity?: string;
  remote?: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return undefined;
  }
}

export async function isProject(dir: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return false;
  }
  const set = new Set(entries);
  return MARKERS.some((m) => set.has(m)) || entries.some((e) => e.endsWith(".csproj") || e.endsWith(".sln"));
}

/** Catch-all home folders that often hold a stray manifest but are never a project themselves. */
const CONTAINER_FOLDERS = new Set(["Desktop", "Documents", "Downloads"]);

export function isContainerFolder(dir: string): boolean {
  const resolved = path.resolve(dir);
  return path.dirname(resolved) === os.homedir() && CONTAINER_FOLDERS.has(path.basename(resolved));
}

/** A folder of projects needs at least this many marker-detected projects directly inside it. */
const PROJECTS_FOLDER_MIN = 3;

async function childDirs(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return (
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
      // Downloads is full of other people's repos; projects there still get registered when opened.
      .filter((e) => !(e.name === "Downloads" && dir === os.homedir()))
      .map((e) => path.join(dir, e.name))
  );
}

async function isNonEmpty(dir: string): Promise<boolean> {
  return (await fs.readdir(dir).catch(() => [] as string[])).some((e) => e !== ".DS_Store");
}

/**
 * Finds projects under the given roots. A matched project is not descended
 * into, so a monorepo counts as one project.
 *
 * Exception: a "projects folder" — no .git of its own and at least
 * PROJECTS_FOLDER_MIN projects directly inside — is not a project even if a
 * stray package.json sits in it. Every non-empty subfolder of it counts as a
 * project, including script-only ones without a manifest.
 */
export async function scanRoots(roots: string[], maxDepth = DEFAULT_MAX_DEPTH): Promise<string[]> {
  const found = new Set<string>();

  async function isProjectsFolder(dir: string, children: string[]): Promise<boolean> {
    if (dir === os.homedir() || dir === path.parse(dir).root || isContainerFolder(dir)) return false;
    if (await exists(path.join(dir, ".git"))) return false;
    let count = 0;
    for (const c of children) {
      if (await isProject(c)) count++;
      if (count >= PROJECTS_FOLDER_MIN) return true;
    }
    return false;
  }

  async function walk(dir: string, depth: number, inProjectsFolder = false): Promise<void> {
    const children = depth < maxDepth ? await childDirs(dir) : [];
    const projectsFolder = await isProjectsFolder(dir, children);
    if (!projectsFolder) {
      if (!isContainerFolder(dir) && (await isProject(dir))) {
        found.add(dir);
        return;
      }
      // A loose folder inside a projects folder is a project, unless it only groups projects.
      if (inProjectsFolder && (await isNonEmpty(dir))) {
        let groupsProjects = false;
        for (const c of children) if ((groupsProjects = await isProject(c))) break;
        if (!groupsProjects) {
          found.add(dir);
          return;
        }
      }
    }
    await Promise.all(children.map((c) => walk(c, depth + 1, projectsFolder)));
  }

  await Promise.all(roots.map((r) => walk(path.resolve(r), 0)));
  return [...found].sort();
}

/** Generated README text that says nothing about the project. */
const BOILERPLATE = [/get started with GitLab/i, /^Already a pro\? Just edit this README/i, /bootstrapped with \[?Create React App/i, /^This is a \[?Next\.js\]? project/i];

/** First prose paragraph of a README: skips headings, badges, HTML, code, intros to lists and template text. */
export function readmeExcerpt(text: string, maxLength = 300): string | undefined {
  const paragraphs = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/);
  for (const raw of paragraphs) {
    const rawLines = raw.split("\n").map((l) => l.trim());
    // Setext headings ("Title\n=====") and horizontal rules.
    if (rawLines.some((l) => /^(=+|-{3,}|\*{3,})$/.test(l))) continue;
    // Lists are steps or features, not a description.
    if (rawLines.filter(Boolean).every((l) => /^([-*+]|\d+\.)\s/.test(l))) continue;
    const lines = rawLines.filter((l) => l && !l.startsWith("#") && !l.startsWith("<") && !l.startsWith("[![") && !l.startsWith("!["));
    const para = lines
      .join(" ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<?https?:\/\/\S+/g, "")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (para.endsWith(":") || BOILERPLATE.some((re) => re.test(para))) continue;
    if (para.length >= 20) {
      return para.length > maxLength ? para.slice(0, maxLength - 1).trimEnd() + "…" : para;
    }
  }
  return undefined;
}

function tomlString(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, "m"));
  return m?.[1] || undefined;
}

const JS_FRAMEWORKS: Record<string, string> = {
  typescript: "TypeScript",
  react: "React",
  next: "Next.js",
  vue: "Vue",
  svelte: "Svelte",
  "@angular/core": "Angular",
  express: "Express",
  fastify: "Fastify",
  electron: "Electron",
  "react-native": "React Native",
  vite: "Vite",
  "@modelcontextprotocol/sdk": "MCP",
};

const PY_FRAMEWORKS: Record<string, string> = {
  django: "Django",
  flask: "Flask",
  fastapi: "FastAPI",
  streamlit: "Streamlit",
  torch: "PyTorch",
  pandas: "pandas",
  mcp: "MCP",
};

/** Reads a git remote URL from .git/config without spawning git. */
function parseRemote(config: string): string | undefined {
  const m = config.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
  return m?.[1];
}

async function mtime(p: string): Promise<Date | undefined> {
  try {
    return (await fs.stat(p)).mtime;
  } catch {
    return undefined;
  }
}

export async function readMeta(dir: string): Promise<ProjectMeta> {
  const entries = new Set(await fs.readdir(dir).catch(() => [] as string[]));
  const tech = new Set<string>();
  let name: string | undefined;
  let description: string | undefined;

  if (entries.has("package.json")) {
    tech.add("Node.js");
    try {
      const pkg = JSON.parse((await readText(path.join(dir, "package.json"))) ?? "{}");
      name = typeof pkg.name === "string" ? pkg.name : undefined;
      description = typeof pkg.description === "string" && pkg.description ? pkg.description : undefined;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, label] of Object.entries(JS_FRAMEWORKS)) if (dep in deps) tech.add(label);
    } catch {
      /* malformed package.json */
    }
  }
  if (entries.has("tsconfig.json")) tech.add("TypeScript");

  const pyproject = entries.has("pyproject.toml") ? await readText(path.join(dir, "pyproject.toml")) : undefined;
  const requirements = entries.has("requirements.txt") ? await readText(path.join(dir, "requirements.txt")) : undefined;
  if (pyproject !== undefined || requirements !== undefined || [...entries].some((e) => e.endsWith(".py"))) {
    tech.add("Python");
    if (pyproject) {
      name ??= tomlString(pyproject, "name");
      description ??= tomlString(pyproject, "description");
    }
    const pyDeps = `${pyproject ?? ""}\n${requirements ?? ""}`.toLowerCase();
    for (const [dep, label] of Object.entries(PY_FRAMEWORKS)) {
      if (new RegExp(`(^|[\\s"'\\[,])${dep}([\\s"'=<>~!,\\]]|$)`, "m").test(pyDeps)) tech.add(label);
    }
  }
  if (entries.has("Cargo.toml")) {
    tech.add("Rust");
    const cargo = await readText(path.join(dir, "Cargo.toml"));
    if (cargo) {
      name ??= tomlString(cargo, "name");
      description ??= tomlString(cargo, "description");
    }
  }
  if (entries.has("go.mod")) tech.add("Go");
  if (entries.has("pom.xml") || entries.has("build.gradle")) tech.add("Java");
  if (entries.has("Gemfile")) tech.add("Ruby");
  if (entries.has("composer.json")) tech.add("PHP");
  if (entries.has("pubspec.yaml")) tech.add("Flutter");
  if (entries.has("Package.swift")) tech.add("Swift");
  if (entries.has("deno.json")) tech.add("Deno");
  if ([...entries].some((e) => e.endsWith(".csproj") || e.endsWith(".sln"))) tech.add("C#");
  if (entries.has("Dockerfile")) tech.add("Docker");

  const readmeFile = [...entries].find((e) => /^readme(\.(md|markdown|txt|rst))?$/i.test(e));
  const readmeText = readmeFile ? await readText(path.join(dir, readmeFile)) : undefined;
  const readme = readmeText ? readmeExcerpt(readmeText) : undefined;

  let remote: string | undefined;
  let last: Date | undefined;
  if (entries.has(".git")) {
    const gitConfig = await readText(path.join(dir, ".git", "config"));
    if (gitConfig) remote = parseRemote(gitConfig);
    // logs/HEAD is appended on every commit, checkout and pull.
    last = (await mtime(path.join(dir, ".git", "logs", "HEAD"))) ?? (await mtime(path.join(dir, ".git", "index")));
  }
  last ??= await mtime(dir);

  return {
    name: name || path.basename(dir),
    description,
    readme,
    tech: [...tech],
    lastActivity: last?.toISOString(),
    remote,
  };
}

export { exists };
