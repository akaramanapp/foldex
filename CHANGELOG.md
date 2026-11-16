# Changelog

## 0.1.5

- VS Code support, tested with VS Code 1.144 and Copilot Chat in agent mode. VS Code starts MCP servers before a folder is open and reports the folder later, so Foldex now listens for the client's "open folders changed" notice and also re-checks open folders (at most every 30 seconds) when a tool is called.
- Folders inside hidden directories are never registered. Copilot runs chats without an open folder in `~/.copilot/chats/<id>`, which used to end up in the index.
- Index cards get a **VS Code** link once a project was registered from VS Code.

## 0.1.4

- Docs: step-by-step Cursor setup in the README. No code changes.

## 0.1.3

- Cursor support, tested with Cursor 3.24 and no extra settings: the folder you open in Cursor is registered automatically, including folders in other open Cursor windows.
- Fixed: Cursor sends its open folders as plain paths instead of `file://` URLs, which made the whole list unreadable.
- Index cards link to the editors you use with Foldex: **Claude** when the Claude app is installed, **Cursor** once a project was registered from Cursor.
- `FOLDEX_DEBUG=1` writes what the IDE sends at startup to `~/.foldex/debug.log`, to diagnose other MCP clients.

## 0.1.2

- Deleting a project folder now removes it from the index, whether it was found by scanning or registered with a summary. Projects on an unplugged drive are hidden instead, and come back with their summary when the drive is reconnected.
- The "not found" badge is gone.
- Fixed: a summary saved right as the IDE started Foldex could be lost, overwritten by the startup registration.

## 0.1.1

- A folder of projects (no `.git` of its own, 3+ projects inside) is no longer mistaken for a single project when a stray `package.json` sits in it. Its subfolders are indexed instead, including script-only ones without a manifest.
- Opening your IDE in such a folder no longer registers the folder itself as a project.

## 0.1.0

First release: live project index over MCP, auto-registration of opened folders, AI-written summaries, `open_index` and a searchable `~/.foldex/index.html` with links back to Claude sessions.
