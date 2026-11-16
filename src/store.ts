import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATUSES = ["experiment", "active", "done", "archived"] as const;
export type Status = (typeof STATUSES)[number];

/** What Foldex persists. Everything else is read live from the project folder. */
export interface ProjectRecord {
  path: string;
  summary?: string;
  tags: string[];
  status: Status;
  createdAt: string;
  updatedAt: string;
  /** Client that registered the project, e.g. "claude-code" or "cursor-vscode". */
  source?: string;
  remote?: string;
}

interface StoreFile {
  version: 1;
  projects: Record<string, ProjectRecord>;
}

export function foldexHome(): string {
  return process.env.FOLDEX_HOME || path.join(os.homedir(), ".foldex");
}

function storePath(): string {
  return path.join(foldexHome(), "projects.json");
}

export async function loadRecords(): Promise<Record<string, ProjectRecord>> {
  try {
    const data = JSON.parse(await fs.readFile(storePath(), "utf8")) as StoreFile;
    return data.projects ?? {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not read ${storePath()}: ${(err as Error).message}`);
  }
}

let tmpCounter = 0;

/** Writes to a temp file first and renames it, so readers never see a half-written file. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}

/**
 * Reloads the store from disk, applies `fn` and writes it back. Updates within
 * this process run one at a time, so startup registration cannot overwrite a
 * concurrent update_project. Reloading right before writing keeps the window
 * small when Cursor and Claude Code run separate Foldex processes.
 */
let queue: Promise<unknown> = Promise.resolve();

export function mutateRecords<T>(fn: (records: Record<string, ProjectRecord>) => T): Promise<T> {
  const run = queue.then(async () => {
    const records = await loadRecords();
    const result = fn(records);
    const data: StoreFile = { version: 1, projects: records };
    await writeFileAtomic(storePath(), JSON.stringify(data, null, 2) + "\n");
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export function newRecord(projectPath: string, source?: string): ProjectRecord {
  const now = new Date().toISOString();
  return { path: projectPath, tags: [], status: "experiment", createdAt: now, updatedAt: now, source };
}
