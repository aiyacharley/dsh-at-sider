# Changelog

## Unreleased

- Fix: the modification-time column could be clipped at the row's right edge. The
  row was `content-box`, so `width:100%` plus its own horizontal padding
  overflowed the scroll container by 20px and the last digit of the minute was cut
  off; `.ats-row` is `border-box` again, which keeps the column inside the row's
  own inset.
- Fix: file and folder icons are the host's own artwork again. The first release
  drew one monochrome document glyph for every file; rows now use the primitives
  package's `FileTypeIcon` + `classifyFileType` (category-coloured and
  extension-aware, as the native tree draws them), its
  `IconFolderOpenRegular`/`IconFolderCloseRegular`, and `GuideArtworkFiles` for
  the guide capsule — each read defensively, with the inline glyphs kept as the
  fallback when the module table does not seed them.
- Docs: the README follows the sibling `dsh-pubmed` layout — `README.md` is the
  Simplified-Chinese primary document, `README_EN.md` is its English mirror, both
  carry the npm-version and dsh-plugin.org badges, and both spell out the install
  steps (one command, agent-driven, manual, update, uninstall).

## 0.0.1

First release.

- Client half: takes over the builtin `files` sidebar tab kind as an `extension`
  and renders the workspace tree with, per row, an `@文件` / `@file` (`@文件夹` /
  `@folder`) reference button that inserts `@path` into the composer (⌥/Alt-click
  copies the mention, and the clipboard is the fallback whenever no composer is
  reachable) and a modification time pinned to the row's far right with a full
  local-time tooltip.
- Client half: auto-refresh through the Harness's own `workspaceFiles.changes`
  directory watch, a reload control, the workspace-root header, the tab chip
  title, and a guide entry that keeps the native "Workspace files" capsule.
- Host half: one authenticated Fetch route, `POST /api/dsh-at-sider/list`,
  returning each directory's entries with `mtimeMs`, confined to the session's
  workspace root, capped at 2000 entries per level with bounded stat concurrency.
- Tests: 37 unit tests over containment, listing, the route contract and its
  `apply()` wiring, the takeover definition, the mention grammar and address
  builder, composer insertion with its clipboard fallback, the button's labels,
  and a rendered-tree smoke test.
