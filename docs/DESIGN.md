# dsh-at-sider — design

Why this plugin looks the way it does, with the evidence each decision rests on.
Everything below was verified against an installed DSH `0.1.7-rc.2`
(`~/.dsh/profiles/web`), not from documentation alone.

## 1. The problem

The native right-sidebar file tree (`@deepseek-ai/dsh-client-ui-sidebar-files`)
shows a name and a glyph per row. Two additions were requested:

- an `@` reference affordance on each row, so a path can be mentioned without
  typing the whole thing;
- the entry's modification time, next to it.

The reference implementation for this idea (the third-party
`dsh-better-sidebar`) solves a related problem by shipping its own explorer. Here
the goal is the *native* Files tab, which changes the shape of the solution.

Later releases grew the same takeover into a fuller tree — a size column,
sorting, width-adaptive columns (v0.0.3), a quick filter and locate (v0.1.0),
keyboard navigation with tree semantics (v0.1.0), and a runtime switch back to
the builtin body (v0.1.0, §6) — but the constraint that shaped it has not
changed: everything is built on the native tab kind and the seats the sidebar
shell actually exposes.

## 2. Why the whole body is taken over

The native tree is not extensible per row:

- its `Entry`/`Level` components are module-local and the bundle exports only
  `apply`/`inject`;
- the package declares **zero** slots — only a locale namespace — so no seat
  exists inside the tree, and only the declaring entry may add child slots
  (`ui-slots`: *"Declaring a slot is claiming it"*);
- the keyed seat `sidebar.right.pane.tab` allows one entry per key, so a second
  plugin cannot stack a body on the native one (it can only shadow it at a lower
  priority);
- reading another plugin's DOM or stylesheet is explicitly forbidden by the
  Harness's own plugin-authoring rules.

The supported mechanism is a **tab-type takeover**: a kind carries one `builtin`
and one `extension` registration, the extension is in force, and the body is
dispatched by the `id` of the definition in force. So this plugin registers
`id: 'dsh-at-sider'`, `kind: 'files'`, `priority: 'extension'` and its own body
under its own key — no collision, and the native body resumes the moment the
plugin unloads.

The native *package* declares no slots, but the sidebar **shell** does expose
action seats, and those are what the plugin uses for actions that do not belong
on a row (§6). A seat's absence is a graceful degradation, not a failure: no
menu seat simply means no menu entries.

Consequences accepted deliberately:

- the native body's own store (levels cached across collapse, scroll offset
  persisted per tab) is not reused; this plugin keeps expansion and each tab's
  scroll offset in module-level per-tab memories — so both survive the body
  being unmounted (a file-preview round trip or the runtime fallback toggle) —
  and rereads a level when it is reopened;
- the guide capsule and the `workspace.files` shortcut are contributed by the
  native definition, which the takeover shadows — so this plugin must (and does)
  contribute a guide entry of its own, `order: 10`, `commandId: 'workspace.files'`.

## 3. Where modification time comes from

No Client-callable source carries it:

| Candidate | Why it fails |
|---|---|
| `workspaceFiles.list` | entries are `{ name, type, size? }`; no time field |
| `workspaceFiles.stat` | `{ absolutePath, version, bytes? }`, and it refuses directories |
| `ctx.fs` (`stat`/`lstat`/`listDir`) | `{ version, type, size? }` — no time field |
| the `version` token | documented opaque, *"MUST NOT interpret"* (the local backend does pack `mtimeNs` into it, which is exactly why the contract forbids parsing it) |
| `dsh-workspace-changes` | `{ path, display, added, deleted, binary?, oversized? }` |
| the `file` client resource | `WorkspaceFileStat`, i.e. the opaque version again |
| session projections | fold session events; filesystem state is not session state |

So the Host half reads the directory itself with `node:fs`. That is outside the
`ctx.fs` policy seam, which is why the route owns two extra invariants:

- **containment**: the requested path is resolved against the Session's workspace
  root and refused unless it stays inside it (`root` itself, or `root + '/' + …`;
  Windows comparisons are case-folded);
- **read-only listing**: names, kinds, sizes and `mtimeMs`, never content.

Bounded `stat` concurrency (32) keeps a symlink-heavy or huge directory from
serializing, and the entry cap (2000) matches the native listing cap so the two
trees truncate at the same place.

## 4. Why HTTP routes and not a Remote namespace

