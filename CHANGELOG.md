# Changelog

## Unreleased

- Feature: **git state on rows and the bottom bar (R40a)** — files that are
  untracked, modified (unstaged), or staged get a coloured dot right after the
  name (with a naming tooltip), and a **bottom bar** pinned under the tree shows
  the branch, ahead/behind, the HEAD commit's short hash, subject, and relative
  age (full hash, author, and time on hover). **Clicking the bar expands the
  commit list upward** — the last 20 commits, oldest at the top and the newest
  at the bottom with a HEAD marker. **Multi-repository workspaces**: when the
  workspace itself is not a repository but its first/second-level
  subdirectories are, the bar gains a repository selector, and the picked
  repository drives the branch/commit info and the per-file dots (the request's
  `gitRepo` field re-anchors every level). Outside a repository, or without a
  git executable, nothing renders. The state rides the existing listing route:
  one bounded `git status --porcelain=v1 -z --branch` (+ `rev-parse`,
  `git log -1`, and `git log -n 20`) per repository, cached 30 s with
  in-flight deduplication, a 3 s timeout and a 1 MB output cap; a workspace that
  is a subdirectory of its repository maps status paths through `--show-prefix`.
- Investigation recorded (ROADMAP §2.4): the in-box `dsh-workspace-changes`
  plugin is a per-turn snapshot diff and cannot serve the current work-tree
  state; its `GitRunner` shape was adopted as the reference. Per-file last-commit
  tooltips are split out as R40b (deferred).

## 0.1.1

- Fix: **the tree's expansion now survives the preview round trip, like the
  native tree.** Opening a file preview unmounts the enhanced body, and coming
  back to the Files tab used to remount it collapsed. Expansion is now
  remembered per tab in the same module-level memory the scroll offset uses
  (written through on every change, restored on mount), so preview round trips
  — and the runtime native-fallback toggle — leave the tree as it was. Still
  not remembered: the level data itself (a returning level is refetched) and
  anything across a page reload; the full slot-store migration remains
  ROADMAP R30.
- Docs: the INSTALL troubleshooting table and both READMEs' update sections
  document the artifact `rev` cache layer — why a restart can look like a no-op
  (an old-rev request is rejected rather than served fresh bytes) and the
  hard-refresh → reinstall ladder.
- Tests: 66 — the test shim now gives every component instance its own hook
  state, addressed by the instance's tree position (the shim's stand-in for
  fibers). That is what makes the expand → unmount → remount flow testable at
  all: the previous flat hook list could not survive tree-shape changes, which
  real trees make constantly.

## 0.1.0

- Feature: **runtime toggle between the enhanced tree and the native one (R10)**
  — the Files tab's actions menu offers 「回退原生文件树」/「启用增强版文件树」:
  dropping the enhanced definition's registration makes the builtin body resume
  immediately (extension semantics), and the same entry brings the enhancement
  back. No uninstall needed.
- Feature: **quick filter / locate (R15)** — a header box searches the whole
  workspace recursively through a new authenticated
  `POST /api/dsh-at-sider/search` route (skips `node_modules`/`.git`, depth cap
  12, 200 results). While the query is non-empty the result list replaces the
  tree; every result carries an `@` chip, clicking a file opens it and clicking
  a directory jumps back to the tree expanded at that folder.
- Feature: **reveal in file tree (R16)** — file-preview tabs get a
  「在文件树中定位」 menu entry that opens the tree with the ancestors expanded
  and the row scrolled into view and briefly highlighted.
- Feature: **@文件 on file previews (R16)** — file-preview tabs also get an
  「@文件」 menu entry that inserts the previewed file's `@` reference into the
  composer in one step — the same chip the tree's `@` button produces.
- Feature: **keyboard navigation and tree semantics (R17)** — roving tabindex,
  ArrowUp/Down to move, ArrowRight/Left to expand/collapse (and out to the
  parent), Home/End, and `@` on the focused row to insert a reference;
  `role="tree"`/`treeitem`/`group` with `aria-level` and a polite live region.
- Polish: **the reveal highlight now lands on the row itself** and mirrors the
  keyboard focus ring (2px outline in the label colour). Previously the flash
  targeted the row's `<li>` and could be swallowed by a React re-render, so it
  was not visible; the class is also re-asserted during the flash window.
- Polish: the two tab-menu entries (runtime fallback, reveal) use the host's
  content font size, matching native menu items such as 「关闭」.
- Docs: the README documents the right-click gestures for both tab-menu entries
  (Harness tabs have no ⋯ button), the reveal behaviour, and a keyboard +
  accessibility reference.
- Tests: 65 — menu-item visibility, the runtime toggle, the search route end to
  end (skip list, result cap, depth cap), the quick-filter UI with its
  debounce, reveal expansion, tree semantics, keyboard navigation, and the
  address parser behind the preview-tab menu entries.

## 0.0.4

- Fix: a Files tab restored right after a restart showed
  “这个会话没有工作区目录。” until a manual reload. Two parts:
  - **Host**: the route resolves the session's workspace root through session
    persistence when the session is not live yet — the same cold-session
    fallback the native `workspaceFiles` scope uses, so a previously-open tab
    lists even before its session resumes.
  - **Client**: a level that still fails with `no-workspace` self-heals with up
    to two spaced retries (1.2 s apart) instead of sitting dead on a failure
    line that only a manual reload would clear.
- Polish: the size and the date form **one right-pinned group** — the size is
  right-aligned inside a fixed box (`min-width: 7ch`, so values line up), a
  two-space gap (`2ch`) separates it from the date, and the group (not the date
  alone) carries the row's `margin-left: auto`. Previously the size floated next
  to the `@` chip while the date sat alone at the edge.

## 0.0.3

- Feature: **size column** — regular files show a humanized size (`870 B`,
  `1.5 KB`, `1.2 MB`) between the name and the date; the date's tooltip carries it
  too (`full time · 1.2 MB`), and the size's own tooltip gives the exact byte
  count.
- Feature: **width-adaptive columns** — the tree measures its own body
  (ResizeObserver) and picks a tier: ≥380px shows every column; 300–379px hides
  the size column; below 300px the chip collapses to a bare `@` and the date to
  `MM-DD HH:mm`. Both time shapes stay in the DOM and the stylesheet picks one, so
  resizing never re-renders the tree.
- Feature: **sortable rows** — a header button cycles 按名称 → 按修改时间 → 按大小 →
  按类型; directories stay first, entries without the field sink to the end, and
  the mode is remembered (localStorage, best-effort).
- Tests: 46 — size formatting, width tiers, sort comparators, the header sort
  cycle with persistence, tier CSS, and the chip's label/noun spans.

## 0.0.2

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
