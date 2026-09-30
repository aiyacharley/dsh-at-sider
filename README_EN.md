# dsh-at-sider

[简体中文](README.md) | **English**

[![npm version](https://img.shields.io/npm/v/dsh-at-sider)](https://www.npmjs.com/package/dsh-at-sider)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-at-sider)

> **An `@` reference button, a modification-time and size column, sorting, a quick
> filter and locate for the native sidebar file tree.** Same tab, same entry point,
> same icons, same way of opening files — the right sidebar's **Files** tab stays
> the native one (same `Mod+P`, same guide capsule, same artwork). Each row simply
> gains a **`@file` chip** right after the name plus its **size and modification
> time** pinned to the far right (width-adaptive, sortable); the header gains a
> **whole-workspace search box**; right-clicking a file preview offers one-click
> **`@file`** and **reveal in tree**; and right-clicking the Files tab **switches
> back to the native tree** whenever you want to compare — all of it keyboard
> operable.

---

## Contents

- [🚀 Install (two minutes)](#-install-two-minutes)
- [What it does](#what-it-does)
- [Interaction](#interaction)
- [Keyboard and accessibility](#keyboard-and-accessibility)
- [What stays native](#what-stays-native)
- [How it works](#how-it-works)
- [Known limitations](#known-limitations)
- [Install and uninstall (complete)](#install-and-uninstall-complete)
- [Development and tests](#development-and-tests)
- [Version history](#version-history)
- [Requirements](#requirements)
- [License](#license)

---

## 🚀 Install (two minutes)

**Prerequisites**: [Node.js ≥ 20](https://nodejs.org/), then install the DSH CLI
globally (recommended — you get the `dsh` command):

```bash
npm install -g @deepseek-ai/dsh
dsh web        # boot the DSH web environment (or: npx @deepseek-ai/dsh web)
```

With the app running, one command installs this plugin:

```bash
# one command (official CLI, recommended)
dsh plugin --profile web add dsh-at-sider@latest
# or from GitHub: dsh plugin --profile web add github:aiyacharley/dsh-at-sider
# or from a local checkout: dsh plugin --profile web add /path/to/dsh-at-sider
```

Then **restart DSH** (`dsh web`) and open the right sidebar's **Files** tab (or
press `Mod+P`). Three checks:

1. hover any row — an `@file` chip appears right after the name (`@folder` on
   directories);
2. the row's far right shows its modification time, e.g. `2026-01-02 11:04`, with
   the full local time on hover;
3. click `@file` — the file's `@mention` lands in the composer (hold Alt/⌥ to copy
   the mention instead).

> No configuration. Every install route (agent-driven, manual patch, uninstall) is
> in [Install and uninstall (complete)](#install-and-uninstall-complete).

---

## What it does

| Row element | Behaviour |
|---|---|
| `@file` button (`@folder` on directories) | Inserts `@path` (or `@"path with spaces"`, `@dir/` for directories) into the session's composer as an atomic file reference — the same chip the built-in `@` completion and the built-in file drop produce. Falls back to copying the mention when no composer is reachable. Shown while the row is hovered or focused. |
| `@file` + Alt/⌥-click | Always copies the mention to the clipboard. |
| date column | `YYYY-MM-DD HH:mm` in local time; hover shows the full local date and time. Entries whose stat failed show nothing. |
| size column | Regular files show a humanized size (`870 B`, `1.5 KB`, `1.2 MB`); the date's tooltip carries it, and the size's own tooltip gives the exact byte count. |
| sorting | A header button cycles **name → modified time → size → type**; directories stay first, entries without the field sink to the end, and the mode is remembered (localStorage, best-effort). |
| adaptive columns | The tree measures its own width in three tiers: ≥380px shows every column; 300–379px hides the size column; below 300px the chip collapses to a bare `@` and the date to `MM-DD HH:mm` — nothing gets clipped in narrow sidebars. |
| runtime native fallback (R10) | **Right-click the Files tab** → "Use the native file tree": instantly switches back to the native tree (no plugin uninstall needed); the same entry becomes "Use the enhanced file tree" to switch back. Note: Harness tabs have **no ⋯ button — the entry point is the right-click menu**; the enhanced tree's expansion state is not kept across the switch, and a restart starts enhanced. |
| reveal in file tree (R16) | **Right-click a file-preview tab** → "Reveal in file tree": focuses the tree, expands the ancestor directories, scrolls to the row and briefly highlights it (same outline as the keyboard focus ring). |
| one-click `@file` from a preview (R16) | **Right-click a file-preview tab** → "@file": inserts the previewed file's reference straight into the composer — exactly what the row's `@` chip does, without going back to the tree to find that row. |
| where the entries appear | Both entries are offered only in the right-click menu of **file-preview tabs** — not on the Files tab or other tabs. Harness tabs have no ⋯ button, so the entry point is the right-click menu. |
| git state on rows (R40a) | A **coloured dot** after a file's name marks its work-tree state: untracked (green) / modified, unstaged (amber) / staged (blue), with a naming tooltip. At the **bottom of the sidebar** a git bar shows `⎇ branch ↑ahead ↓behind · latest commit summary (relative age)`; **clicking it expands the commit list upward** (the last 20 commits, newest at the bottom with a ● HEAD marker). **Multiple repositories**: when the workspace itself is not a repository but its first/second-level subdirectories are, the bar gains a **repository selector** — the picked repository drives the branch/commit info and the file dots. Outside a repository — or without a git executable — nothing renders; the state is read with the listing and cached for 30 s. |
| icons | The host's own artwork, unchanged: `FileTypeIcon` + `classifyFileType` (category-coloured per file kind), the line-art folder icons, and `GuideArtworkFiles` for the guide capsule — the very components the native tree draws with. Inline glyphs take over only if those exports are unavailable. |
| header | Workspace root path (full path on hover), an auto-refresh toggle, and a reload button. |
| rows | Directories first, then natural case-insensitive name order — the native tree's own ordering. |

Auto-refresh rides the Harness's own `workspaceFiles.changes` directory watch: a
save in the workspace refreshes the open levels, with no polling.

---

## Interaction

```
📁 src          @folder   2026-01-02 11:04
📄 README.md      @file    2026-01-01 09:12
```

- The chip is hidden until the row is hovered or keyboard-focused; a click inserts
  the reference, Alt/⌥-click copies it, and the button then shows `referenced` /
  `copied` / `failed` for 1.4 s before returning to its noun label.
- Times use a fixed `YYYY-MM-DD HH:mm` shape (no locale drift); the tooltip carries
  the full local time.
- Directories expand level by level; reopening a level rereads it, and
  **expansion plus scroll offset are remembered per tab** — a file-preview round
  trip, or a runtime toggle to the native tree and back, leaves the tree as it
  was (a page reload starts over).

---

## Keyboard and accessibility

Click any row once to move focus into the tree; after that everything is keyboard-only:

| Key | Behaviour |
|---|---|
| ↑ / ↓ | Move focus row by row across the visible rows (across levels) |
| → | Collapsed directory → expand; expanded → focus the first child row |
| ← | Expanded directory → collapse; file/child → focus the parent row |
| Home / End | First / last visible row |
| Enter / Space | Directory = expand/collapse; file = open in the sidebar |
| `@` | Insert that row's reference into the composer |
| Tab | Leaves the whole tree in one step (roving tabindex — no per-row stops) |

Accessibility semantics: the root list is `role="tree"`, rows are
`role="treeitem"` (with `aria-level` / `aria-expanded`), nested levels are
`role="group"`, and the search result count is announced through a polite live
region. The reveal highlight matches the keyboard focus ring.

---

## What stays native

- **Tab identity**: still the `files` kind — the `Mod+P` shortcut, the guide page's
  "Workspace files" capsule and the tab title all come from the same registration.
- **Icons**: the host's category-coloured `FileTypeIcon`, its line-art folder
  icons and its `GuideArtworkFiles` artwork are read from the running app — nothing
  is re-drawn or copied.
- **Opening**: a row click still opens the file in the sidebar through
  `dsh-resource://file/session/...`.
- **Ordering**: directories first, then natural case-insensitive name order.

---

## How it works

The native file tree has no per-row extension point (its row components are
module-local and the package declares no row seat), so richer rows require
supplying the body: a tab type registered at priority `extension` with the same
`kind` (`files`) takes over the builtin, and its body/title are dispatched by the
definition's own `id` — so there is no key collision.

No Client seam carries a modification time: `workspaceFiles` entries are
`{ name, type, size? }`, and the file `version` token is opaque by contract. The
Host half therefore serves two authenticated routes of its own:

```
POST /api/dsh-at-sider/list     { sessionId, path }
  -> { ok: true, value: { path, root, entries: [{ name, type, mtimeMs, size? }], truncated } }

POST /api/dsh-at-sider/search   { sessionId, query }
  -> { ok: true, value: { query, matches: [{ name, path, dir, type, mtimeMs, size? }], truncated } }
```

Both are confined to the session's workspace root (the path is resolved against
it and refused when it escapes) and are read-only (file contents are never
read). The listing reads at most 2000 entries per level and caps `stat`
concurrency at 32; the search walks the whole workspace, skipping
`node_modules`/`.git`, never descending into symlinked directories, with a depth
cap of 12 and 200 results, and stats only the matches.

Three further Client mechanisms: the **action menu**
(`sidebar.right.tab.menu.item`, a list seat whose entries receive the `tab` they
belong to plus `dismiss`) carries 「use the native file tree」, 「reveal in file
tree」 and 「@file」; the **runtime fallback** dispose/re-registers the tab-type
definition (the builtin resumes the moment it is unregistered); **reveal** hands
the target path to the tree through `openTab('files', { params: { reveal } })`,
and the body expands the ancestor chain and flashes the row from
`tab.navigation.params`. [docs/DESIGN.md](docs/DESIGN.md) records every
alternative that was evaluated and rejected.

---

## Known limitations

- The builtin `files` body is **shadowed**, not composed: while this plugin is
  loaded the native tree does not render; uninstalling restores it exactly, and
  right-clicking the Files tab offers 「use the native file tree」 to switch back
  at runtime (no native code is modified either way).
- Expansion and scroll offset are remembered per tab in a module-level memory,
  so preview round trips and the runtime toggle keep the tree as it was; what
  is not kept is the **level data** (a returning level is refetched) and
  anything across a **page reload** — the full slot-store migration is
  ROADMAP R30.
- Git state comes from `git status`/`git log` subprocesses in the Host half
  (30 s cache, in-flight deduplication, timeout and output caps); outside a
  git repository nothing renders. A workspace that is a **subdirectory** of its
  repository maps status paths through `--show-prefix`; rename records count as
  their new path.
- Modification times and the search both come from `node:fs` (the `ctx.fs` seam
  exposes no time field), so both routes carry their own workspace containment.
- The Client half mirrors a few private details of the native tree (row ordering,
  the `dsh-resource://` address grammar, the composer's reference-insertion call,
  the tab action-menu seat, `openTab`'s navigation params and
  `TabRecord.contentId`). Each has a degradation path — a missing composer falls
  back to the clipboard, a missing watch falls back to the reload button, a
  missing menu seat simply means two fewer menu entries — and the version this
  was built and tested against is pinned in `dsh.compatibility`.
- The plugin's inline glyphs only appear when the host artwork is unavailable.

---

## Install and uninstall (complete)

### Install

**1. One command (official CLI, recommended)**

```bash
dsh plugin --profile web add dsh-at-sider@latest
# or from GitHub: dsh plugin --profile web add github:aiyacharley/dsh-at-sider
# or from a local checkout: dsh plugin --profile web add /path/to/dsh-at-sider
```

**2. Paste this to an agent**

````text
[Please install dsh-at-sider persistently (available in every session after a restart)]
1) Determine the DSH profile name (e.g. web; ask first if unsure).
2) Run: dsh plugin --profile <name> add dsh-at-sider@latest
3) Tell the user to restart DSH web (the Host half's listing and search routes register on boot).
4) After the restart, verify: hovering a row in the right sidebar's Files tab shows
   @file, the row's right edge shows a size and a modification time, the header has
   a search box, right-clicking the Files tab offers "use the native file tree", and
   right-clicking an opened file preview offers "reveal in file tree" and "@file".
````

**3. Manual (optional)**

- Profile bundle layer: add `"dsh-at-sider": "link:/path/to/dsh-at-sider"` to
  `dependencies` in `~/.dsh/profiles/<name>/package.json`, add `"dsh-at-sider"` to
  `dsh.profile.bundles`, run `pnpm install`, then restart.
- Or merge the insert row from [cordis.patch.yml](cordis.patch.yml) into your own
  patch layer and restart.

### Update

```bash
dsh plugin --profile web update dsh-at-sider@latest     # or @0.1.1 to pin
```

Restart DSH for the change to take effect.

> Changed `client.js` during development and a restart "did nothing"? A client
> bundle is addressed by a `rev` derived from the file's metadata
> (mtime/ctime/size), and an **old-rev request is rejected rather than served
> fresh bytes**. Hard-refresh the browser first (Ctrl+Shift+R); if it is still
> stale, remove and re-add the plugin — a reinstall rescans the artifact and
> publishes a new revision, even without a restart. A `link:` install points at
> the working tree itself and has not gone stale; this is the revision-stamp
> layer. See the troubleshooting table in [docs/INSTALL.md](docs/INSTALL.md).

### Uninstall

- `dsh plugin --profile web remove dsh-at-sider`, then restart.
- For a local `link:` install: drop the dependency and the `dsh.profile.bundles`
  entry, run `pnpm install`, then restart.
- The native file tree returns exactly as it was.

> Troubleshooting (installed but unchanged, empty date column, …) is in
> [docs/INSTALL.md](docs/INSTALL.md).

---

## Development and tests

```bash
npm test          # node --test, 78 cases, fully offline (no network, no browser; git cases use a real git)
```

- This plugin has **no dependencies and no build step**: `client.js` is the final
  browser module-loader artifact, `index.js` is the Host entry.
- The suite loads `client.js` the way the module system does — inside
  `new Function`, with `window`, `navigator` and `fetch` injected — and drives the
  real components through a minimal React shim: containment, per-level listing and
  `mtimeMs`, both route contracts (listing plus the search skip list, result cap
  and depth cap), the takeover definition and its runtime toggle, menu-entry
  visibility, the `@path` grammar and address parsing, composer insertion with its
  clipboard fallback, the button labels, the host-artwork path and its fallback,
  the row box model, tree semantics (`role`/`aria-level`), the keyboard navigation
  branches, and a rendered-tree smoke test plus the quick-filter and reveal
  interactions.
- Changes: [CHANGELOG.md](CHANGELOG.md). Design: [docs/DESIGN.md](docs/DESIGN.md).
  Releasing: [PUBLISH.md](PUBLISH.md).

---

## Version history

- **v0.1.1** — fix: **the tree's expansion survives the preview round trip now**,
  like the native tree (remembered per tab in a module-level memory; the runtime
  toggle to the native tree and back keeps it too. Level data is still refetched
  on return and a page reload starts over — full migration is ROADMAP R30); the
  INSTALL troubleshooting table and the update sections document the client
  artifact's `rev` cache layer and the hard-refresh → reinstall ladder; the test
  shim scopes hook state per component instance; 66 offline tests.
- **v0.1.0** — first feature release: **runtime native fallback** (right-click the
  Files tab to switch between the enhanced and native trees — no uninstall
  needed); **quick filter / locate** (a header box searching the whole workspace
  recursively — skips node_modules/.git, 200 results — with `@` chips on every
  result; click a file to open it, click a directory to jump back into the tree
  expanded); **reveal in file tree** (right-click a file preview to expand the
  ancestors and highlight the row); **one-click `@file` from a preview**
  (right-click a file preview to insert its reference straight away);
  **keyboard navigation & a11y** (arrows/Home/End/`@`, roving tabindex,
  `role=tree` semantics); 65 offline tests.
- **v0.0.4** — fixed a Files tab restored after a restart showing "no workspace
  directory" until a manual reload (the Host route now resolves the root through
  session persistence for cold sessions; a failed level self-heals with up to two
  spaced retries); size-column layout polish (right-aligned fixed box, two-space
  gap before the date, one right-pinned group); 52 offline tests.
- **v0.0.3** — new size column (humanized bytes + exact tooltip), sortable rows
  (name/modified time/size/type cycle, directories first, remembered preference),
  and width-adaptive columns (≥380px full / 300–379px no size / <300px bare `@` +
  short time); 46 offline tests.
- **v0.0.2** — fixed the clipped modification-time column (the row is
  `border-box` again); file/folder icons are the host's own artwork again
  (`FileTypeIcon` + `classifyFileType`, `IconFolder*Regular`,
  `GuideArtworkFiles`), with the inline glyphs kept as a fallback; the README now
  follows the `dsh-pubmed` layout (Chinese primary + `README_EN.md` + npm/listing
  badges).
- **v0.0.1** — first release: takes over the `files` tab as an `extension` with an
  `@file`/`@folder` reference chip and a modification-time column per row; Host
  half serves `/api/dsh-at-sider/list` (workspace-confined, 2000 entries per
  level, 32 concurrent stats); 41 offline tests.

> Per-version detail is in [git tags](https://github.com/aiyacharley/dsh-at-sider/tags);
> design notes are in [docs/DESIGN.md](docs/DESIGN.md); the roadmap (done/planned/milestones)
> is [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Requirements

- DSH `0.1.7-rc.2` (web profile), the version this was built and tested against
  (declared in `dsh.compatibility`).
- Node.js ≥ 20 (the Host half uses `node:fs/promises`).

---

## License

MIT. See [LICENSE](LICENSE).

- File-type classification and icons (`FileTypeIcon`, `classifyFileType`,
  `IconFolder*Regular`, `GuideArtworkFiles`) come from the DSH-shipped
  `@deepseek-ai/dsh-client-ui-primitives` and are **read at runtime, not copied**;
  the plugin's inline glyphs are only a fallback.
- The tab takeover and its runtime fallback, the `@path` references, the
  modification-time and size columns, sorting and width adaptation, the quick
  filter and its search route, reveal-in-tree and the tab-menu entries, and the
  keyboard navigation with tree semantics are all original to this plugin.
