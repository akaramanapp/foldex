import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openInBrowser, writeHtml } from "./html.js";
import { collectProjects, resolveRoots } from "./projects.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const USAGE = `foldex-mcp ${VERSION}: every project your AI ever started, indexed.

Usage:
  foldex-mcp [root folders...]        Run the MCP server (started by your IDE)
  foldex-mcp open [root folders...]   Rebuild the index page and open it in a browser

Root folders are scanned for projects. Default: your home folder.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(VERSION + "\n");
    return;
  }

  if (args[0] === "open") {
    const roots = resolveRoots(args.slice(1));
    const projects = await collectProjects(roots);
    const file = await writeHtml(projects);
    process.stdout.write(`${projects.length} projects indexed: ${file}\n`);
    openInBrowser(file);
    return;
  }

  // stdout belongs to the MCP protocol from here on; log to stderr only.
  const server = createServer({ roots: resolveRoots(args) });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("foldex:", err);
  process.exit(1);
});
