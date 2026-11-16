import os from "node:os";
import path from "node:path";
import { exists, readMeta, scanRoots, type ProjectMeta } from "./scan.js";
import { loadRecords, mutateRecords, type ProjectRecord, type Status } from "./store.js";

/** A project as tools and the HTML page see it: stored record merged with live metadata. */
export interface ProjectView extends Partial<ProjectMeta> {
  path: string;
  name: string;
  tech: string[];
  tags: string[];
  status: Status;
  summary?: string;
  createdAt?: string;
  source?: string;
  /** Has a stored record (registered by a client), not only found by scanning. */
  registered: boolean;
}

/** Expands a leading "~" (MCP configs pass args without a shell) and makes the path absolute. */
export function resolveUserPath(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

/** Root folders from CLI args; with none, the home folder (Downloads, Library etc. are skipped while scanning). */
export function resolveRoots(args: string[]): string[] {
  return (args.length ? args : ["~"]).map(resolveUserPath);
}

/**
 * Records whose folder is gone. A folder whose parent still exists was deleted,
 * so its record is removed. If the parent is gone too (an unplugged drive, an
 * unmounted network share) the record is kept, just not listed, so the summary
 * comes back when the drive does.
 */
async function pruneDeleted(records: Record<string, ProjectRecord>): Promise<Set<string>> {
  const absent = new Set<string>();
  const deleted: string[] = [];
  await Promise.all(
    Object.keys(records).map(async (p) => {
      if (await exists(p)) return;
      absent.add(p);
      if (await exists(path.dirname(p))) deleted.push(p);
    }),
  );
  if (deleted.length) {
    await mutateRecords((fresh) => {
      for (const p of deleted) delete fresh[p];
    });
  }
  return absent;
}

export async function collectProjects(roots: string[]): Promise<ProjectView[]> {
  const [records, scanned] = await Promise.all([loadRecords(), scanRoots(roots)]);
  const absent = await pruneDeleted(records);
  const paths = new Set([...Object.keys(records).filter((p) => !absent.has(p)), ...scanned]);

  const views = await Promise.all(
    [...paths].map(async (p): Promise<ProjectView> => {
      const record: ProjectRecord | undefined = records[p];
      const meta = await readMeta(p);
      return {
        ...meta,
        path: p,
        remote: meta.remote ?? record?.remote,
        tags: record?.tags ?? [],
        status: record?.status ?? "experiment",
        summary: record?.summary,
        createdAt: record?.createdAt,
        source: record?.source,
        registered: Boolean(record),
      };
    }),
  );

  return views.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
}

/** One line per project, compact enough to list hundreds of projects to the model. */
export function formatLine(v: ProjectView): string {
  const about = v.summary ?? (v.description || v.readme ? `[no summary yet] ${v.description ?? v.readme}` : "[no summary yet]");
  const bits = [v.status, v.tech.slice(0, 4).join("/") || undefined, v.lastActivity?.slice(0, 10)];
  if (v.tags.length) bits.push(`#${v.tags.join(" #")}`);
  return `- ${v.name}: ${about} (${bits.filter(Boolean).join(", ")}) ${v.path}`;
}
