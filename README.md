# dsh-at-sider

[中文](README.zh.md) | English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
adds two things to the **native** right-sidebar file tree:

1. an **`@file` reference button** on every row, right after the file name
   (`@folder` on directories) — one click inserts the canonical `@path` mention
   into the composer (⌥/Alt-click copies the mention instead);
2. the entry's **modification time**, pinned to the row's far right, with the full
   local time as its tooltip.

```
📁 src          @folder   2026-01-02 11:04
📄 README.md      @file    2026-01-01 09:12
```

It is a *files-plus* tree, not a second sidebar: the native `files` tab keeps its
identity (same tab kind, same `Mod+P` shortcut, same guide capsule, same
"Workspace files" entry), and this plugin renders its body.

## Install

```bash
# into the `web` profile, from the directory that holds this package
dsh plugin --profile web add link:C:/path/to/dsh-at-sider
```

then add the bundle id to the profile's `dsh.profile.bundles` list
(`~/.dsh/profiles/web/package.json`) and restart `dsh web`:

```json
"dsh": { "profile": { "bundles": [ "...", "dsh-at-sider" ] } }
```

If your Harness exposes the Plugin Hub tool, `install_bundle` with this directory
as `target` does both steps. See [docs/INSTALL.md](docs/INSTALL.md) for the
Plugin Hub route, the manual route, uninstall, and troubleshooting.

A restart is required for the Host half (the listing route); the Client half
follows the normal plugin-HMR rules.

## What it does

| Row element | Behaviour |
|---|---|
| `@file` button (`@folder` on directories) | Inserts `@path` (or `@"path with spaces"`, `@dir/` for directories) into the session's composer as an atomic file reference — the same chip the built-in `@` completion and the built-in file drop produce. Falls back to copying the mention when no composer is reachable. The button appears while the row is hovered or focused. |
| `@file` + ⌥/Alt-click | Always copies the mention to the clipboard. |
| date column | `YYYY-MM-DD HH:mm` in local time; hover shows the full local date and time. Entries whose stat failed show nothing. |
| icons | The host's own artwork, unchanged: `FileTypeIcon` + `classifyFileType` per file kind (category-coloured), the line-art folder icons, and `GuideArtworkFiles` for the guide capsule — the same components the native tree draws with. Inline glyphs take over only if those exports are unavailable. |
| header | Workspace root path, an auto-refresh toggle, and a reload button. |
| rows | Directories first, then natural case-insensitive name order — as the native tree orders them. |

Auto-refresh rides the Harness's own `workspaceFiles.changes` directory watch, so
a save in the workspace refreshes the open levels without polling.

## How it works

The Harness's native file tree has no per-row extension point (its rows are
module-local and the package declares no row seat), so a plugin that wants richer
rows must supply the body: a tab type registered at priority `extension` with the
same `kind` (`files`) takes over the builtin, and its body/title are looked up
under the definition's own `id`. That is this plugin's Client half.

Modification time is not available from any Client seam: the `workspaceFiles`
listing carries `{ name, type, size? }` and the file `version` token is opaque by
contract. So the Host half serves one authenticated Fetch route of its own:

```
POST /api/dsh-at-sider/list   { sessionId, path }
  -> { ok: true,  value: { path, root, entries: [{ name, type, mtimeMs, size? }], truncated } }
  -> { ok: false, error: { code, message } }
```

The listing is confined to the session's workspace root (the path is resolved
against it and refused when it escapes), reads at most 2000 entries per level,
and stats with a bounded concurrency of 32 per level. `docs/DESIGN.md` records
the alternatives that were evaluated and why they were rejected.

## Requirements

- DeepSeek Harness `0.1.7-rc.2` (declared as compatible in `package.json`), web profile.
- Node.js 20 or newer (the Host half uses `node:fs/promises`).

## Limitations

- The builtin `files` body is **shadowed**, not composed: while this plugin is
  loaded, the native tree does not render. Uninstalling restores it exactly.
- The Client half mirrors a few private details of the native tree (its row
  ordering, the `dsh-resource://file/...` address grammar, and the composer's
  reference-insertion call). Each has a degradation path — a missing composer
  falls back to the clipboard, a missing watch falls back to the reload button —
  but a future Harness release can still change behaviour. The version this was
  built and tested against is pinned in `dsh.compatibility`.
- Modification times come from `node:fs`, outside the `ctx.fs` policy seam. The
  route therefore applies its own workspace containment and exposes read-only
  listing; it never reads file contents.

## Development

```bash
node --test test/host.test.mjs test/client.test.mjs
```

The Client artifact is plain JavaScript in the browser module-loader format (no
build step); the tests load it the way the module system does — inside
`new Function`, with `window`, `navigator` and `fetch` injected — and drive the
real components through a minimal React shim. 37 tests cover both halves.

## Licence

MIT. See [LICENSE](LICENSE).
