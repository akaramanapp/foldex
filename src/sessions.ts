import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where a project's "Claude" link leads. */
export interface ClaudeLink {
  url: string;
  kind: "continue" | "resume" | "new";
  /** Title of the session the link opens, when there is one. */
  title?: string;
}

interface DesktopSession {
  id: string;
  cwd: string;
  title?: string;
  last: number;
  archived: boolean;
}

/** The Claude desktop app's data folder on each platform. */
export function claudeDesktopDir(): string {
  if (process.env.FOLDEX_CLAUDE_DESKTOP_DIR) return process.env.FOLDEX_CLAUDE_DESKTOP_DIR;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Claude");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Claude");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Claude");
}

/** Claude Code's own data folder (CLI transcripts live under projects/). */
export function claudeCodeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

async function listDir(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch(() => []);
}

/**
 * Reads the desktop app's Code sessions (claude-code-sessions/<account>/<org>/local_*.json).
 * This is the app's private storage, so every field is treated as optional and
 * any failure just means "no desktop sessions".
 */
export async function readDesktopSessions(desktopDir = claudeDesktopDir()): Promise<DesktopSession[]> {
  const base = path.join(desktopDir, "claude-code-sessions");
  const files: string[] = [];
  for (const account of await listDir(base)) {
    for (const org of await listDir(path.join(base, account))) {
      for (const f of await listDir(path.join(base, account, org))) {
        if (/^local_[A-Za-z0-9-]+\.json$/.test(f)) files.push(path.join(base, account, org, f));
      }
    }
  }
  const sessions = await Promise.all(
    files.map(async (f): Promise<DesktopSession | undefined> => {
      try {
        const d = JSON.parse(await fs.readFile(f, "utf8"));
        const cwd = typeof d.originCwd === "string" ? d.originCwd : d.cwd;
        if (typeof d.sessionId !== "string" || !/^local_[A-Za-z0-9-]{1,64}$/.test(d.sessionId) || typeof cwd !== "string") return undefined;
        return {
          id: d.sessionId,
          cwd: path.resolve(cwd),
          title: typeof d.title === "string" ? d.title : undefined,
          last: Number(d.lastActivityAt ?? d.createdAt ?? 0) || 0,
          archived: Boolean(d.isArchived),
        };
      } catch {
        return undefined;
      }
    }),
  );
  return sessions.filter((s): s is DesktopSession => Boolean(s));
}

/** Claude Code stores a folder's CLI transcripts under projects/<path with non-alphanumerics as "-">. */
export function cliProjectDir(projectPath: string, codeDir = claudeCodeDir()): string {
  return path.join(codeDir, "projects", projectPath.replace(/[^a-zA-Z0-9]/g, "-"));
}

/** Most recent CLI session id for a folder, if any. */
export async function latestCliSession(projectPath: string, codeDir = claudeCodeDir()): Promise<string | undefined> {
  const dir = cliProjectDir(projectPath, codeDir);
  const files = (await listDir(dir)).filter((f) => /^[0-9a-f-]{36}\.jsonl$/.test(f));
  let best: { id: string; mtime: number } | undefined;
  for (const f of files) {
    const stat = await fs.stat(path.join(dir, f)).catch(() => undefined);
    if (stat && (!best || stat.mtimeMs > best.mtime)) best = { id: f.slice(0, 36), mtime: stat.mtimeMs };
  }
  return best?.id;
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

/**
 * Picks the best Claude link per project: the latest desktop session in the
 * folder, else the latest CLI session (imported by the app), else a new
 * session in the folder.
 */
export async function claudeLinks(
  projectPaths: string[],
  dirs: { desktopDir?: string; codeDir?: string } = {},
): Promise<Map<string, ClaudeLink>> {
  const desktop = await readDesktopSessions(dirs.desktopDir);
  const links = new Map<string, ClaudeLink>();

  await Promise.all(
    projectPaths.map(async (p) => {
      const candidates = desktop
        .filter((s) => isInside(s.cwd, p))
        .sort((a, b) => Number(a.archived) - Number(b.archived) || b.last - a.last);
      const best = candidates[0];
      if (best) {
        links.set(p, { kind: "continue", url: `claude://code/continue?session=${best.id}`, title: best.title });
        return;
      }
      const cli = await latestCliSession(p, dirs.codeDir);
      if (cli) {
        links.set(p, { kind: "resume", url: `claude://resume?session=${cli}` });
        return;
      }
      links.set(p, { kind: "new", url: `claude://code/new?folder=${encodeURIComponent(p)}` });
    }),
  );
  return links;
}
