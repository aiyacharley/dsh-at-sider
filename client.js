/**
 * dsh-at-sider — Client half.
 *
 * The native right-sidebar file tree has no per-row extension point: its rows are
 * module-local and the package declares no row seat. The sanctioned way to change
 * what a tab draws is therefore a tab-type takeover: a definition registered at
 * priority `extension` with the SAME kind (`files`) is the one in force, and its
 * body/title are looked up under the definition's own `id`. So this plugin
 * registers its own tree body — same entry point (Files tab, `Mod+P`, the guide
 * capsule), plus two additions on every row:
 *
 *   - an `@` reference button right after the file name: it inserts the canonical
 *     `@path` mention into the composer (the same chip the built-in `@` completion
 *     and the built-in file drop produce), and falls back to copying the mention
 *     when no composer is reachable (or on Alt/⌥-click, on purpose);
 *   - the modification time pinned to the row's far right, with the full local
 *     time as its tooltip.
 *
 * Modification time is not available from any Harness Client seam (the
 * `workspaceFiles` listing carries `{ name, type, size? }` and its `version`
 * token is opaque), so the Host half of this plugin serves it over its own
 * authenticated route; this file only consumes it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-at-sider',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * The live client plugin context, captured by `apply`. Components read the
     * two optional services (`sessions`, `conversation`) through it at click
     * time; everything else arrives in slot props.
     */
    let pluginCtx
    /** R10 toggle controls, filled in by `apply`; tests read them through `__internals`. */
    const controls = {}

    /** This implementation's identity, and the key its body/title register under. */
    const ID = 'dsh-at-sider'
    /** The native tab kind this plugin enhances rather than replaces. */
    const KIND = 'files'
    /** Locale namespace owned by this plugin. */
    const NS = 'atSider'
    /** The Host route that serves the listing with modification times. */
    const ROUTE_PATH = '/api/dsh-at-sider/list'
    /** The Host route that serves recursive file search (R15). */
    const SEARCH_ROUTE_PATH = '/api/dsh-at-sider/search'
    /** How long a row's `@` button shows its outcome before returning to the glyph. */
    const FEEDBACK_MS = 1400
    /** Coalescing window for watch-driven rereads, so one save cannot thrash a level. */
    const REFRESH_DEBOUNCE_MS = 150
    /** Keystroke debounce for the quick-filter box. */
    const SEARCH_DEBOUNCE_MS = 200
    /** Self-heal budget for a `no-workspace` answer: the Host may still be resuming the Session. */
    const NO_WORKSPACE_RETRY_MS = 1200
    const NO_WORKSPACE_RETRY_MAX = 2

    // ───────────────────────────── styles ─────────────────────────────
    // Own prefix, host theme tokens only, copied from the native tree's own
    // metrics so the takeover is visually indistinguishable where it should be.
    const STYLE_TAG_ID = `${ID}/sidebar.css`
    const cssText = `
.ats-root{height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);flex-direction:column;flex:auto;line-height:1.5;display:flex}
.ats-header{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:0 6px 0 16px;display:flex}
.ats-path{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-right:12px;min-width:0;flex:1 1 auto}
.ats-body{scrollbar-gutter:stable;flex:auto;min-height:0;margin-right:2px;padding:8px 0 8px 8px;overflow:auto}
.ats-body::-webkit-scrollbar-track{margin:2px}
.ats-level{margin:0;padding:0;list-style:none}
.ats-level .ats-level{padding-left:18px}
.ats-item{margin:0;padding:0}
.ats-row{box-sizing:border-box;width:100%;min-width:0;color:inherit;font:inherit;text-align:left;border-radius:var(--dsw-radius-md);cursor:pointer;align-items:center;gap:6px;padding:5px 10px;display:flex}
.ats-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ats-row:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}
.ats-main{align-items:center;gap:6px;min-width:0;flex:0 1 auto;display:flex}
.ats-icon{color:var(--dsw-alias-label-tertiary);flex:none}
.ats-fileIcon{flex:none}
.ats-name{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}
.ats-other{color:var(--dsw-alias-label-tertiary);cursor:default}
.ats-row.ats-otherRow:hover{background:0 0}
.ats-ref{flex:none;opacity:0;white-space:nowrap;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid transparent;border-radius:var(--dsw-radius-sm);cursor:pointer;font:inherit;line-height:1;padding:0 4px}
.ats-row:hover .ats-ref,.ats-ref:focus-visible{opacity:1}
.ats-ref:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.ats-ref.ats-refFlash{opacity:1;color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.ats-right{margin-left:auto;flex:none;align-items:baseline;gap:2ch;display:flex}
.ats-size{min-width:7ch;text-align:right;white-space:nowrap;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}
.ats-mtime{white-space:nowrap;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}
.ats-mtimeShort{display:none}
.ats-root[data-at-sider-width="1"] .ats-size,.ats-root[data-at-sider-width="2"] .ats-size{display:none}
.ats-root[data-at-sider-width="1"] .ats-ref .ats-word{display:none}
.ats-root[data-at-sider-width="1"] .ats-mtimeLong{display:none}
.ats-root[data-at-sider-width="1"] .ats-mtimeShort{display:inline}
.ats-revealFlash{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}
.ats-filter{flex:none;width:128px;box-sizing:border-box;background:0 0;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:3px 8px}
.ats-filter::placeholder{color:var(--dsw-alias-label-tertiary)}
.ats-filter:focus-visible{outline:none;border-color:var(--dsw-alias-label-primary)}
.ats-menuItem{width:100%;text-align:left;background:0 0;border:none;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5;padding:6px 12px;display:block}
.ats-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ats-dim{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ats-tool{width:28px;height:28px;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:6px;line-height:1;display:inline-flex}
.ats-tool svg{width:15px;height:15px}
.ats-tool:hover,.ats-tool[aria-pressed=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ats-note{color:var(--dsw-alias-label-tertiary);margin:0;padding:3px 10px;font-size:12px}
.ats-status{flex-direction:column;padding:12px 10px;display:flex}
.ats-statusLine{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);margin:0;line-height:1.6}
.ats-titleIcon{flex:none}
.ats-srOnly{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ats-gitDot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:6px;flex:none;vertical-align:middle}
.ats-gitUntracked{background:var(--dsw-alias-success,#3fb950)}
.ats-gitUnstaged{background:var(--dsw-alias-warning,#d29922)}
.ats-gitStaged{background:var(--dsw-alias-accent,#4c8dff)}
.ats-gitline{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:8px;padding:3px 16px 4px;display:flex;white-space:nowrap;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}
.ats-gitBranch{color:var(--dsw-alias-label-primary);flex:none}
.ats-gitSync{flex:none;font-variant-numeric:tabular-nums}
.ats-gitCommit{overflow:hidden;text-overflow:ellipsis;min-width:0}
.ats-gitTime{flex:none;color:var(--dsw-alias-label-tertiary)}
@media (hover:none){.ats-ref{opacity:1}}
`
    const css = {
      root: 'ats-root',
      header: 'ats-header',
      path: 'ats-path',
      body: 'ats-body',
      level: 'ats-level',
      item: 'ats-item',
      row: 'ats-row',
      main: 'ats-main',
      icon: 'ats-icon',
      fileIcon: 'ats-fileIcon',
      name: 'ats-name',
      other: 'ats-other',
      otherRow: 'ats-otherRow',
      ref: 'ats-ref',
      refFlash: 'ats-refFlash',
      word: 'ats-word',
      right: 'ats-right',
      size: 'ats-size',
      mtime: 'ats-mtime',
      mtimeLong: 'ats-mtimeLong',
      mtimeShort: 'ats-mtimeShort',
      tool: 'ats-tool',
      note: 'ats-note',
      status: 'ats-status',
      statusLine: 'ats-statusLine',
      titleIcon: 'ats-titleIcon',
      filter: 'ats-filter',
      menuItem: 'ats-menuItem',
      dim: 'ats-dim',
      revealFlash: 'ats-revealFlash',
      gitDot: 'ats-gitDot',
      gitUntracked: 'ats-gitUntracked',
      gitUnstaged: 'ats-gitUnstaged',
      gitStaged: 'ats-gitStaged',
      gitline: 'ats-gitline',
      gitBranch: 'ats-gitBranch',
      gitSync: 'ats-gitSync',
      gitCommit: 'ats-gitCommit',
      gitTime: 'ats-gitTime',
    }

    /** Install the stylesheet once per document; unload leaves it for the next load to reuse. */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = ID
      tag.dataset.pluginCss = STYLE_TAG_ID
      tag.textContent = cssText
      document.head.appendChild(tag)
    }

    // ───────────────────────────── helpers ─────────────────────────────
    /** Natural, case-insensitive name order, so `file2` precedes `file10`. */
    const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

    /** Compare two names naturally. */
    function compareByName(left, right) {
      return byName.compare(left.name, right.name)
    }

    /** Keep directories first, then order the non-directories with `byFiles`. */
    function dirsFirst(byFiles) {
      return (left, right) => {
        const group = Number(right.type === 'directory') - Number(left.type === 'directory')
        return group !== 0 ? group : byFiles(left, right)
      }
    }

    /** Numeric sort key that sends entries without the field to the very end. */
    function numericKey(entry, field) {
      const value = entry[field]
      return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
    }

    /** The file's extension, lower-cased; `''` when the name has none. */
    function extensionOf(name) {
      const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1
      return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
    }

    const TYPE_RANK = { directory: 0, file: 1, other: 2 }

    /**
     * Display comparators. Directories stay first in every mode (the tree's own
     * feel), except that `type` orders by the entry kind itself — which puts
     * directories first anyway. `time`/`size` are descending; entries without
     * the field sink to the end, ties break by name.
     */
    const SORTERS = {
      name: dirsFirst(compareByName),
      time: dirsFirst((left, right) => numericKey(right, 'mtimeMs') - numericKey(left, 'mtimeMs') || compareByName(left, right)),
      size: dirsFirst((left, right) => numericKey(right, 'size') - numericKey(left, 'size') || compareByName(left, right)),
      type: (left, right) => (TYPE_RANK[left.type] ?? 9) - (TYPE_RANK[right.type] ?? 9)
        || byName.compare(extensionOf(left.name), extensionOf(right.name))
        || compareByName(left, right),
    }

    /** The sort modes in cycle order, and the default. */
    const SORT_KEYS = ['name', 'time', 'size', 'type']
    const SORT_DEFAULT = 'name'
    const SORT_STORAGE_KEY = 'dsh-at-sider:sort'

    /** The next mode after `sort` in the header button's cycle. */
    function nextSort(sort) {
      const at = SORT_KEYS.indexOf(sort)
      return SORT_KEYS[(at === -1 ? 0 : at + 1) % SORT_KEYS.length]
    }

    /**
     * The remembered sort mode, or the default. Storage is best-effort: a
     * missing or refusing `localStorage` costs nothing but the memory.
     */
    function loadSortPref() {
      try {
        const value = localStorage?.getItem?.(SORT_STORAGE_KEY)
        return SORT_KEYS.includes(value) ? value : SORT_DEFAULT
      } catch {
        return SORT_DEFAULT
      }
    }

    /** Remember the sort mode; a refusing storage is silently ignored. */
    function saveSortPref(sort) {
      try {
        localStorage?.setItem?.(SORT_STORAGE_KEY, sort)
      } catch {
        // private mode / quota / absent API: the preference just lives shorter
      }
    }

    /**
     * Order one level for display.
     * @param {readonly { name: string, type: string, mtimeMs?: number, size?: number }[]} entries - listed entries.
     * @param {string} [sort] - one of {@link SORT_KEYS}; defaults to name order.
     * @returns {object[]} a new, ordered array.
     */
    function orderEntries(entries, sort = SORT_DEFAULT) {
      return [...entries].sort(SORTERS[sort] ?? SORTERS[SORT_DEFAULT])
    }

    /**
     * Which column set fits the tree body's measured width.
     * @param {number} px - the body's content-box width.
     * @returns {number} 3 = everything (`@文件` + size + full time); 2 = hide the
     *   size column; 1 = bare `@` chip + short `MM-DD HH:mm`.
     */
    function widthTier(px) {
      if (typeof px !== 'number' || !Number.isFinite(px)) return 3
      if (px >= 380) return 3
      if (px >= 300) return 2
      return 1
    }

    /**
     * The absolute path of one child: joined with `/` whatever the parent's
     * separators, so a level key stays stable across platforms.
     * @param {string} parent - absolute listed directory.
     * @param {string} name - the child's basename.
     * @returns {string} the child's absolute path.
     */
    function childPath(parent, name) {
      return `${parent.replace(/[/\\]+$/, '')}/${name}`
    }

    /** `YYYY-MM-DD HH:mm` in local time: fixed width, no locale drift. */
    function formatMtime(mtimeMs) {
      if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return ''
      const date = new Date(mtimeMs)
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** The full local time for a row's tooltip. */
    function formatFullMtime(mtimeMs) {
      if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return ''
      return new Date(mtimeMs).toLocaleString()
    }

    /**
     * A commit's relative age, localized through the plugin dictionary
     * ('just now' / 'N min ago' / …); beyond a month it falls back to the
     * absolute date shape.
     * @param {number} mtimeMs - epoch milliseconds.
     * @param {(key: string, params?: Record<string, string>) => string} t - the dictionary lookup.
     * @returns {string} the relative text.
     */
    function relativeAgeText(mtimeMs, t) {
      if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return ''
      const seconds = Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000))
      if (seconds < 60) return t('time.now')
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return t('time.minutes', { n: String(minutes) })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('time.hours', { n: String(hours) })
      const days = Math.floor(hours / 24)
      if (days < 30) return t('time.days', { n: String(days) })
      return formatMtime(mtimeMs)
    }

    /** `MM-DD HH:mm` in local time: the narrow-width form. */
    function formatMtimeShort(mtimeMs) {
      if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return ''
      const date = new Date(mtimeMs)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /**
     * Humanize a byte count: `870 B`, `1.5 KB`, `1.2 MB`… one decimal below 100,
     * none above; `''` for anything that is not a usable count.
     */
    function formatSize(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
      if (bytes < 1024) return `${bytes} B`
      const units = ['KB', 'MB', 'GB', 'TB', 'PB']
      let value = bytes
      let unit = 'B'
      for (const next of units) {
        value /= 1024
        unit = next
        if (value < 1024) break
      }
      const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
      return `${text} ${unit}`
    }

    /** A row's time tooltip: the full local time, plus the exact size when known. */
    function mtimeTitle(mtimeMs, size) {
      const time = formatFullMtime(mtimeMs)
      const humanSize = formatSize(size)
      return humanSize === '' ? time : `${time} · ${humanSize}`
    }

    /** Whether a path uses a Windows drive or UNC prefix. */
    function isWindowsStylePath(value) {
      return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
    }

    /** Whether a path is absolute in either spelling the Host accepts. */
    function isAbsoluteWorkspacePath(path) {
      return typeof path === 'string' && (path.startsWith('/') || isWindowsStylePath(path))
    }

    /**
     * A path relative to the workspace root when it lives inside it, else the
     * path as given; `/`-separated either way, `''` for the root itself.
     * @param {string | undefined} root - the session's workspace root.
     * @param {string} path - absolute path.
     * @returns {string} the path to name in a mention.
     */
    function relativeToRoot(root, path) {
      const normalized = path.replace(/\\/g, '/')
      if (typeof root !== 'string' || root === '') return normalized
      const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
      if (base === '') return normalized
      const fold = isWindowsStylePath(base)
      const left = fold ? base.toLowerCase() : base
      const right = fold ? normalized.toLowerCase() : normalized
      if (right === left) return ''
      if (right.startsWith(`${left}/`)) return normalized.slice(base.length + 1)
      return normalized
    }

    /**
     * The canonical `@` mention of one entry: the natural text the shared
     * `@path` grammar defines, quoted when the path carries whitespace and
     * trailing-slashed for a directory.
     * @param {string | undefined} root - the session's workspace root.
     * @param {string} path - the entry's absolute path.
     * @param {boolean} isDir - whether the entry is a directory.
     * @returns {string | undefined} the mention, or undefined when unrepresentable.
     */
    function mentionFor(root, path, isDir) {
      const relative = relativeToRoot(root, path)
      const named = isDir && relative !== '' ? `${relative}/` : relative
      if (named === '') return undefined
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(named)) return undefined
      return /\s/u.test(named) ? `@"${named}"` : `@${named}`
    }

    /** Component-encode one id or path segment, keeping `:` literal for drive letters. */
    function encodeSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':')
    }

    /** Encode a `/`-separated path segment by segment. */
    function encodePath(path) {
      return path.split('/').map(encodeSegment).join('/')
    }

    /**
     * The `dsh-resource://file/session/<id>/<path>` address of one file, built
     * exactly as the shared workspace-path helper does.
     * @param {string} sessionId - the authorizing session.
     * @param {string | undefined} cwd - that session's workspace root.
     * @param {string} path - absolute or workspace-relative path.
     * @returns {string} the resource address.
     */
    function fileAddressFor(sessionId, cwd, path) {
      const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      const inside = (() => {
        if (!(/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/') || normalized.startsWith('\\\\'))) return normalized
        const root = typeof cwd === 'string' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
        const fold = isWindowsStylePath(root)
        const left = fold ? root.toLowerCase() : root
        const right = fold ? normalized.toLowerCase() : normalized
        if (root === '' ) return normalized
        if (right === left) return ''
        if (right.startsWith(`${left}/`)) return normalized.slice(root.length + 1)
        return normalized
      })()
      return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encodePath(inside)}`
    }

    /** Accept one host entry, dropping anything malformed. */
    function entryOf(raw) {
      if (typeof raw !== 'object' || raw === null) return undefined
      const name = typeof raw.name === 'string' ? raw.name : undefined
      if (name === undefined || name === '') return undefined
      const type = raw.type === 'directory' || raw.type === 'file' || raw.type === 'other' ? raw.type : 'other'
      const entry = { name, type }
      if (typeof raw.mtimeMs === 'number' && Number.isFinite(raw.mtimeMs)) entry.mtimeMs = raw.mtimeMs
      if (typeof raw.size === 'number' && Number.isFinite(raw.size)) entry.size = raw.size
      if (raw.git === 'staged' || raw.git === 'unstaged' || raw.git === 'untracked') entry.git = raw.git
      return entry
    }

    /** One failure value, in the shape the tree renders. */
    function failureOf(code, message) {
      return { code, message }
    }

    /**
     * Read one directory level through this plugin's Host route.
     * @param {string} sessionId - the authorizing session.
     * @param {string} path - absolute directory path.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<{ ok: true, value: object } | { ok: false, error: { code: string, message: string } }>} the level.
     */
    async function listDirectory(sessionId, path, signal) {
      try {
        const response = await fetch(ROUTE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, path }),
          credentials: 'same-origin',
          signal,
        })
        let payload
        try {
          payload = await response.json()
        } catch {
          return { ok: false, error: failureOf('unavailable', `HTTP ${response.status}`) }
        }
        if (typeof payload !== 'object' || payload === null) {
          return { ok: false, error: failureOf('unavailable', `HTTP ${response.status}`) }
        }
        if (payload.ok === true) {
          const value = payload.value
          const entries = Array.isArray(value?.entries) ? value.entries.map(entryOf).filter((entry) => entry !== undefined) : undefined
          if (entries === undefined) return { ok: false, error: failureOf('unavailable', 'malformed listing') }
          // R40a: the workspace's git block rides the listing; only a well-formed
          // `available: true` block is forwarded, everything else degrades.
          const rawGit = value?.git
          const git = rawGit?.available === true
            ? {
              available: true,
              branch: typeof rawGit.branch === 'string' ? rawGit.branch : undefined,
              ahead: typeof rawGit.ahead === 'number' ? rawGit.ahead : 0,
              behind: typeof rawGit.behind === 'number' ? rawGit.behind : 0,
              head: rawGit.head !== null && typeof rawGit.head === 'object'
                ? {
                  hash: typeof rawGit.head.hash === 'string' ? rawGit.head.hash : '',
                  subject: typeof rawGit.head.subject === 'string' ? rawGit.head.subject : '',
                  author: typeof rawGit.head.author === 'string' ? rawGit.head.author : '',
                  time: typeof rawGit.head.time === 'number' ? rawGit.head.time : undefined,
                }
                : undefined,
            }
            : { available: false }
          return {
            ok: true,
            value: {
              path: typeof value.path === 'string' ? value.path : path,
              root: typeof value.root === 'string' ? value.root : undefined,
              entries,
              truncated: value.truncated === true,
              git,
            },
          }
        }
        const error = payload.error
        return {
          ok: false,
          error: failureOf(
            typeof error?.code === 'string' ? error.code : 'unavailable',
            typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
          ),
        }
      } catch (cause) {
        if (signal?.aborted === true) return { ok: false, error: failureOf('aborted', 'aborted') }
        return { ok: false, error: failureOf('unavailable', cause instanceof Error ? cause.message : String(cause)) }
      }
    }

    /** Accept one search match, dropping anything malformed. */
    function matchOf(raw) {
      if (typeof raw !== 'object' || raw === null) return undefined
      const name = typeof raw.name === 'string' ? raw.name : undefined
      const path = typeof raw.path === 'string' && raw.path !== '' ? raw.path : undefined
      if (name === undefined || path === undefined) return undefined
      const type = raw.type === 'directory' || raw.type === 'file' || raw.type === 'other' ? raw.type : 'other'
      const match = { name, path, dir: typeof raw.dir === 'string' ? raw.dir : '', type }
      if (typeof raw.mtimeMs === 'number' && Number.isFinite(raw.mtimeMs)) match.mtimeMs = raw.mtimeMs
      if (typeof raw.size === 'number' && Number.isFinite(raw.size)) match.size = raw.size
      return match
    }

    /**
     * Recursive workspace search through the Host route (R15).
     * @param {string} sessionId - the authorizing session.
     * @param {string} query - the substring to look for.
     * @returns {Promise<{ ok: true, value: object } | { ok: false, error: { code: string, message: string } }>} the matches.
     */
    async function searchWorkspace(sessionId, query) {
      try {
        const response = await fetch(SEARCH_ROUTE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, query }),
          credentials: 'same-origin',
        })
        let payload
        try {
          payload = await response.json()
        } catch {
          return { ok: false, error: failureOf('unavailable', `HTTP ${response.status}`) }
        }
        if (typeof payload !== 'object' || payload === null) {
          return { ok: false, error: failureOf('unavailable', `HTTP ${response.status}`) }
        }
        if (payload.ok === true) {
          const matches = Array.isArray(payload.value?.matches) ? payload.value.matches.map(matchOf).filter((match) => match !== undefined) : undefined
          if (matches === undefined) return { ok: false, error: failureOf('unavailable', 'malformed search reply') }
          return {
            ok: true,
            value: { matches, truncated: payload.value.truncated === true },
          }
        }
        const error = payload.error
        return {
          ok: false,
          error: failureOf(
            typeof error?.code === 'string' ? error.code : 'unavailable',
            typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
          ),
        }
      } catch (cause) {
        return { ok: false, error: failureOf('unavailable', cause instanceof Error ? cause.message : String(cause)) }
      }
    }

    /** Copy one mention to the clipboard; false when the browser refuses. */
    async function copyText(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined
          && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        return false
      }
      return false
    }

    /**
     * Insert one reference chip into the session's composer — the same
     * `{ insert: ReferenceInsert }` outcome the built-in `@` source and the
     * built-in file drop produce. Optional services are read defensively so a
     * profile without a conversation surface simply falls back to copying.
     * @param {object} ctx - the client plugin context.
     * @param {string} sessionId - the session whose composer receives the chip.
     * @param {{ source: string, ref: string, label: string, appearance: string, clipboardText: string }} reference - the chip.
     * @returns {boolean} whether the input machine applied it.
     */
    function insertReference(ctx, sessionId, reference) {
      const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined
      const scope = typeof sessions?.scope === 'function' ? sessions.scope(sessionId) : undefined
      if (scope === undefined || scope === null) return false
      const conversation = ctx.get('conversation')
      const resolver = conversation?.input
      const input = typeof resolver?.for === 'function' ? resolver.for(scope) : undefined
      const addFiles = input?.addFiles
      if (typeof addFiles !== 'function') return false
      return addFiles.call(input, [reference], []) === true
    }

    /**
     * One row's whole reference action, shared by the `@` button and the
     * keyboard's `@` key: insert the mention into the composer, or copy it
     * (Alt/⌥-click, or whenever no composer is reachable).
     * @param {string} sessionId - the session whose composer receives the chip.
     * @param {string | undefined} root - the session's workspace root.
     * @param {string} path - the entry's absolute path.
     * @param {{ name: string, type: string }} entry - the entry.
     * @param {boolean} copyOnly - skip insertion and copy unconditionally.
     * @returns {Promise<'inserted' | 'copied' | 'failed'>} the outcome.
     */
    async function performReference(sessionId, root, path, entry, copyOnly) {
      const isDir = entry.type === 'directory'
      const mention = mentionFor(root, path, isDir)
      if (mention === undefined) return 'failed'
      if (copyOnly !== true) {
        let inserted = false
        try {
          inserted = insertReference(pluginCtx, sessionId, {
            source: 'reference',
            ref: mention,
            label: isDir ? `${entry.name}/` : entry.name,
            appearance: isDir ? 'folder' : 'file',
            clipboardText: mention,
          })
        } catch {
          inserted = false
        }
        if (inserted) return 'inserted'
      }
      return (await copyText(mention)) ? 'copied' : 'failed'
    }

    /**
     * The session id and workspace path of a
     * `dsh-resource://file/session/<id>/<path>` address, or undefined for
     * anything else (non-file resources, absolute addresses without a session,
     * malformed ids).
     * @param {unknown} address - the tab's content address.
     * @returns {{ sessionId: string, path: string } | undefined} the decoded parts.
     */
    function fileAddressParts(address) {
      if (typeof address !== 'string') return undefined
      const prefix = 'dsh-resource://file/session/'
      if (!address.startsWith(prefix)) return undefined
      const rest = address.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash <= 0) return undefined
      const sessionId = rest.slice(0, slash)
      const encoded = rest.slice(slash + 1)
      if (encoded === '') return undefined
      try {
        const path = encoded.split('/').map((segment) => decodeURIComponent(segment)).join('/')
        return path === '' ? undefined : { sessionId, path }
      } catch {
        return undefined
      }
    }

    /**
     * The workspace path of a `dsh-resource://file/session/<id>/<path>` address,
     * or undefined for anything else (non-file resources, absolute addresses
     * without a session, malformed ids).
     * @param {unknown} address - the tab's content address.
     * @returns {string | undefined} the decoded path.
     */
    function revealPathFromAddress(address) {
      return fileAddressParts(address)?.path
    }

    /**
     * The `childPath`-key chain from `fromDir` down to `target`'s parent, or []
     * when the target is outside it. Comparison is `/`-normalized; construction
     * keeps the tree's own key form, so the produced keys match the rendered
     * rows exactly.
     * @param {string} fromDir - the directory the chain starts at.
     * @param {string} target - the entry to reveal.
     * @returns {string[]} the ancestor directory keys, top-down.
     */
    function chainOf(fromDir, target) {
      const base = typeof fromDir === 'string' ? fromDir.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      const norm = typeof target === 'string' ? target.replace(/\\/g, '/') : ''
      if (base === '' || norm === '' || norm === base || !norm.startsWith(`${base}/`)) return []
      const segments = norm.slice(base.length + 1).split('/').filter((segment) => segment !== '')
      segments.pop()
      const chain = []
      let current = fromDir
      for (const segment of segments) {
        current = childPath(current, segment)
        chain.push(current)
      }
      return chain
    }

    /** Quote a value for an exact-match attribute selector. */
    function attrSelector(name, value) {
      return `[${name}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
    }

    /** R16: ask the sidebar to open (or focus) the enhanced tree and reveal `path`. */
    function requestReveal(path) {
      try {
        const sidebarRight = pluginCtx?.sidebarRight
          ?? (typeof pluginCtx?.get === 'function' ? pluginCtx.get('sidebarRight') : undefined)
        if (typeof sidebarRight?.openTab === 'function') sidebarRight.openTab(KIND, { params: { reveal: path } })
      } catch {
        // navigation is best-effort: the menu simply closes
      }
    }

    /** R16: the file-preview tab's "reveal in tree" menu entry. */
    function RevealMenuItem({ tab, dismiss, t }) {
      const path = revealPathFromAddress(tab?.contentId)
      if (tab?.kind === KIND || path === undefined) return null
      return h('button', {
        type: 'button',
        className: css.menuItem,
        onClick: () => {
          dismiss()
          requestReveal(path)
        },
      }, t('menu.reveal'))
    }

    /**
     * R16: the file-preview tab's one-click "@文件" menu entry — the same
     * reference chip the tree's `@` button produces, without visiting the tree.
     * The previewed address carries both the session and the path, so the
     * mention works even though a menu item has no tree context.
     */
    function ReferenceMenuItem({ tab, dismiss, useSessions, t }) {
      const parts = fileAddressParts(tab?.contentId)
      if (tab?.kind === KIND || parts === undefined) return null
      const cwd = typeof useSessions === 'function'
        ? useSessions((sessions) => sessions.byId?.[parts.sessionId]?.cwd)
        : undefined
      const name = parts.path.slice(parts.path.lastIndexOf('/') + 1) || parts.path
      const onPick = () => {
        dismiss()
        performReference(parts.sessionId, cwd, parts.path, { name, type: 'file' }, false).catch(() => {})
      }
      return h('button', {
        type: 'button',
        className: css.menuItem,
        onClick: onPick,
      }, t('menu.reference'))
    }

    /**
     * Roving keyboard navigation inside the tree (R17): focus the previous/next
     * visible row, jump to the first/last one, or expand/collapse with the
     * left/right arrows. Returns whether the key was handled.
     * @param {KeyboardEvent} event - the row's keydown event.
     * @param {{ isDir: boolean, isOpen: boolean, path: string, parent: string, onToggle: (path: string) => void }} info - the row's tree facts.
     * @returns {boolean} whether the key was consumed.
     */
    function treeKeyDown(event, info) {
      const key = event.key
      if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'ArrowRight' && key !== 'ArrowLeft'
        && key !== 'Home' && key !== 'End') return false
      const row = event.currentTarget
      const body = typeof row?.closest === 'function' ? row.closest('[data-at-sider-body]') : null
      if (body === null || typeof body.querySelectorAll !== 'function') return false
      const rows = Array.from(body.querySelectorAll('[role="treeitem"]'))
      const index = rows.indexOf(row)
      if (index === -1) return false
      const focusRow = (target) => {
        if (target !== undefined && target !== null && typeof target.focus === 'function') target.focus()
      }
      switch (key) {
        case 'ArrowDown':
          focusRow(rows[Math.min(index + 1, rows.length - 1)])
          return true
        case 'ArrowUp':
          focusRow(rows[Math.max(index - 1, 0)])
          return true
        case 'Home':
          focusRow(rows[0])
          return true
        case 'End':
          focusRow(rows[rows.length - 1])
          return true
        case 'ArrowRight':
          if (info.isDir && !info.isOpen) info.onToggle(info.path)
          else focusRow(rows[Math.min(index + 1, rows.length - 1)])
          return true
        case 'ArrowLeft':
          if (info.isDir && info.isOpen) info.onToggle(info.path)
          else focusRow(rows.find((candidate) => candidate.getAttribute('data-at-sider-path') === info.parent))
          return true
        default:
          return false
      }
    }

    // ───────────────────────────── icons ─────────────────────────────
    // ───────────────────────────── host artwork ─────────────────────────────
    /**
     * The host's own icon vocabulary, when the browser module table exposes it.
     *
     * The plugin-authoring guidance tells a third-party plugin not to require a
     * Harness Client package: such an import changes without notice, a plain-JS
     * plugin has no type check, and a throwing component blanks the slot entry.
     * This plugin makes one deliberate, guarded exception for the five exports
     * the native file tree itself draws with — `FileTypeIcon`,
     * `classifyFileType`, `IconFolderOpenRegular`, `IconFolderCloseRegular` and
     * the guide artwork — because hand-copying 28px category-coloured artwork is
     * exactly the kind of thing a plugin cannot keep faithful, and the tree is
     * meant to look native. The read is total: a module-table miss, a renamed
     * export, or a non-function value all leave `host` undefined, and the inline
     * fallback glyphs below render instead.
     */
    const host = (() => {
      try {
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
        if (typeof primitives?.FileTypeIcon !== 'function') return undefined
        if (typeof primitives?.classifyFileType !== 'function') return undefined
        return primitives
      } catch {
        return undefined
      }
    })()

    const svgProps = (size) => ({
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': true,
      focusable: false,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    })

    /** The inline folder sheet, used only when the host artwork is unavailable. */
    function FallbackFolderIcon({ open, size = 16, className = css.icon }) {
      const path = open
        ? 'M1.5 12.5V4a1 1 0 0 1 1-1h3.2l1.3 1.6h6a1 1 0 0 1 1 1v1H5.4a1 1 0 0 0-.95.68L3 12.5H1.5Z'
        : 'M1.5 12V4a1 1 0 0 1 1-1h3.2l1.3 1.6h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z'
      return h('svg', { ...svgProps(size), className }, h('path', { d: path }))
    }

    /** The inline document sheet, used only when the host artwork is unavailable. */
    function FallbackFileIcon({ size = 16 }) {
      return h('svg', { ...svgProps(size), className: css.icon },
        h('path', { d: 'M4 1.5h5l3 3v10H4z' }),
        h('path', { d: 'M9 1.5v3h3' }))
    }

    /**
     * A folder row's glyph: the host's line-art folder, exactly as the native
     * tree draws it, with the inline sheet as the fallback.
     */
    function FolderIcon({ open, size = 16, className = css.icon }) {
      const HostIcon = open === true ? host?.IconFolderOpenRegular : host?.IconFolderCloseRegular
      if (typeof HostIcon === 'function') return h(HostIcon, { size, className })
      return h(FallbackFolderIcon, { open, size, className })
    }

    /**
     * A file row's glyph: the host's category-coloured, extension-aware icon
     * (`code` blue, `markdown` blue, `image` violet, `pdf` red …) — the same call
     * the native tree makes — with the inline sheet as the fallback.
     */
    function FileIcon({ name, size = 16 }) {
      if (host !== undefined) {
        try {
          return h(host.FileTypeIcon, { kind: host.classifyFileType(name ?? ''), size, className: css.fileIcon })
        } catch {
          // A malformed name or a changed classifier: keep the row.
        }
      }
      return h(FallbackFileIcon, { size })
    }

    /** The tab chip's folder sheet: the host's folder category icon when available. */
    function TitleIcon() {
      if (host !== undefined) {
        try {
          return h(host.FileTypeIcon, { kind: 'folder', size: 16, className: css.titleIcon })
        } catch {
          // fall through
        }
      }
      return h(FallbackFolderIcon, { size: 16, className: css.titleIcon })
    }

    /** The guide capsule's artwork: the host's Files artwork when available. */
    function GuideIcon(props) {
      const Artwork = host?.GuideArtworkFiles
      if (typeof Artwork === 'function') {
        try {
          return h(Artwork, { size: props?.size ?? 16, className: props?.className })
        } catch {
          // fall through
        }
      }
      return h(FallbackFolderIcon, { size: props?.size ?? 16, className: props?.className })
    }

    /** The refresh control's glyph. */
    function RefreshIcon() {
      return h('svg', svgProps(15),
        h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6' }),
        h('path', { d: 'M13.5 2.5v3.2h-3.2' }))
    }

    /** The sort control's glyph: three bars of decreasing length. */
    function SortIcon() {
      return h('svg', svgProps(15),
        h('path', { d: 'M3 4.5h10' }),
        h('path', { d: 'M3 8h6.5' }),
        h('path', { d: 'M3 11.5h3' }))
    }

    /** The auto-refresh toggle's glyph: playing when on, paused when off. */
    function AutoRefreshIcon({ on }) {
      return h('svg', svgProps(15), on
        ? h('path', { d: 'M6 4.5v7M10 4.5v7' })
        : h('path', { d: 'M6.5 4.2v7.6L12 8z' }))
    }

    // ───────────────────────────── components ─────────────────────────────

    /** One row's `@` button: insert into the composer, or copy on Alt/⌥-click. */
    function RefButton({ sessionId, root, path, entry, t }) {
      const [state, setState] = React.useState('idle')
      const timer = React.useRef(0)
      React.useEffect(() => () => {
        if (timer.current !== 0) window.clearTimeout(timer.current)
      }, [])
      const flash = (next) => {
        setState(next)
        if (timer.current !== 0) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setState('idle'), FEEDBACK_MS)
      }
      const isDir = entry.type === 'directory'
      const onClick = async (event) => {
        event.preventDefault()
        event.stopPropagation()
        flash(await performReference(sessionId, root, path, entry, event.altKey === true))
      }
      // Idle reads `@文件`/`@文件夹`; the noun is its own span so the narrow
      // width tier can collapse the chip back to a bare `@` glyph.
      const label = state === 'idle'
        ? [
            h('span', { key: 'glyph' }, '@'),
            h('span', { key: 'word', className: css.word }, t(isDir ? 'ref.nounFolder' : 'ref.nounFile')),
          ]
        : t(`ref.${state}`)
      return h('button', {
        type: 'button',
        className: state === 'idle' ? css.ref : `${css.ref} ${css.refFlash}`,
        'data-at-sider-ref': path,
        'aria-label': t('ref.insert'),
        title: state === 'idle' ? t('ref.tip') : label,
        onClick,
      }, label)
    }

    /** The Level/Entry pair is mutually recursive, so both are function declarations. */

    /** One entry's row, and its children when it is an expanded directory. */
    function Entry(props) {
      const { entry, parent, root, sessionId, expanded, onToggle, onOpen, revision, autoRefresh, focusedPath, setFocusedPath, onReference, depth, t } = props
      const path = childPath(parent, entry.name)
      const isDir = entry.type === 'directory'
      const isOpen = isDir && expanded.includes(path)
      const name = h('span', { className: css.name, key: 'name' }, entry.name)
      // R40a: the file's work-tree state as a coloured dot right after the
      // name; directories never carry one. The tooltip names the state.
      const gitDot = entry.type === 'file' && entry.git !== undefined
        ? h('span', {
            key: 'git',
            className: `${css.gitDot} ${css[`git${entry.git[0].toUpperCase()}${entry.git.slice(1)}`] ?? ''}`,
            title: t(`git.${entry.git}`),
            'data-at-sider-git': entry.git,
          })
        : undefined
      const children = []
      if (entry.type === 'other') {
        children.push(h('span', { className: css.main, key: 'main' }, name))
      } else {
        children.push(h('span', { className: css.main, key: 'main' },
          isDir
            ? h(FolderIcon, { open: isOpen, className: css.icon })
            : h(FileIcon, { name: entry.name }),
          name,
          gitDot))
        children.push(h(RefButton, {
          key: 'ref',
          sessionId,
          root,
          path,
          entry,
          t,
        }))
      }
      // The right-hand group: size right-aligned in a fixed box, a two-space
      // gap, then the date — pinned to the row's far edge as one unit.
      const rightSide = []
      if (entry.size !== undefined) {
        rightSide.push(h('span', {
          key: 'size',
          className: css.size,
          title: t('size.exact', { n: Math.round(entry.size).toLocaleString() }),
          'data-at-sider-size': entry.size,
        }, formatSize(entry.size)))
      }
      if (entry.mtimeMs !== undefined) {
        // Both time shapes are always in the DOM; the width tier decides which
        // one the stylesheet shows.
        rightSide.push(h('span', {
          key: 'mtime',
          className: css.mtime,
          title: mtimeTitle(entry.mtimeMs, entry.size),
          'data-at-sider-mtime': entry.mtimeMs,
        },
        h('span', { key: 'long', className: css.mtimeLong }, formatMtime(entry.mtimeMs)),
        h('span', { key: 'short', className: css.mtimeShort }, formatMtimeShort(entry.mtimeMs))))
      }
      if (rightSide.length > 0) {
        children.push(h('span', { key: 'right', className: css.right }, rightSide))
      }
      const rowProps = {
        className: entry.type === 'other' ? `${css.row} ${css.other} ${css.otherRow}` : css.row,
        'data-at-sider-row': entry.type,
        // Row-level identity for the reveal seek (the li carries the same path,
        // but the flash must land on this element — the keyboard focus target).
        'data-at-sider-treeitem': path,
      }
      if (entry.type !== 'other') {
        // R17 tree semantics: roving tabindex (the focused row is the only tab
        // stop once focus has entered the tree), treeitem role, and full arrow
        // navigation.
        rowProps.role = 'treeitem'
        rowProps['aria-level'] = depth
        rowProps.tabIndex = focusedPath === undefined || focusedPath === path ? 0 : -1
        rowProps.onFocus = (event) => {
          if (event.target === event.currentTarget) setFocusedPath(path)
        }
        rowProps['aria-expanded'] = isDir ? isOpen : undefined
        rowProps.onClick = () => (isDir ? onToggle(path) : onOpen(path))
        rowProps.onKeyDown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (isDir) onToggle(path)
            else onOpen(path)
            return
          }
          if (event.key === '@') {
            event.preventDefault()
            onReference(path, entry, false)
            return
          }
          if (treeKeyDown(event, { isDir, isOpen, path, parent, onToggle })) event.preventDefault()
        }
      } else {
        rowProps['aria-disabled'] = 'true'
        rowProps.title = t('entry.other')
      }
      return h('li', {
        className: css.item,
        role: 'none',
        'data-at-sider-entry': entry.type,
        'data-at-sider-path': path,
      },
      h('div', rowProps, children),
      isOpen && h('ul', { className: css.level, role: 'group' }, h(Level, { ...props, depth: depth + 1, parent: path })))
    }

    /** One directory's rows: its state while reading, its entries once read. */
    function Level(props) {
      const { parent, sessionId, revision, autoRefresh, t } = props
      const [level, setLevel] = React.useState({ phase: 'loading' })
      const [pulse, setPulse] = React.useState(0)
      const retryTimer = React.useRef(0)
      const retryCount = React.useRef(0)
      React.useEffect(() => {
        const controller = new AbortController()
        setLevel((previous) => (previous.phase === 'ready' ? previous : { phase: 'loading' }))
        listDirectory(sessionId, parent, controller.signal).then((result) => {
          if (controller.signal.aborted) return
          if (result.ok) {
            retryCount.current = 0
            setLevel({ phase: 'ready', entries: result.value.entries, truncated: result.value.truncated })
            // R40a: only the root level reports the workspace's git state up to
            // the body (the header line); nested levels carry per-entry fields
            // but say nothing about the repository.
            if (props.parent === props.root) props.onGit?.(result.value.git ?? { available: false })
            return
          }
          // A freshly restarted Host may not have resumed this Session yet, so
          // the route answers `no-workspace` for the restored tab. Self-heal
          // with a couple of spaced retries instead of leaving a dead failure
          // line that only a manual reload would clear.
          if (result.error.code === 'no-workspace' && retryCount.current < NO_WORKSPACE_RETRY_MAX) {
            retryCount.current += 1
            if (retryTimer.current !== 0) window.clearTimeout(retryTimer.current)
            retryTimer.current = window.setTimeout(() => setPulse((value) => value + 1), NO_WORKSPACE_RETRY_MS)
          }
          setLevel((previous) => (previous.phase === 'ready'
            ? { ...previous, failure: result.error }
            : { phase: 'failed', failure: result.error }))
        })
        return () => {
          controller.abort()
          if (retryTimer.current !== 0) window.clearTimeout(retryTimer.current)
        }
      }, [parent, sessionId, revision, pulse])
      React.useEffect(() => {
        if (!autoRefresh) return undefined
        const controller = new AbortController()
        let timer = 0
        const remote = pluginCtx?.remote
        if (typeof remote?.$stream !== 'function' || typeof remote?.workspaceFiles?.changes !== 'function') return undefined
        const run = async () => {
          try {
            const stream = remote.$stream({
              name: `at-sider directory ${parent}`,
              open: (lifetime) => remote.workspaceFiles.changes(sessionId, parent, lifetime),
              ended: () => new Error(`dsh-at-sider: directory watch ended for ${parent}`),
            })
            const abort = () => {
              stream.dispose()
            }
            controller.signal.addEventListener('abort', abort, { once: true })
            try {
              for await (const item of stream) {
                if (controller.signal.aborted) return
                if (item.value?.kind === 'ready') item.accept()
                if (item.value?.kind !== 'change') continue
                if (timer !== 0) window.clearTimeout(timer)
                timer = window.setTimeout(() => setPulse((value) => value + 1), REFRESH_DEBOUNCE_MS)
              }
            } finally {
              controller.signal.removeEventListener('abort', abort)
              await stream.dispose()
            }
          } catch {
            // A backend without watch support keeps manual reload available.
          }
        }
        run()
        return () => {
          controller.abort()
          if (timer !== 0) window.clearTimeout(timer)
        }
      }, [parent, sessionId, autoRefresh])
      if (level.phase === 'loading') {
        return h('li', { className: css.note, 'data-at-sider-row': 'loading' }, t('loading'))
      }
      if (level.phase === 'failed') {
        return h('li', {
          className: css.note,
          'data-at-sider-row': 'failed',
          'data-at-sider-code': level.failure.code,
        }, failureLine(t, level.failure))
      }
      const entries = orderEntries(level.entries, props.sort)
      return h(React.Fragment, null,
        level.failure !== undefined && h('li', { className: css.note, 'data-at-sider-row': 'failed' }, failureLine(t, level.failure)),
        entries.length === 0 && h('li', { className: css.note, 'data-at-sider-row': 'empty' }, t('empty')),
        entries.map((entry) => h(Entry, { ...props, key: entry.name, entry })),
        level.truncated && h('li', { className: css.note, 'data-at-sider-row': 'truncated' }, t('truncated')))
    }

    /** Say why a directory could not be read. */
    function failureLine(t, failure) {
      switch (failure.code) {
        case 'not-found': return t('error.notFound')
        case 'not-directory': return t('error.notDirectory')
        case 'outside-workspace': return t('error.outsideWorkspace')
        case 'no-workspace': return t('error.noWorkspace')
        case 'permission-denied': return t('error.permission')
        case 'aborted': return t('error.aborted')
        default: return t('error.unavailable', { message: failure.message })
      }
    }

    /** Where each tab's scroll offset is remembered while the body is unmounted. */
    const scrollMemory = new Map()

    /**
     * Where each tab's tree expansion is remembered while the body is unmounted.
     * The native tree keeps expansion in its own store, so coming back from a
     * file preview restores it; without a store, the same module-level memory
     * the scroll offset uses is the closest match (full migration: ROADMAP R30).
     */
    const expansionMemory = new Map()

    /** The file tree's body: the session's workspace root and whatever is expanded under it. */
    function FilesBody({ useTabInfo, sessionId, useSessions, t }) {
      const { tab } = useTabInfo()
      const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd)
      const memoryKey = `${tab.id}::${cwd ?? ''}`
      const [autoRefresh, setAutoRefresh] = React.useState(true)
      const [revision, setRevision] = React.useState(0)
      const [expanded, setExpanded] = React.useState(() => expansionMemory.get(memoryKey) ?? [])
      const [sort, setSort] = React.useState(loadSortPref)
      const [widthTierValue, setWidthTierValue] = React.useState(3)
      const [query, setQuery] = React.useState('')
      const [search, setSearch] = React.useState({ phase: 'idle', results: [], truncated: false })
      const [focusedPath, setFocusedPath] = React.useState(undefined)
      // R40a: the workspace's git state for the header line, reported by the
      // root level after each successful read (undefined until then, and
      // `{ available: false }` outside a repository).
      const [gitInfo, setGitInfo] = React.useState(undefined)
      const bodyRef = React.useRef(null)
      const scrollRef = React.useRef(0)
      const searchTimer = React.useRef(0)
      const searchSeq = React.useRef(0)
      const expandedRef = React.useRef(expanded)
      expandedRef.current = expanded
      // Write-through on every change, plus once more on unmount (the ref makes
      // the cleanup see the latest value even if the last effect never flushed).
      // Without a workspace there is nothing meaningful to remember.
      React.useEffect(() => {
        if (cwd === undefined) return
        expansionMemory.set(memoryKey, expanded)
        return () => expansionMemory.set(memoryKey, expandedRef.current)
      }, [memoryKey, cwd, expanded])
      React.useEffect(() => tab.actions.bindCommands({
        refresh: () => setRevision((value) => value + 1),
      }), [tab.actions])
      React.useLayoutEffect(() => {
        const body = bodyRef.current
        const remembered = scrollMemory.get(memoryKey)
        if (body !== null && remembered !== undefined) {
          body.scrollTop = remembered
          scrollRef.current = body.scrollTop
        }
      }, [memoryKey])
      React.useEffect(() => () => {
        scrollMemory.set(memoryKey, scrollRef.current)
      }, [memoryKey])
      // R12: measure the tree body and let the stylesheet drop columns that no
      // longer fit. ResizeObserver always fires once per observe(), so the tier
      // is correct on the first paint after the body exists.
      const hasWorkspace = cwd !== undefined
      React.useEffect(() => {
        const body = bodyRef.current
        if (body === null || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver((entries) => {
          const width = entries[entries.length - 1]?.contentRect?.width
          if (typeof width === 'number') setWidthTierValue(widthTier(width))
        })
        observer.observe(body)
        return () => observer.disconnect()
      }, [hasWorkspace])
      // R15: the quick filter — debounced search over the whole workspace while
      // the query is non-empty; an empty query puts the tree back.
      const trimmedQuery = query.trim()
      React.useEffect(() => {
        if (trimmedQuery === '') {
          setSearch({ phase: 'idle', results: [], truncated: false })
          return undefined
        }
        const seq = ++searchSeq.current
        setSearch((previous) => ({ ...previous, phase: 'loading' }))
        const timer = window.setTimeout(() => {
          searchWorkspace(sessionId, trimmedQuery).then((result) => {
            if (searchSeq.current !== seq) return
            if (result.ok) setSearch({ phase: 'ready', results: result.value.matches, truncated: result.value.truncated })
            else setSearch({ phase: 'failed', results: [], truncated: false, message: result.error.message })
          })
        }, SEARCH_DEBOUNCE_MS)
        return () => window.clearTimeout(timer)
      }, [trimmedQuery, sessionId])
      // R16: reveal — an opened tab navigated here with `params.reveal` expands
      // the ancestors and flashes the row (the row may still be loading, so the
      // scroll retries for a while).
      const navigation = tab.navigation
      const reveal = typeof navigation?.params?.reveal === 'string' ? navigation.params.reveal : undefined
      const revealRevision = navigation?.revision
      React.useEffect(() => {
        if (typeof reveal !== 'string' || reveal === '' || cwd === undefined) return
        // The address's path is workspace-relative for in-workspace files.
        const target = isAbsoluteWorkspacePath(reveal) ? reveal : childPath(cwd, reveal)
        const dirs = chainOf(cwd, target).filter((dir) => dir !== cwd)
        if (dirs.length > 0) setExpanded((previous) => Array.from(new Set([...previous, ...dirs])))
        if (typeof document === 'undefined') return
        let attempts = 0
        let poll = 0
        const seek = () => {
          attempts += 1
          // Seek the ROW (the keyboard focus target), not its li: the flash
          // must look exactly like the R17 focus ring.
          const row = document.querySelector(attrSelector('data-at-sider-treeitem', reveal))
          if (row === null) {
            if (attempts < 20) poll = window.setTimeout(seek, 150)
            return
          }
          if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' })
          // The flash mirrors the focus ring; re-assert it during the window so
          // a React re-render of the row cannot swallow the manual class.
          let reassertions = 0
          const reassert = () => {
            row.classList.add(css.revealFlash)
            reassertions += 1
            if (reassertions < 4) window.setTimeout(reassert, 500)
          }
          reassert()
          window.setTimeout(() => row.classList.remove(css.revealFlash), 1700)
        }
        seek()
        return () => window.clearTimeout(poll)
      }, [reveal, revealRevision, cwd])
      const cycleSort = () => {
        const next = nextSort(sort)
        setSort(next)
        saveSortPref(next)
      }
      if (cwd === undefined) {
        return h('div', { className: css.status, 'data-at-sider-state': 'no-workspace' },
          h('p', { className: css.statusLine }, t('noWorkspace')))
      }
      const onToggle = (path) => {
        setExpanded((previous) => (previous.includes(path) ? previous.filter((value) => value !== path) : [...previous, path]))
      }
      const onOpen = (path) => {
        tab.actions.openResource(fileAddressFor(sessionId, cwd, path))
      }
      const onReference = (path, entry, copyOnly) => {
        performReference(sessionId, cwd, path, entry, copyOnly)
      }
      const onPickDirectory = (path) => {
        setQuery('')
        setExpanded((previous) => Array.from(new Set([...previous, ...chainOf(cwd, path)])))
      }
      const tree = {
        sessionId,
        root: cwd,
        expanded,
        onToggle,
        onOpen,
        onReference,
        onGit: setGitInfo,
        onTreeNav: treeKeyDown,
        focusedPath,
        setFocusedPath,
        revision,
        autoRefresh,
        sort,
        depth: 1,
        t,
      }
      const searching = trimmedQuery !== ''
      // R40a: the header's git line — branch, ahead/behind, and the HEAD
      // commit's short hash, subject, and relative age. Only rendered when the
      // workspace answered with a repository.
      const gitLine = gitInfo?.available === true
        ? h('div', {
            className: css.gitline,
            'data-at-sider-git': 'head',
            title: gitInfo.head === undefined
              ? t('git.branch', { n: gitInfo.branch ?? '' })
              : t('git.commit.title', {
                  hash: gitInfo.head.hash,
                  subject: gitInfo.head.subject,
                  author: gitInfo.head.author,
                  time: gitInfo.head.time !== undefined ? formatMtime(gitInfo.head.time) : '',
                }),
          },
          h('span', { className: css.gitBranch }, `⎇ ${gitInfo.branch ?? ''}`),
          (gitInfo.ahead > 0 || gitInfo.behind > 0) && h('span', { className: css.gitSync },
            `${gitInfo.ahead > 0 ? `↑${String(gitInfo.ahead)}` : ''}${gitInfo.behind > 0 ? ` ↓${String(gitInfo.behind)}` : ''}`),
          gitInfo.head !== undefined && h('span', { className: css.gitCommit },
            `${gitInfo.head.hash} ${gitInfo.head.subject}`),
          gitInfo.head?.time !== undefined && h('span', { className: css.gitTime }, relativeAgeText(gitInfo.head.time, t)),
        )
        : undefined
      return h('div', {
        className: css.root,
        'data-at-sider-state': 'tree',
        'data-at-sider-root': cwd,
        'data-at-sider-width': widthTierValue,
        'data-at-sider-filtering': searching || undefined,
      },
      h('div', { className: css.header },
        h('span', { className: css.path, title: cwd, 'data-at-sider-path': cwd }, cwd),
        h('input', {
          className: css.filter,
          type: 'text',
          value: query,
          placeholder: t('search.placeholder'),
          'aria-label': t('search.aria'),
          spellCheck: false,
          'data-at-sider-filter': true,
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Escape') setQuery('')
          },
        }),
        h('button', {
          type: 'button',
          className: css.tool,
          'aria-label': t('sort.label'),
          title: `${t('sort.label')}：${t(`sort.${sort}`)}`,
          'data-at-sider-sort': sort,
          onClick: cycleSort,
        }, h(SortIcon)),
        h('button', {
          type: 'button',
          className: css.tool,
          'aria-label': t('autoRefresh'),
          'aria-pressed': autoRefresh,
          title: t(autoRefresh ? 'autoRefresh.disable' : 'autoRefresh.enable'),
          'data-at-sider-auto-refresh': true,
          onClick: () => setAutoRefresh((value) => !value),
        }, h(AutoRefreshIcon, { on: autoRefresh })),
        h('button', {
          type: 'button',
          className: css.tool,
          'aria-label': t('reload'),
          title: t('reload'),
          'data-at-sider-reload': true,
          onClick: () => setRevision((value) => value + 1),
        }, h(RefreshIcon))),
      gitLine,
      h('span', { className: css.srOnly, 'aria-live': 'polite' },
        searching && search.phase === 'ready' ? t('search.count', { n: String(search.results.length) }) : ''),
      h('div', {
        ref: bodyRef,
        className: css.body,
        'data-at-sider-body': true,
        onScroll: (event) => {
          scrollRef.current = event.currentTarget.scrollTop
        },
      }, searching
        ? h(SearchResults, {
          phase: search.phase,
          results: search.results,
          truncated: search.truncated,
          message: search.message,
          cwd,
          sessionId,
          onOpen,
          onPickDirectory,
          t,
        })
        : h('ul', { className: css.level, role: 'tree', 'aria-label': t('tree.aria') }, h(Level, { ...tree, parent: cwd }))))
    }

    /** The quick-filter's result list (R15): flat matches over the whole workspace. */
    function SearchResults({ phase, results, truncated, message, cwd, sessionId, onOpen, onPickDirectory, t }) {
      if (phase === 'loading') {
        return h('ul', { className: css.level, 'data-at-sider-search': 'loading' },
          h('li', { className: css.note, 'data-at-sider-search-row': 'loading' }, t('search.searching')))
      }
      if (phase === 'failed') {
        return h('ul', { className: css.level, 'data-at-sider-search': 'failed' },
          h('li', { className: css.note, 'data-at-sider-search-row': 'failed' }, t('error.unavailable', { message })))
      }
      return h('ul', { className: css.level, role: 'listbox', 'aria-label': t('search.aria'), 'data-at-sider-search': 'ready' },
        truncated && h('li', { className: css.note, 'data-at-sider-search-row': 'truncated' }, t('search.truncated')),
        results.length === 0 && h('li', { className: css.note, 'data-at-sider-search-row': 'none' }, t('search.none')),
        results.map((match) => h(ResultRow, { key: match.path, match, cwd, sessionId, onOpen, onPickDirectory, t })))
    }

    /** One quick-filter result: icon + name + dimmed directory, @ chip, open/pick on click. */
    function ResultRow({ match, cwd, sessionId, onOpen, onPickDirectory, t }) {
      const isDir = match.type === 'directory'
      const dim = relativeToRoot(cwd, match.dir === '' ? cwd : match.dir)
      const rowProps = {
        className: css.row,
        role: 'option',
        'aria-selected': 'false',
        'data-at-sider-result': match.type,
        'data-at-sider-path': match.path,
        onClick: () => (isDir ? onPickDirectory(match.path) : onOpen(match.path)),
      }
      return h('li', { className: css.item, 'data-at-sider-path': match.path },
        h('div', rowProps,
          h('span', { className: css.main, key: 'main' },
            isDir ? h(FolderIcon, { open: false, className: css.icon }) : h(FileIcon, { name: match.name }),
            h('span', { className: css.name, key: 'name' }, match.name),
            dim !== '' && dim !== '.' ? h('span', { className: css.dim, key: 'dir', title: dim }, dim) : null),
          h(RefButton, { key: 'ref', sessionId, root: cwd, path: match.path, entry: { name: match.name, type: match.type }, t })))
    }

    /** The tab chip: our folder sheet followed by the tab's title. */
    function FilesTitle({ useTabInfo }) {
      const { tab } = useTabInfo()
      return h(React.Fragment, null, h(TitleIcon), tab.title)
    }

    // ───────────────────────────── registration ─────────────────────────────

    /** The tab type that takes over the native `files` kind. */
    function definition(t) {
      return {
        id: ID,
        kind: KIND,
        priority: 'extension',
        title: () => t('type.label'),
        guide: [{
          id: 'workspace',
          commandId: 'workspace.files',
          order: 10,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
          icon: (props) => h(GuideIcon, props),
        }],
      }
    }

    const zh = {
      'type.label': '文件',
      'guide.title': '工作区文件',
      'guide.description': '浏览会话工作区的文件，支持 @ 引用与修改时间',
      loading: '正在读取…',
      empty: '空目录',
      truncated: '条目太多，只显示了一部分。',
      noWorkspace: '这个会话没有工作区目录。',
      reload: '重新读取',
      autoRefresh: '自动刷新',
      'autoRefresh.enable': '开启自动刷新',
      'autoRefresh.disable': '关闭自动刷新',
      'entry.other': '这不是文件或目录，没法打开。',
      'ref.insert': '引用这个文件',
      'ref.nounFile': '文件',
      'ref.nounFolder': '文件夹',
      'ref.tip': '插入 @ 引用到输入框；按住 Alt 点击则复制引用文本',
      'ref.inserted': '已引用',
      'ref.copied': '已复制',
      'ref.failed': '失败',
      'sort.label': '排序',
      'sort.name': '按名称',
      'sort.time': '按修改时间',
      'sort.size': '按大小',
      'sort.type': '按类型',
      'size.exact': '精确大小：{n} 字节',
      'menu.fallback': '回退原生文件树',
      'menu.enhance': '启用增强版文件树',
      'menu.reveal': '在文件树中定位',
      'menu.reference': '@文件',
      'search.placeholder': '搜索文件…',
      'search.aria': '搜索工作区文件',
      'search.searching': '正在搜索…',
      'search.none': '没有匹配的文件。',
      'search.truncated': '结果太多，只显示了一部分。',
      'search.count': '找到 {n} 项',
      'tree.aria': '工作区文件树',
      'git.staged': '已暂存（待提交）',
      'git.unstaged': '有未暂存的修改',
      'git.untracked': '未跟踪（Git 未纳管）',
      'git.branch': '分支 {n}',
      'git.commit.title': '最近提交 {hash}：{subject}（{author}，{time}）',
      'time.now': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
      'error.notFound': '这个目录不在了。可能已被移动或删除。',
      'error.notDirectory': '这不是一个目录。',
      'error.outsideWorkspace': '这个目录在工作区之外，侧栏不会读取它。',
      'error.noWorkspace': '这个会话没有工作区目录。',
      'error.permission': '没有读取这个目录的权限。',
      'error.aborted': '读取已取消。',
      'error.unavailable': '读取失败：{message}',
    }

    const en = {
      'type.label': 'Files',
      'guide.title': 'Workspace files',
      'guide.description': "Browse this session's workspace, with @ references and modification times",
      loading: 'Reading…',
      empty: 'Empty directory',
      truncated: 'Too many entries, showing only some of them.',
      noWorkspace: 'This session has no workspace directory.',
      reload: 'Reload',
      autoRefresh: 'Auto refresh',
      'autoRefresh.enable': 'Enable auto refresh',
      'autoRefresh.disable': 'Disable auto refresh',
      'entry.other': 'Not a file or a directory, so it cannot be opened.',
      'ref.insert': 'Reference this file',
      'ref.nounFile': 'file',
      'ref.nounFolder': 'folder',
      'ref.tip': 'Insert an @ reference into the composer; Alt-click to copy the mention instead',
      'ref.inserted': 'referenced',
      'ref.copied': 'copied',
      'ref.failed': 'failed',
      'sort.label': 'Sort',
      'sort.name': 'by name',
      'sort.time': 'by modified time',
      'sort.size': 'by size',
      'sort.type': 'by type',
      'size.exact': 'Exact size: {n} bytes',
      'menu.fallback': 'Use the native file tree',
      'menu.enhance': 'Use the enhanced file tree',
      'menu.reveal': 'Reveal in file tree',
      'menu.reference': '@file',
      'search.placeholder': 'Search files…',
      'search.aria': 'Search workspace files',
      'search.searching': 'Searching…',
      'search.none': 'No matching files.',
      'search.truncated': 'Too many results, showing only some of them.',
      'search.count': '{n} results',
      'tree.aria': 'Workspace file tree',
      'git.staged': 'Staged (ready to commit)',
      'git.unstaged': 'Modified (unstaged)',
      'git.untracked': 'Untracked',
      'git.branch': 'Branch {n}',
      'git.commit.title': 'Last commit {hash}: {subject} ({author}, {time})',
      'time.now': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
      'error.notFound': 'That directory is gone. It may have been moved or deleted.',
      'error.notDirectory': 'That is not a directory.',
      'error.outsideWorkspace': 'That directory is outside the workspace, so the sidebar will not read it.',
      'error.noWorkspace': 'This session has no workspace directory.',
      'error.permission': 'That directory is not readable.',
      'error.aborted': 'The read was cancelled.',
      'error.unavailable': 'Read failed: {message}',
    }

    const plugin = {
      name: ID,
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'],
      apply(ctx) {
        installStyles()
        const t = ctx.locale.bind(NS)
        pluginCtx = ctx
        // R10: the enhanced tree is a runtime-toggleable takeover. Dropping the
        // definition's registration makes the builtin body resume immediately
        // (extension semantics); re-registering brings the enhancement back.
        let definitionDisposer = undefined
        let enhancedActive = true
        const registerEnhancedDefinition = () => {
          if (definitionDisposer !== undefined) return
          try {
            definitionDisposer = ctx.sidebarRightTabs.register(definition(t))
          } catch {
            definitionDisposer = undefined
          }
        }
        const unregisterEnhancedDefinition = () => {
          if (definitionDisposer === undefined) return
          const disposer = definitionDisposer
          definitionDisposer = undefined
          try {
            disposer()
          } catch {
            // already gone: nothing to restore
          }
        }
        const setEnhancedActive = (next) => {
          if (next === enhancedActive) return
          enhancedActive = next
          if (next) registerEnhancedDefinition()
          else unregisterEnhancedDefinition()
        }
        const isEnhancedActive = () => enhancedActive
        controls.setEnhancedActive = setEnhancedActive
        controls.isEnhancedActive = isEnhancedActive
        /** R10: the tab-menu toggle between the enhanced tree and the builtin. */
        const FallbackMenuItem = ({ tab, dismiss, t }) => {
          if (tab?.kind !== KIND) return null
          return h('button', {
            type: 'button',
            className: css.menuItem,
            onClick: () => {
              dismiss()
              setEnhancedActive(!enhancedActive)
            },
          }, enhancedActive ? t('menu.fallback') : t('menu.enhance'))
        }
        ctx.effect(() => {
          registerEnhancedDefinition()
          return () => {
            unregisterEnhancedDefinition()
            enhancedActive = true
          }
        }, 'dsh-at-sider: files type takeover')
        // R10/R16: the two tab-menu entries. The toggle is offered on the files
        // tab itself; reveal is offered on file-preview tabs. Both read the tab
        // they are given and hide themselves elsewhere.
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.menu.item', () => {
          ctx.slots.register({
            name: 'sidebar.right.tab.menu.item',
            id: `${ID}#toggle`,
            order: 900,
            locale: NS,
          }, FallbackMenuItem)
          ctx.slots.register({
            name: 'sidebar.right.tab.menu.item',
            id: `${ID}#reveal`,
            order: 901,
            locale: NS,
          }, RevealMenuItem)
          ctx.slots.register({
            name: 'sidebar.right.tab.menu.item',
            id: `${ID}#reference`,
            order: 902,
            locale: NS,
          }, ReferenceMenuItem)
        }), 'dsh-at-sider: tab menu items')
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-at-sider: dictionaries')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: ID,
          locale: NS,
        }, FilesBody)), 'dsh-at-sider: files body')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: ID,
        }, FilesTitle)), 'dsh-at-sider: files title')
      },
    }

    /** Internals for the wiring tests; a non-enumerable key cannot reach the loader. */
    Object.defineProperty(plugin, '__internals', {
      value: {
        ID,
        KIND,
        ROUTE_PATH,
        NS,
        css,
        cssText,
        childPath,
        copyText,
        definition,
        dictionaries: { zh, en },
        entryOf,
        fileAddressFor,
        fileAddressParts,
        formatFullMtime,
        formatMtime,
        formatMtimeShort,
        formatSize,
        insertReference,
        listDirectory,
        loadSortPref,
        mentionFor,
        mtimeTitle,
        nextSort,
        orderEntries,
        relativeToRoot,
        saveSortPref,
        widthTier,
        SORT_KEYS,
        SORT_STORAGE_KEY,
        NO_WORKSPACE_RETRY_MS,
        NO_WORKSPACE_RETRY_MAX,
        attrSelector,
        chainOf,
        controls,
        expansionMemory,
        matchOf,
        performReference,
        revealPathFromAddress,
        requestReveal,
        treeKeyDown,
        SEARCH_ROUTE_PATH,
        SEARCH_DEBOUNCE_MS,
        components: { Entry, FilesBody, FilesTitle, Level, RefButton, FileIcon, FolderIcon, GuideIcon, TitleIcon, ReferenceMenuItem, RevealMenuItem },
        hostPrimitives: () => host,
      },
    })
    return plugin
  },
})