The alternative was a Typert Remote namespace (`ctx.remote.$mount` + a Host
service). It is feasible — the Host gateway falls back to "SRC mode" without a
generated manifest — but it was rejected as the riskier option from inside a
third-party plugin:

- the Client gateway rejects any descriptor whose parameter codecs are not
  `mode: 'strict'`, so the artifact must mirror generated output closely;
- endpoint ids are globally unique across packages, and the registry keeps a
  `history` set that never clears: an endpoint that is committed and later
  withdrawn becomes permanently `gateway/definition-unavailable`;
- a malformed `./typert` manifest makes the shared typert-loader fiber throw, so
  one plugin's mistake costs the whole process its Remote definitions;
- the Harness's own client assembly mounts remotes by explicit build-time import,
  so a plugin must mount its own contribution anyway.

The authenticated Fetch route has none of those couplings: it is one
`(Request) => Promise<Response>` registered inside Connection's `/api` trust and
auth fence, and it is the pattern the ecosystem already uses (the installed
`dsh-context` serves three such routes, and in-box features such as deliverables,
file upload and session-log export do the same). A bug here costs one 404/500.

Route shapes:

```
POST /api/dsh-at-sider/list
  { sessionId, path }
  -> 200 { ok: true,  value: { path, root, entries: [{ name, type, mtimeMs, size? }], truncated } }
  -> 200 { ok: false, error: { code, message } }      # domain failures
  -> 400 { ok: false, error: { code: 'bad-request' } } # malformed request

POST /api/dsh-at-sider/search
  { sessionId, query }
  -> 200 { ok: true,  value: { query, matches: [{ name, path, dir, type, mtimeMs, size? }], truncated } }
  -> 200 { ok: false, error: { code, message } }       # domain failures
```

Codes: `bad-request`, `no-workspace`, `outside-workspace`, `not-found`,
`not-directory`, `permission-denied`, `unavailable`. Replies are `no-store`.
The first route is the listing (§3); the second is the quick filter's walk (§7).

## 5. The `@` button's action

The affordance is a labelled chip, not a bare glyph: the row shows `@文件`
(`@folder` → `@文件夹` / `@file` / `@folder` through the plugin's own locale
namespace) right after the file name, so the row says what the click will do.
Clicking it inserts an atomic file reference into the session's composer — the
same outcome the built-in `@` completion and the built-in file drop produce:

```
ctx.get('sessions').scope(sessionId)          -> the retained session scope
ctx.get('conversation').input.for(scope)      -> the session input facade
input.addFiles([{ source: 'reference', ref, label, appearance, clipboardText }], [])
```

Three details matter:

- **both optional services are read defensively.** They are not declared in
  `inject`, so a profile without a conversation surface keeps the plugin active;
  if the scope, the facade, or `addFiles` is missing, the button copies the
  mention instead and says so ("已复制" / "copied");
- **the mention text is built locally** from the shared `@path` grammar
  (workspace-relative, `/`-joined, `@"…"` when it contains whitespace, trailing
  `/` for a directory). It is *not* imported from a Harness Client package: the
  authoring rules forbid requiring one, because such an import changes without
  notice and a throwing component blanks the whole slot entry;
- **⌥/Alt-click copies on purpose**, so the clipboard path is always reachable
  even when insertion succeeds.

The row's outcome label is transient (1.4 s) and the button returns to its noun
label afterwards, so the tree does not accumulate state.

The **same call** backs the preview tab's 「@文件」 menu entry (§6): a previewed
file's address carries its session and path, so the entry can build the identical
reference without any tree context. It has no surface to show the transient
label on, so a clipboard fallback there is silent — the same degradation, one
step quieter.

## 6. The action-menu seam: runtime fallback, reveal, one-click `@`

Actions that do not belong on a row live in the tab's action menu. The seat is:

- `sidebar.right.tab.menu.item` — a **list** seat (session scope). Each entry
  registers `{ name, id, order?, locale? }` under its **own** `id`, and its
  component receives the tab it belongs to (`tab`) plus `dismiss()`, alongside
  the seat's standard props (`sessionId`, `useSessions`, `t`). With no
  registrant the menu shows only the kit's own layout actions.
- the entry is handed **its own tab**, so one registration can scope itself by
  tab type: the toggle renders only for `tab.kind === 'files'`, the reveal and
  `@` entries only for a file preview (a `dsh-resource://file/session/<id>/<path>`
  address, read from `TabRecord.contentId`).

