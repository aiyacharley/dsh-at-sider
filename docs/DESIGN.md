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

Consequences accepted deliberately:

- the native body's own store (levels cached across collapse, scroll offset
  persisted per tab) is not reused; this plugin keeps expansion in component
  state, remembers each tab's scroll offset in a module-local map, and rereads a
  level when it is reopened;
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

## 4. Why an HTTP route and not a Remote namespace

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

Route shape:

```
POST /api/dsh-at-sider/list
  { sessionId, path }
  -> 200 { ok: true,  value: { path, root, entries: [{ name, type, mtimeMs, size? }], truncated } }
  -> 200 { ok: false, error: { code, message } }      # domain failures
  -> 400 { ok: false, error: { code: 'bad-request' } } # malformed request
```

Codes: `bad-request`, `no-workspace`, `outside-workspace`, `not-found`,
`not-directory`, `permission-denied`, `unavailable`. Replies are `no-store`.

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

## 6. Deliberate deviations from the native body

| Aspect | Native | Here | Why |
|---|---|---|---|
| auto-refresh toggle | rendered but hidden | visible, `aria-pressed` | a control a user cannot see cannot be used; the state is the same |
| root path label | shared `PathLabel` (left-edge fade) | own span, end ellipsis + full-path tooltip | avoids importing a Harness Client package |
| file glyphs | `FileTypeIcon` per kind | one document glyph | same reason |
| row affordance | none | an `@文件`/`@file` chip after the name (visible on hover/focus) | a bare `@` glyph does not say what it does; the label is the plugin's own copy, localized |
| level caching | cache survives collapse | reread on reopen | component-local state instead of a slot store; the visible result is the same |

## 7. What a Harness upgrade can break

Everything the Client half mirrors is listed here so a future failure is easy to
place:

| Depends on | If it changes |
|---|---|
| `kind: 'files'` + `extension` takeover | the takeover stops applying; the native tree renders unchanged |
| `sidebar.right.pane.tab` / `.title` seat keys and props (`useTabInfo`, `sessionId`, `useSessions`, `t`) | the body would not mount, or would mount without its provider props |
| `dsh-resource://file/session/<id>/<path>` grammar | the address builder is local and would need the new grammar |
| `tab.actions.openResource` / `bindCommands` | file opening, refresh shortcut |
| `conversation.input.for(scope).addFiles` | falls back to copying |
| `remote.$stream` + `remote.workspaceFiles.changes` | auto-refresh becomes a no-op; the reload button still works |
| this plugin's own `/api` route | unaffected |

## 8. Verification performed

- `node --test test/host.test.mjs test/client.test.mjs` — 37 tests: containment
  (including the sibling-prefix and `..` cases), per-entry `mtimeMs`, truncation,
  failure-code mapping, bounded concurrency; the route request/response contract;
  `apply()` registering exactly one authenticated POST route, and staying inert
  without Connection or the session registry; the artifact's loader registration;
  the takeover definition; mention grammar; resource addresses; listing transport
  failures; composer insertion and the clipboard fallback; and a rendered-tree
  smoke test through a minimal React shim (rows, dates, `@` buttons, a directory
  click, a failure line, the no-workspace state, and both click paths).
- `dsh --profile web --patch ./cordis.patch.yml --dump-config` — the patch layer
  composes and the `dsh-at-sider` row lands in the composed profile.

Not verified: the rendered GUI itself, and therefore the actual visual result,
could not be checked in this environment (installing into the profile and
restarting `dsh web` were left to the operator).
