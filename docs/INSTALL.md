# Installing dsh-at-sider

Three routes, in order of preference. All of them end with a restart of `dsh web`:
the Host half registers its routes at load time.

## 1. Plugin Hub (`install_bundle`)

If the Harness exposes the plugin-manager tool, install the bundle by pointing it
at this directory:

```
install_bundle  target: <absolute path to this directory>
```

That performs the package install and the bundle selection for the active
profile. Read its `application` and `warnings` fields — not terminal output — to
decide whether the change is live.

## 2. CLI

```bash
dsh plugin --profile web add link:C:/path/to/dsh-at-sider
```

> `web` is only the profile name this workspace has used for the CLI. The desktop
> app keeps its own profile (`desktop`). Put the profile that is actually active
> after `--profile`; the plugin behaves the same in either.

Then add the id to the profile's bundle list
(`~/.dsh/profiles/web/package.json`):

```json
{
  "dsh": {
    "profile": {
      "bundles": ["…", "dsh-at-sider"]
    }
  }
}
```

Restart `dsh web` (Ctrl+C, then `dsh web` again).

A local `link:` dependency points the profile straight at this working tree —
handy while developing, and the shape the profile understands (the released
artifacts are installed as ordinary registry versions instead):

```json
"dependencies": { "dsh-at-sider": "link:C:/iWork/github_project/DSH插件开发/dsh-at-sider" }
```

## 3. Verify the composition without installing

```bash
dsh --profile web --patch <path>/dsh-at-sider/cordis.patch.yml --dump-config
```

The composed tree should contain:

```yaml
- id: dsh-at-sider
  name: dsh-at-sider
```

This proves the patch layer parses and applies. It does not load the plugin.

## What to expect after the restart

- The right sidebar's **Files** tab (or `Mod+P`) now shows the enhanced tree:
  the `@` button appears on row hover, each row carries a size and a date on the
  right, and the header has a search box plus a sort button and a reload button.
- **Right-click the Files tab** for 「回退原生文件树」 — the native tree returns
  immediately, and the same entry brings the enhancement back.
- **Right-click a file-preview tab** for 「在文件树中定位」(expand the tree to
  that file and flash the row) and 「@文件」(insert its reference into the
  composer).
- Keyboard: click a row once, then ↑/↓ move, →/← expand/collapse, Home/End jump,
  `@` inserts the focused row's reference, Tab leaves the tree in one step.
- Terminal: `dsh web` prints nothing extra on success. A load failure appears as
  a plugin diagnostic with the plugin name.
- If the Files tab looks unchanged, the takeover did not apply: check that the
  bundle id is in `dsh.profile.bundles` **and** that the profile was restarted.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Restarted but the tree still looks old | the browser or the plugin table is still addressing the previous artifact revision — a client bundle's URL carries a `rev` derived from the file's metadata (mtime/ctime/size), and an old-rev request is **rejected** rather than served fresh bytes | hard-refresh the browser (Ctrl+Shift+R); if still stale, remove and re-add the plugin — a reinstall rescans the artifact and publishes a new revision, even without a restart |
| Files tab unchanged | plugin row not loaded, or not restarted | check `dsh.profile.bundles`, restart `dsh web` |
| Tree renders but the date column is empty | the Host routes are unavailable (Host half not loaded) | confirm the restart; check that `dsh-at-sider` appears in the composed profile |
| The search box finds nothing | same cause as above, or the query is blank | confirm the restart; the search route needs the Host half |
| The tab's right-click menu has no dsh-at-sider entries | the tab is not the Files tab (toggle) or not a file preview (reveal/@) | open that tab type; the entries are deliberately tab-scoped |
| The `@` button copies instead of inserting | no retained session scope, or the composer facade is unavailable | expected fallback; click the row's session first, then retry |
| Dates look stale | auto-refresh off, or the filesystem backend has no watch support | press the reload button |
| Nothing loads at all | manifest/bundle id mismatch | reinstall through route 1 or 2 above |

## Uninstall

```bash
dsh plugin --profile web remove dsh-at-sider
```

Remove the id from `dsh.profile.bundles`, then restart. The native Files tab
returns exactly as it was: this plugin shadows the builtin body, it never
modifies it.

Uninstalling is not the only way back: right-clicking the Files tab offers
「回退原生文件树」 and switches to the native tree at runtime, with the same entry
restoring the enhanced tree afterwards.