**Runtime fallback (R10).** `sidebarRightTabs.register(definition)` returns a
disposer. Dropping the enhanced definition's registration lets the `files` kind
fall back to its builtin registration, so the native body renders again;
re-registering brings the enhancement back. This is exactly what unloading the
plugin does, which is why the toggle needs no cooperation from the native half
and no uninstall. The trade-off is stated plainly rather than hidden: the
enhanced tree's expansion and scroll offset survive the switch (per-tab module
memories), but the levels cache does not — a returning level is refetched — and
nothing survives a page reload. The store migration the native body enjoys is
ROADMAP R30.

**Reveal in tree (R16).** Client-side navigation carries a parameter bundle:
`ctx.sidebarRight.openTab(kind, { params })` records `params` on the tab as
`tab.navigation.params` and bumps `tab.navigation.revision` on every navigation.
The entry takes the previewed path out of the tab's address and opens the tree
with `{ params: { reveal: path } }`; the body's effect keys on
`[reveal, revision, cwd]`, so revealing the same path twice still re-runs.

Turning "reveal this file" into "which directories must be open" uses the same
`childPath` keys the rows are built from, so the expansion set matches the
rendered rows exactly (`chainOf` normalizes for comparison but constructs keys in
the tree's own form, which matters on Windows where the session's `cwd` spelling
is what every key starts with). The row is then scrolled into view and flashed
through a `data-at-sider-treeitem` hook on the **row** — not its `li` — using the
same outline as the keyboard focus ring (§9); the class is re-asserted during the
flash window because a React re-render of that row would otherwise drop the
manually added class. The seek retries for a few seconds, because the target row
does not exist until the levels above it have been read.

## 7. The quick filter and its search route

The filter searches the whole workspace, not the loaded levels, so it needs its
own route (shape in §4). The Host walk is bounded on purpose:

- `node_modules` and `.git` are skipped — the two directories that would
  otherwise dominate any walk in a real project;
- symlinked directories are listed but never descended, so a symlink loop cannot
  hang the request;
- depth stops at 12 and results stop at 200 (`truncated` says so);
- `stat` — the only call that yields `mtimeMs` — runs **only for the matches**,
  so a wide workspace does not pay a per-entry stat cost;
- containment is the listing route's rule: the walk starts at the Session's
  resolved root and can never leave it.

On the Client side the box is debounced (200 ms) and each query carries a
sequence number, so a slow earlier response can never overwrite a newer one.
While the query is non-empty the result list replaces the tree, whose levels are
left untouched underneath; clearing the query restores it. Results keep the
tree's affordances: the `@` chip inserts a reference, clicking a file opens it,
and clicking a directory clears the filter *and* expands the tree down to that
directory.

## 8. Git state on rows and the header

The tree can say which files differ from the repository: untracked, modified
(unstaged), and staged files each get a coloured dot right after the name, and a
**bottom bar** — pinned under the scrolling tree — shows `⎇ branch ↑ahead
↓behind · short-hash subject (relative age)`. Clicking the bar expands a commit
list **upward** (a panel over the lower part of the tree) with the recent
commits, oldest at the top and the newest at the bottom — next to the bar, with
a HEAD marker. The bar's tooltip carries the full hash, the author, and the
absolute time. Everything degrades to nothing: outside a repository, or without
a git executable, the response says `available: false` and neither the dots, the
bar, nor the panel render.

**Multi-repository workspaces.** A workspace does not have to be a repository
itself: the Host discovers repositories at the workspace root (or the repository
that encloses it), plus every first- and second-level subdirectory holding a
`.git` entry (a directory, or a file for worktrees/submodules). Discovery is
filesystem-only — one `git rev-parse` probe for the enclosing repository, then
two bounded directory levels — and cached like the git state. When more than one
repository is found, the bar gains a **repository selector**; the picked
repository's rel rides the next listing requests (`gitRepo`), and the Host
re-anchors branch, commits, and per-file dots to it. Files outside the selected
repository carry no dot.

The in-box `dsh-workspace-changes` plugin was evaluated first and rejected for
this job: it records **per-turn snapshot diffs** ("what did this turn change",
turn-start vs turn-end numstat), which is a different question from the current
work-tree state (it has no staged/unstaged/untracked semantics), and its records
live only as long as the Session. Its `GitRunner` shape — a subprocess with a
timeout, an output cap, and a scrubed environment, resolving every failure into
facts rather than exceptions — is what this plugin's own bounded runner mirrors.

