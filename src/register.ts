import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { isContainerFolder, readMeta, scanRoots } from "./scan.js";
import { foldexHome, mutateRecords, newRecord } from "./store.js";

/**
 * Folders the client has open: MCP roots when the client supports them,
 * otherwise the directory the client started this server in.
 */
export async function openFolders(server: Server): Promise<string[]> {
  // Optional, set in the IDE config, e.g. "env": { "FOLDEX_WORKSPACE": "${workspaceFolder}" }.
  const fromEnv = process.env.FOLDEX_WORKSPACE;
  if (fromEnv && !fromEnv.includes("${")) return [fromEnv];
  if (server.getClientCapabilities()?.roots) {
    const roots = await rawRoots(server);
    if (roots) return roots.map(rootToPath).filter((p): p is string => Boolean(p));
  }
  return [process.cwd()];
}

/**
 * roots/list without the SDK's strict schema: Cursor sends root URIs that are
 * not file:// URLs, and the strict parse rejects the whole list.
 */
async function rawRoots(server: Server): Promise<string[] | undefined> {
  try {
    const res = await server.request({ method: "roots/list" }, z.object({ roots: z.array(z.object({ uri: z.string() }).passthrough()) }).passthrough());
    return res.roots.map((r) => r.uri);
  } catch {
    return undefined;
  }
}

/** Accepts file:// URLs and plain absolute paths; ignores anything else (remote URIs). */
export function rootToPath(uri: string): string | undefined {
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri);
    } catch {
      return undefined;
    }
  }
  return path.isAbsolute(uri) ? uri : undefined;
}

/**
 * Inside a hidden folder such as ~/.copilot/chats/<id>: tools keep their own
 * scratch folders there (Copilot runs each chat in one when no folder is open).
 */
export function isInHiddenFolder(dir: string): boolean {
  return path.resolve(dir).split(path.sep).some((part) => part.startsWith(".") && part !== "." && part !== "..");
}

/** Folders that are too broad, or not the user's, to be a project even if they contain a marker file. */
function isTooBroad(dir: string, configuredRoots: string[]): boolean {
  const resolved = path.resolve(dir);
  return (
    resolved === path.parse(resolved).root ||
    resolved === os.homedir() ||
    isContainerFolder(resolved) ||
    isInHiddenFolder(resolved) ||
    configuredRoots.some((r) => path.resolve(r) === resolved)
  );
}

/**
 * Registers the client's open folders that are not yet in the store, without
 * waiting for the model to call update_project. Opening an IDE in a folder is
 * itself the signal, so a fresh empty folder or a lone script counts too.
 * Folders that only group other projects (e.g. ~/experiments) are skipped.
 * Returns the newly registered paths.
 */
export async function registerFolders(dirs: string[], configuredRoots: string[], source?: string): Promise<string[]> {
  const candidates: string[] = [];
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (isTooBroad(resolved, configuredRoots)) continue;
    const stat = await fs.stat(resolved).catch(() => undefined);
    if (!stat?.isDirectory()) continue;
    // Scanning one level tells a project ([itself]) from a folder of projects ([its children]).
    const inner = await scanRoots([resolved], 1);
    const groupsProjects = inner.length > 0 && !inner.includes(resolved);
    if (!groupsProjects) candidates.push(resolved);
  }
  if (!candidates.length) return [];

  const remotes = new Map(await Promise.all(candidates.map(async (c) => [c, (await readMeta(c)).remote] as const)));
  return mutateRecords((records) => {
    const added: string[] = [];
    for (const c of candidates) {
      if (records[c]) continue;
      records[c] = { ...newRecord(c, source), remote: remotes.get(c) };
      added.push(c);
    }
    return added;
  });
}

/**
 * With FOLDEX_DEBUG=1, appends what the client sent at startup to
 * ~/.foldex/debug.log: which folder it is in and how it tells us. Used to
 * learn how each IDE launches MCP servers.
 */
async function debugLog(server: Server, folders: string[], added: string[]): Promise<void> {
  if (!process.env.FOLDEX_DEBUG) return;
  let roots: unknown = "not supported";
  if (server.getClientCapabilities()?.roots) roots = (await rawRoots(server)) ?? "error";
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /WORKSPACE|CURSOR|VSCODE|PWD|FOLDEX|CLAUDE/i.test(k) && !/KEY|TOKEN|SECRET/i.test(k)));
  const entry = {
    at: new Date().toISOString(),
    client: server.getClientVersion(),
    capabilities: server.getClientCapabilities(),
    roots,
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    env,
    folders,
    added,
  };
  await fs.mkdir(foldexHome(), { recursive: true });
  await fs.appendFile(path.join(foldexHome(), "debug.log"), JSON.stringify(entry) + "\n");
}

export async function autoRegister(server: Server, configuredRoots: string[]): Promise<string[]> {
  const folders = await openFolders(server);
  const added = await registerFolders(folders, configuredRoots, server.getClientVersion()?.name);
  await debugLog(server, folders, added).catch(() => {});
  return added;
}
