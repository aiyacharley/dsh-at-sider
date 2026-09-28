# Changelog

## 0.1.0

First release.

- Client half: takes over the builtin `files` sidebar tab kind as an `extension`
  and renders the workspace tree with, per row, an `@` reference button that
  inserts `@path` into the composer (⌥/Alt-click copies the mention, and the
  clipboard is the fallback whenever no composer is reachable) and a modification
  time pinned to the row's far right with a full local-time tooltip.
- Client half: auto-refresh through the Harness's own `workspaceFiles.changes`
  directory watch, a reload control, the workspace-root header, the tab chip
  title, and a guide entry that keeps the native "Workspace files" capsule.
- Host half: one authenticated Fetch route, `POST /api/dsh-at-sider/list`,
  returning each directory's entries with `mtimeMs`, confined to the session's
  workspace root, capped at 2000 entries per level with bounded stat concurrency.
- Tests: 37 unit tests over containment, listing, the route contract and its
  `apply()` wiring, the takeover definition, the mention grammar and address
  builder, composer insertion with its clipboard fallback, and a rendered-tree
  smoke test.
