# Installing dsh-at-sider

Three routes, in order of preference. All of them end with a restart of `dsh web`:
the Host half registers a route at load time.

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

A local `link:` dependency is what the sibling `dsh-pubmed` plugin in this
workspace uses, so this is the shape the profile already understands:

```json
"dependencies": { "dsh-at-sider": "link:C:/iWork/github_project/pubmed-mcp-server/dsh-at-sider" }
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
  the `@` button appears on row hover, and each row carries a date on the right.
- Terminal: `dsh web` prints nothing extra on success. A load failure appears as
  a plugin diagnostic with the plugin name.
- If the Files tab looks unchanged, the takeover did not apply: check that the
  bundle id is in `dsh.profile.bundles` **and** that the profile was restarted.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Files tab unchanged | plugin row not loaded, or not restarted | check `dsh.profile.bundles`, restart `dsh web` |
| Tree renders but the date column is empty | the Host route is unavailable (Host half not loaded) | confirm the restart; check that `dsh-at-sider` appears in the composed profile |
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