Mechanics:

- one `git status --porcelain=v1 -z --branch` per **selected repository** gives
  every file's state plus the branch and ahead/behind counts; `git rev-parse
  --show-toplevel --show-prefix` locates the repository and, when the workspace
  root is a subdirectory of it, provides the prefix that maps repository-relative
  status paths onto the workspace's entries; `git log -1` provides the HEAD and
  `git log -n 20` the commit list for the panel (newest first on the wire;
  rendered bottom-anchored).
- the commands run with a 3 s timeout and a 1 MB stdout cap, are cached per root
  for 30 s with in-flight deduplication, and ride the **existing** listing
  route's response — no new route, no new auth surface;
- only `file` entries are annotated (directories never carry a dot); a clean
  file carries no field at all, so the payload stays small;
- a parse or run failure never fails the listing: the response degrades to
  `available: false`.

## 9. Keyboard navigation and accessibility

The rows are a real ARIA tree rather than a list with key handlers added: the
root is `role="tree"`, rows are `role="treeitem"` with `aria-level` and
`aria-expanded`, nested levels are `role="group"`, and the intermediate `li`
elements are `role="none"` so tree items appear as direct children of their group
in the accessibility tree. Focus is roving — rows are `tabIndex=0` only for the
focused path, and before any focus has landed every row is a tab stop so the tree
is still reachable — which is what makes a single Tab leave the tree instead of
walking every row.

| Key | Behaviour |
|---|---|
| ↑ / ↓ | previous / next visible row (across levels) |
| → | collapsed directory expands; expanded directory focuses its first child |
| ← | expanded directory collapses; otherwise focus returns to the parent row |
| Home / End | first / last visible row |
| Enter / Space | open a file, or toggle a directory |
| `@` | insert the focused row's reference (the same call the chip makes) |

The focus ring is an `outline` in the label colour, and the reveal flash (§6)
reuses it deliberately: one visual language for "this row is active". The search
result count is announced through a polite live region, and the result list is a
`listbox` whose rows are `option`s.

## 10. Deliberate deviations from the native body

| Aspect | Native | Here | Why |
|---|---|---|---|
| auto-refresh toggle | rendered but hidden | visible, `aria-pressed` | a control a user cannot see cannot be used; the state is the same |
| root path label | shared `PathLabel` (left-edge fade) | own span, end ellipsis + full-path tooltip | avoids importing a Harness Client package |
| row affordance | none | an `@文件`/`@file` chip after the name (visible on hover/focus) | a bare `@` glyph does not say what it does; the label is the plugin's own copy, localized |
| level caching | cache survives collapse | reread on reopen; expansion and scroll are remembered per tab (module-level memories) | a slot store would be the native-faithful home for all of it (ROADMAP R30); the memories already give the native visible behaviour across preview round trips |
| accessibility | plain rows in a list | `role="tree"` / `treeitem` / `group` with `aria-level`, roving tabindex | a tree that only responds to the mouse is not reachable by keyboard or screen reader |
| whole-workspace search | none | header filter + its own Host route | finding a file should not require expanding the right levels by hand |
| returning to the native tree | uninstall the plugin | right-click the Files tab (runtime toggle, §6) | comparing against the native tree should not cost an uninstall |

### The one guarded exception: the host's own artwork

Icons are **not** re-drawn. The rows use `@deepseek-ai/dsh-client-ui-primitives`'
`FileTypeIcon` + `classifyFileType` (category-coloured, extension-aware: code and
markdown blue, folders amber, images violet, PDFs red, …) and its
`IconFolderOpenRegular`/`IconFolderCloseRegular`, and the guide capsule uses
`GuideArtworkFiles` — the exact calls the native tree makes, so the takeover looks
native. The first version of this plugin instead drew a single monochrome
document glyph; that was a visible regression and the reason for this exception.

This deliberately bends one authoring rule ("do not require a Harness Client
package"), for the reason that rule itself gives: the artwork is 28px
category-coloured art inside a 523 KB bundle that a plugin cannot keep faithful by
copying, and icons are the one thing a user compares directly against the native
tree. The bend is bounded:

- the module is read **once, inside a `try`/`catch`**, and only if
  `FileTypeIcon` *and* `classifyFileType` are functions — a module-table miss, a
  renamed export or a non-function value leaves `host` undefined;
- every icon then falls back to the inline glyphs this plugin ships, so the tree
  renders on a shell that does not seed that module at all;
- the classifier call and the element construction are wrapped, so a changed
  classifier cannot take the tree down with it;
- `CodeFileIcon`-style context-sensitive icons are *not* used: those would need a
  project-file snapshot the tree does not have.

The `data-at-sider-*` hooks let a test assert both paths (host artwork present /
absent), which is what keeps the fallback from rotting.

## 11. What a Harness upgrade can break

Everything the Client half mirrors is listed here so a future failure is easy to
place:

| Depends on | If it changes |
|---|---|
| `kind: 'files'` + `extension` takeover | the takeover stops applying; the native tree renders unchanged |
| `sidebar.right.pane.tab` / `.title` seat keys and props (`useTabInfo`, `sessionId`, `useSessions`, `t`) | the body would not mount, or would mount without its provider props |
| `sidebar.right.tab.menu.item` seat and its owner props (`tab`, `dismiss`) | the menu entries disappear (no toggle, no reveal, no `@`); the tree itself is unaffected |
| `ctx.sidebarRight.openTab(kind, options)` and `tab.navigation.params` / `.revision` | reveal opens the tree but does not expand or flash anything |
| `TabRecord.contentId` / `.kind` | the entries can no longer tell which tab they are on, so they hide |
| `dsh-resource://file/session/<id>/<path>` grammar | the address builder and the address parser in the menu entries would need the new grammar |
| `tab.actions.openResource` / `bindCommands` | file opening, refresh shortcut |
| `conversation.input.for(scope).addFiles` | falls back to copying |
| `remote.$stream` + `remote.workspaceFiles.changes` | auto-refresh becomes a no-op; the reload button still works |
| the primitives exports `FileTypeIcon` / `classifyFileType` / `IconFolder*Regular` / `GuideArtworkFiles` | the inline fallback glyphs render instead (icons only) |
| the `git` executable or the repository state | `available: false` — no dots, no header line; the tree itself is unaffected |
| this plugin's own `/api` routes | unaffected |

