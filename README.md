# Foldex

**Every project your AI ever started, indexed.**

AI makes starting a project cheap, so you end up with dozens or hundreds of folders and no idea what half of them do. Foldex is an MCP server that keeps an index of all your local projects, wherever they live on disk. The summaries are written by the AI you already use in Cursor, Claude Code or any other MCP client.

- **One config line.** No database, no background daemon, no API key.
- **Projects register themselves.** When your IDE opens a project folder, Foldex adds it. When your AI creates a new project, it writes a one-line summary of what it does.
- **Ask in plain words.** "Did I ever build something that reads PDF invoices?" "What did I work on last month?"
- **A page to browse.** `~/.foldex/index.html` is a searchable, always-current page of every project. Each card opens the project in your editor: its latest Claude session, or the folder in Cursor or VS Code.
- **Private.** Nothing leaves your machine. Foldex only reads your folders and writes to `~/.foldex/`.

## Install

**Claude Code**

```bash
claude mcp add foldex --scope user -- npx -y foldex-mcp
```

**Cursor**

1. Open **Cursor Settings → MCP** (called **Tools & Integrations** in some versions) and click **Add new global MCP server**. This opens `~/.cursor/mcp.json`.
2. Add `foldex` under `mcpServers`. If the file already lists other servers, add only the `"foldex": …` line next to them.

   ```json
   {
     "mcpServers": {
       "foldex": { "command": "npx", "args": ["-y", "foldex-mcp"] }
     }
   }
   ```

3. Save. Foldex appears in the MCP list with a green dot. If it's off, switch it on.

No other settings needed: Foldex picks up the folders you open in Cursor, including other open Cursor windows.

**VS Code** (Copilot Chat in agent mode)

```bash
code --add-mcp '{"name":"foldex","command":"npx","args":["-y","foldex-mcp"]}'
```

The first time a chat uses Foldex, VS Code asks you to trust and start the server. Open a folder before you start the chat: without one, Copilot works in a temporary folder and there is no project to register.

**Other MCP clients:** add a stdio server with command `npx` and args `-y foldex-mcp` in the client's MCP settings. Tested so far with Claude Code, Cursor and VS Code.

Requires Node.js 18 or newer. That's it: start a new session and your projects are there.

Foldex finds your existing projects by scanning your home folder (skipping Downloads, Library, `node_modules` and hidden folders). To scan only specific folders instead, list them after `foldex-mcp`, e.g. `npx -y foldex-mcp ~/projects ~/work`. Either way, any folder you open in your IDE is added too.

## Use it

Ask your AI:

- "What projects do I have?" / "What did I touch this month?"
- "Have I built anything like this before?" (Foldex also tells the AI to check this itself before starting something new.)
- "What was invoice-bot and how do I run it?"
- "Summarize my projects that don't have a summary yet."

To browse, say **"open my project index"** and the page opens in your browser. You can also bookmark `~/.foldex/index.html`, or rebuild and open it from a terminal:

```bash
npx foldex-mcp open
```

## How it works

| Tool | What it does |
|---|---|
| `list_projects` | One line per project: summary, status, tech, last activity, path. Filter by words, status or tech. |
| `get_project` | Details of one project, by path or name. |
| `update_project` | Saves a summary, tags and status (`experiment`, `active`, `done`, `archived`). |
| `list_pending` | Projects that have no summary yet. |
| `open_index` | Rebuilds the index page and opens it in your browser. |

- A folder counts as a project if it contains `.git`, `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod` or a similar manifest. Foldex looks up to 3 levels below each root folder and skips `node_modules`, hidden folders and build output.
- Foldex stores only summaries, tags and statuses, in `~/.foldex/projects.json`. Names, README excerpts, tech and last activity are read live from each folder, so the index never goes stale.
- When the IDE starts Foldex, it registers the open folder: from MCP roots if the client sends them, otherwise from the folder the server was started in.
- Delete a project folder and it disappears from the index, summary included. Projects on a drive that is unplugged are only hidden, and come back with their summary when the drive does.

Set `FOLDEX_HOME` to store the index somewhere other than `~/.foldex`. If your IDE's projects don't show up, set `FOLDEX_DEBUG=1` in the server's `env` and look at `~/.foldex/debug.log` to see what the IDE sends.

## License

MIT