## 12. Verification performed

- `node --test test/host.test.mjs test/client.test.mjs` — **78 tests**: containment
  (including the sibling-prefix and `..` cases), per-entry `mtimeMs`, truncation,
  failure-code mapping, bounded concurrency; the listing route's request/response
  contract; `apply()` registering **two** authenticated POST routes and staying
  inert without Connection or the session registry; the cold-session fallback;
  the search walk (skip list, result cap, depth cap, blank query, route end to
  end, `no-workspace`); the git state (porcelain parsing with renames and
  spaced paths, branch/ahead/behind, no-commits-yet, the no-git degradation,
  the per-root cache with in-flight dedup, and a **real repository end to end**
  through the listing route, including a workspace nested inside a repository);
  the artifact's loader registration; the takeover
  definition and its runtime toggle; menu-entry visibility and the reference the
  `@` entry inserts; mention grammar; resource addresses and their parser;
  listing transport failures; composer insertion and the clipboard fallback; the
  button's labels; the host-artwork path and its fallback; the row's box model;
  size formatting, width tiers, sort comparators, the header sort cycle with its
  persistence, and the tier CSS; the quick filter (debounce, result list, chip,
  clearing) and reveal expansion; the expansion memory across an unmount/
  remount; the git dot and the header's git line with their no-git degradation;
  tree semantics (`role` / `aria-level` /
  `aria-expanded`) and the keyboard-navigation branches; and a rendered-tree
  smoke test through a minimal React shim (rows, dates, `@` buttons, a directory
  click, a failure line, the no-workspace state, and both click paths).
- `dsh --profile web --patch ./cordis.patch.yml --dump-config` — the patch layer
  composes and the `dsh-at-sider` row lands in the composed profile.
- The published artifacts: installed from the npm registry into a scratch prefix,
  imported by name, and checked for their `dsh.client` / `dsh.bundle`
  declarations (0.0.1–0.0.4 done at their releases; 0.1.0 published from this
  checkout).

Not verified: the rendered GUI itself, and therefore the actual visual result,
could not be checked in this environment (installing into the profile and
restarting `dsh web` were left to the operator). The operator has since verified
the quick filter and keyboard navigation on a live profile (v0.1.0), and reported
the reveal highlight and the menu font size as issues — both fixed in 0.1.0.
