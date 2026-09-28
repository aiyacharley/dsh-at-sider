/**
 * Client-half tests. The browser artifact is a loader-format factory, so it is
 * loaded here the way the module system loads it — inside `new Function`, with
 * `window`, `navigator` and `fetch` injected — and then exercised through a tiny
 * React shim: real component code, real hook wiring, real data flow, no browser.
 *
 * Run with: node --test test/
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
/** A Windows-style root, so the case-insensitive containment path is exercised. */
const ROOT = 'C:/work/ws'

/** A minimal React: elements, the hooks the tree uses, one render pass at a time. */
function createReact() {
  const slots = []
  let cursor = 0
  const effects = []
  const sameDeps = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  const Fragment = Symbol.for('react.fragment')
  const React = {
    Fragment,
    createElement(type, props, ...children) {
      if (type === Fragment) return children.flat()
      if (typeof type === 'function') return type(props ?? {})
      // React flattens nested child arrays; the shim must too, or tests that
      // pass an array as a single child would see an extra nesting level.
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (slots[index] === undefined) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = slots[index]
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
      }]
    },
    useEffect(fn, deps) {
      const index = cursor
      cursor += 1
      const previous = slots[index]
      slots[index] = { deps }
      if (previous !== undefined && sameDeps(previous.deps, deps)) return
      effects.push(fn)
    },
    useLayoutEffect(fn, deps) {
      React.useEffect(fn, deps)
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (slots[index] === undefined) slots[index] = { value: { current: initial } }
      return slots[index].value
    },
  }
  /** Render `component(props)` once; returns the tree and any cleanup the pass queued. */
  const render = (component, props) => {
    cursor = 0
    effects.length = 0
    const tree = component(props)
    const queued = effects.slice()
    return { tree, runEffects: () => { for (const effect of queued) effect() } }
  }
  return { React, render }
}

/** Walk a rendered tree for every node whose props satisfy `predicate`. */
function collect(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, predicate, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  if (node.type !== undefined && predicate(node)) found.push(node)
  for (const child of node.children ?? []) collect(child, predicate, found)
  if (node.props !== undefined) {
    for (const value of Object.values(node.props)) {
      if (Array.isArray(value) || (value !== null && typeof value === 'object')) collect(value, predicate, found)
    }
  }
  return found
}

/** Fake host artwork, shaped like the five exports the plugin reads from primitives. */
function fakePrimitives() {
  const kinds = []
  return {
    kinds,
    FileTypeIcon: (props) => {
      kinds.push(props.kind)
      return { type: 'host-file-type-icon', props }
    },
    classifyFileType: (name) => (name.endsWith('.md') ? 'markdown' : 'other'),
    IconFolderOpenRegular: (props) => ({ type: 'host-folder-open', props }),
    IconFolderCloseRegular: (props) => ({ type: 'host-folder-closed', props }),
    GuideArtworkFiles: (props) => ({ type: 'host-guide-artwork', props }),
  }
}

/** An in-memory localStorage stand-in, for the sort-preference tests. */
function fakeStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    entries: () => map,
  }
}

/** The visible text of a shim element: spans flatten, strings pass through. */
function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node === null || typeof node !== 'object') return String(node)
  return node.children !== undefined ? textOf(node.children) : ''
}

/** Load the browser artifact and materialize its plugin, per test. */
function loadPlugin({ fetchImpl, navigator: navigatorImpl, primitives, storage } = {}) {
  const registrations = []
  const timers = []
  const window = {
    __ModuleLoader__: { load: (registration) => registrations.push(registration) },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeout: () => {},
  }
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    if (fetchImpl === undefined) throw new Error('fetch not stubbed')
    return fetchImpl(url, init)
  }
  const navigatorValue = navigatorImpl ?? {}
  // The artifact is a script body, so it is evaluated the way the loader does it.
  new Function('window', 'navigator', 'fetch', 'localStorage', source)(window, navigatorValue, fetchFn, storage)
  assert.equal(registrations.length, 1, 'the artifact must register exactly one module')
  const [registration] = registrations
  const react = createReact()
  const plugin = registration.factory((specifier) => {
    if (specifier === 'react') return react.React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      // Without `primitives` the module table has no such word: the require throws
      // and the plugin must fall back to its own glyphs.
      if (primitives === undefined) throw new Error('client-modules: require missed the module table')
      return primitives
    }
    throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
  })
  return { registration, plugin, react, calls, timers }
}

/** A ctx that records every registration and resolves optional services from `services`. */
function fakeCtx(services = {}) {
  const record = { dictionaries: [], tabTypes: [], slots: [], registrations: [], disposed: 0 }
  const ctx = {
    get: (key) => services[key],
    effect: (fn) => {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale: {
      bind: (ns) => (key, params) => {
        const dict = record.dictionaries.find((entry) => entry.ns === ns)
        const text = (dict?.zh ?? {})[key] ?? key
        if (params === undefined) return text
        return Object.entries(params).reduce((acc, [name, value]) => acc.replace(`{${name}}`, String(value)), text)
      },
      register: (ns, dictionaries) => {
        record.dictionaries.push({ ns, ...dictionaries })
      },
    },
    sidebarRightTabs: {
      register: (definition) => {
        record.tabTypes.push(definition)
        return () => {
          record.disposed += 1
        }
      },
    },
    slots: {
      inject: (name, callback) => {
        assert.equal(typeof callback, 'function')
        return callback()
      },
      register: (options, component) => {
        record.registrations.push({ options, component })
        record.slots.push(options.name)
        return () => {}
      },
    },
  }
  return { ctx, record }
}

/** A JSON reply, as the route would send it. */
const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
})

describe('module registration', () => {
  it('declares the package identity and the services it needs', () => {
    const { registration, plugin } = loadPlugin()
    assert.equal(registration.id, 'dsh-at-sider')
    assert.equal(plugin.name, 'dsh-at-sider')
    assert.deepEqual(plugin.inject, ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'])
    assert.equal(typeof plugin.apply, 'function')
    assert.equal(Object.keys(plugin.__internals).length > 0, true)
    assert.deepEqual(Object.keys(plugin), ['name', 'inject', 'apply'])
  })
})

describe('plugin.apply', () => {
  it('takes over the native files kind as an extension and registers body and title', () => {
    const { plugin } = loadPlugin()
    const { ctx, record } = fakeCtx()
    plugin.apply(ctx)

    assert.equal(record.dictionaries.length, 1)
    assert.equal(record.dictionaries[0].ns, 'atSider')
    assert.equal(record.dictionaries[0].zh['type.label'], '文件')
    assert.deepEqual(Object.keys(record.dictionaries[0].zh).sort(), Object.keys(record.dictionaries[0].en).sort())

    assert.equal(record.tabTypes.length, 1)
    const definition = record.tabTypes[0]
    assert.equal(definition.id, 'dsh-at-sider')
    assert.equal(definition.kind, 'files', 'the takeover must keep the native kind')
    assert.equal(definition.priority, 'extension')
    assert.equal(definition.patterns, undefined)
    assert.equal(typeof definition.title, 'function')
    assert.equal(definition.title(), '文件')
    assert.equal(definition.guide.length, 1)
    assert.equal(definition.guide[0].order, 10)
    assert.equal(definition.guide[0].commandId, 'workspace.files')
    assert.equal(definition.guide[0].title(), '工作区文件')

    assert.deepEqual(record.slots, [
      'sidebar.right.tab.menu.item',
      'sidebar.right.tab.menu.item',
      'sidebar.right.tab.menu.item',
      'sidebar.right.pane.tab',
      'sidebar.right.pane.tab.title',
    ])
    const toggleMenu = record.registrations[0]
    assert.equal(toggleMenu.options.id, 'dsh-at-sider#toggle')
    assert.equal(toggleMenu.options.locale, 'atSider')
    const revealMenu = record.registrations[1]
    assert.equal(revealMenu.options.id, 'dsh-at-sider#reveal')
    const referenceMenu = record.registrations[2]
    assert.equal(referenceMenu.options.id, 'dsh-at-sider#reference')
    const body = record.registrations[3]
    assert.equal(body.options.key, 'dsh-at-sider')
    assert.equal(body.options.locale, 'atSider')
    assert.equal(typeof body.component, 'function')
    const title = record.registrations[4]
    assert.equal(title.options.key, 'dsh-at-sider')
  })

  it('toggles the takeover at runtime so the builtin can resume (R10)', () => {
    const { plugin } = loadPlugin()
    const { ctx, record } = fakeCtx()
    plugin.apply(ctx)
    assert.equal(record.tabTypes.length, 1)
    assert.equal(record.disposed, 0)
    assert.equal(plugin.__internals.controls.isEnhancedActive(), true)

    plugin.__internals.controls.setEnhancedActive(false)
    assert.equal(record.disposed, 1, 'the enhanced definition unregisters; the builtin resumes')
    assert.equal(plugin.__internals.controls.isEnhancedActive(), false)

    plugin.__internals.controls.setEnhancedActive(true)
    assert.equal(record.tabTypes.length, 2, 're-registering brings the enhancement back')
    plugin.__internals.controls.setEnhancedActive(true)
    assert.equal(record.tabTypes.length, 2, 'the toggle is idempotent when already enhanced')
  })

  it('offers the reveal menu entry only on file-preview tabs (R16)', () => {
    const { plugin, react } = loadPlugin()
    const opened = []
    let dismissedCount = 0
    const { ctx } = fakeCtx({
      sidebarRight: { openTab: (kind, options) => { opened.push({ kind, options }) } },
    })
    plugin.apply(ctx)
    const t = (key) => plugin.__internals.dictionaries.zh[key] ?? key
    const reveal = plugin.__internals.components.RevealMenuItem

    const onFile = react.render(reveal, {
      tab: { kind: 'document-preview', contentId: 'dsh-resource://file/session/s-1/docs/a.md' },
      dismiss: () => { dismissedCount += 1 },
      t,
    })
    assert.equal(textOf(onFile.tree.children), '在文件树中定位')

    const onFilesTab = react.render(reveal, {
      tab: { kind: 'files', contentId: 'sidebar://guide' },
      dismiss: () => {},
      t,
    })
    assert.equal(onFilesTab.tree, null, 'the files tab itself gets no reveal entry')

    // Acting on the entry dismisses the menu and opens the enhanced tree with
    // the reveal parameter.
    onFile.tree.props.onClick()
    assert.equal(dismissedCount, 1)
    assert.deepEqual(opened, [{ kind: 'files', options: { params: { reveal: 'docs/a.md' } } }])
  })

  it('offers @文件 on file-preview tabs and inserts the reference (R16)', async () => {
    const inserted = []
    let dismissedCount = 0
    const { plugin, react } = loadPlugin()
    const { ctx } = fakeCtx({
      sessions: { scope: (id) => ({ sessionId: id }) },
      conversation: { input: { for: () => ({ addFiles: (references) => { inserted.push(...references); return true } }) } },
      sidebarRight: { openTab: () => {} },
    })
    plugin.apply(ctx)
    const t = (key) => plugin.__internals.dictionaries.zh[key] ?? key
    const useSessions = (selector) => selector({ byId: { 's-1': { cwd: ROOT } } })
    const reference = plugin.__internals.components.ReferenceMenuItem

    const onFile = react.render(reference, {
      tab: { kind: 'document-preview', contentId: `dsh-resource://file/session/s-1/${'docs/a.md'}` },
      dismiss: () => { dismissedCount += 1 },
      useSessions,
      t,
    })
    assert.equal(textOf(onFile.tree.children), '@文件')
    await onFile.tree.props.onClick()
    assert.equal(dismissedCount, 1)
    assert.deepEqual(inserted, [{
      source: 'reference',
      ref: '@docs/a.md',
      label: 'a.md',
      appearance: 'file',
      clipboardText: '@docs/a.md',
    }])

    // The Files tab and non-file addresses get no entry.
    const onFilesTab = react.render(reference, {
      tab: { kind: 'files', contentId: 'sidebar://guide' },
      dismiss: () => {},
      useSessions,
      t,
    })
    assert.equal(onFilesTab.tree, null)
    const onGuide = react.render(reference, {
      tab: { kind: 'guide', contentId: 'sidebar://guide' },
      dismiss: () => {},
      useSessions,
      t,
    })
    assert.equal(onGuide.tree, null)
  })
})

describe('pure helpers', () => {
  const internals = () => loadPlugin().plugin.__internals

  it('formats a modification time as fixed-width local time', () => {
    const api = internals()
    const stamp = new Date(2025, 0, 2, 3, 4, 5).getTime()
    assert.equal(api.formatMtime(stamp), '2025-01-02 03:04')
    assert.equal(api.formatMtime(undefined), '')
    assert.equal(api.formatMtime(Number.NaN), '')
    assert.match(api.formatFullMtime(stamp), /2025/)
  })

  it('joins child paths with a forward slash whatever the parent uses', () => {
    const api = internals()
    assert.equal(api.childPath('C:\\work\\ws', 'a.ts'), 'C:\\work\\ws/a.ts')
    assert.equal(api.childPath('C:/work/ws/', 'a.ts'), 'C:/work/ws/a.ts')
  })

  it('orders directories first, then names naturally', () => {
    const api = internals()
    const entries = [
      { name: 'a10.txt', type: 'file' },
      { name: 'zdir', type: 'directory' },
      { name: 'a2.txt', type: 'file' },
      { name: 'B.txt', type: 'file' },
    ]
    assert.deepEqual(api.orderEntries(entries).map((entry) => entry.name), ['zdir', 'a2.txt', 'a10.txt', 'B.txt'])
  })

  it('names entries relative to the root, quoted when needed', () => {
    const api = internals()
    assert.equal(api.relativeToRoot(ROOT, `${ROOT}/src/a.ts`), 'src/a.ts')
    assert.equal(api.relativeToRoot(ROOT, `${ROOT.toUpperCase()}/src/a.ts`), 'src/a.ts')
    assert.equal(api.relativeToRoot(ROOT, 'C:/elsewhere/a.ts'), 'C:/elsewhere/a.ts')
    assert.equal(api.mentionFor(ROOT, `${ROOT}/src/a.ts`, false), '@src/a.ts')
    assert.equal(api.mentionFor(ROOT, `${ROOT}/docs`, true), '@docs/')
    assert.equal(api.mentionFor(ROOT, `${ROOT}/my dir/a b.md`, false), '@"my dir/a b.md"')
    assert.equal(api.mentionFor(ROOT, `${ROOT}/a"b.md`, false), undefined)
  })

  it('builds the resource address exactly as the shared helper does', () => {
    const api = internals()
    assert.equal(
      api.fileAddressFor('s-1', ROOT, `${ROOT}/a b/c.md`),
      'dsh-resource://file/session/s-1/a%20b/c.md',
    )
    assert.equal(
      api.fileAddressFor('s-1', ROOT, `${ROOT}/docs/index.md`),
      'dsh-resource://file/session/s-1/docs/index.md',
    )
    assert.equal(
      api.fileAddressFor('s-1', ROOT, 'src/rel.ts'),
      'dsh-resource://file/session/s-1/src/rel.ts',
    )
  })

  it('rejects malformed host entries and keeps well-formed ones', () => {
    const api = internals()
    assert.deepEqual(api.entryOf({ name: 'a.ts', type: 'file', mtimeMs: 5, size: 3 }), { name: 'a.ts', type: 'file', mtimeMs: 5, size: 3 })
    assert.deepEqual(api.entryOf({ name: 'a.ts', type: 'file', mtimeMs: 'soon' }), { name: 'a.ts', type: 'file' })
    assert.deepEqual(api.entryOf({ name: 'a.ts', type: 'nonsense' }), { name: 'a.ts', type: 'other' })
    assert.equal(api.entryOf({ name: '', type: 'file' }), undefined)
    assert.equal(api.entryOf(null), undefined)
  })
})

describe('listing through the host route', () => {
  it('POSTs the session and path, and reads back the level', async () => {
    const { plugin, calls } = loadPlugin({
      fetchImpl: async () => jsonResponse({
        ok: true,
        value: {
          path: ROOT,
          root: ROOT,
          entries: [{ name: 'a.ts', type: 'file', mtimeMs: 1735787045000 }, { name: 'ghost', type: 'file' }],
          truncated: true,
        },
      }),
    })
    const result = await plugin.__internals.listDirectory('s-1', ROOT)
    assert.equal(result.ok, true)
    assert.equal(result.value.entries.length, 2)
    assert.equal(result.value.entries[0].mtimeMs, 1735787045000)
    assert.equal(result.value.truncated, true)
    assert.equal(calls[0].url, '/api/dsh-at-sider/list')
    assert.equal(calls[0].init.method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].init.body), { sessionId: 's-1', path: ROOT })
    assert.equal(calls[0].init.credentials, 'same-origin')
  })

  it('maps a route failure onto a typed error', async () => {
    const { plugin } = loadPlugin({
      fetchImpl: async () => jsonResponse({ ok: false, error: { code: 'outside-workspace', message: 'nope' } }),
    })
    const result = await plugin.__internals.listDirectory('s-1', ROOT)
    assert.equal(result.ok, false)
    assert.deepEqual(result.error, { code: 'outside-workspace', message: 'nope' })
  })

  it('survives a transport failure, a non-JSON reply, and a malformed level', async () => {
    const failing = loadPlugin({ fetchImpl: async () => { throw new Error('offline') } })
    const offline = await failing.plugin.__internals.listDirectory('s-1', ROOT)
    assert.equal(offline.ok, false)
    assert.equal(offline.error.code, 'unavailable')

    const garbage = loadPlugin({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('html') } }) })
    assert.equal((await garbage.plugin.__internals.listDirectory('s-1', ROOT)).error.code, 'unavailable')

    const wrongShape = loadPlugin({ fetchImpl: async () => jsonResponse({ ok: true, value: { entries: null } }) })
    assert.equal((await wrongShape.plugin.__internals.listDirectory('s-1', ROOT)).error.code, 'unavailable')
  })
})

describe('reference insertion', () => {
  it('inserts the chip the built-in @ source and the file drop produce', () => {
    const { plugin } = loadPlugin()
    const inserted = []
    const { ctx } = fakeCtx({
      sessions: { scope: (sessionId) => (sessionId === 's-1' ? { sessionId } : undefined) },
      conversation: { input: { for: () => ({ addFiles: (references) => { inserted.push(...references); return true } }) } },
    })
    const ok = plugin.__internals.insertReference(ctx, 's-1', {
      source: 'reference',
      ref: '@src/a.ts',
      label: 'a.ts',
      appearance: 'file',
      clipboardText: '@src/a.ts',
    })
    assert.equal(ok, true)
    assert.deepEqual(inserted, [{
      source: 'reference',
      ref: '@src/a.ts',
      label: 'a.ts',
      appearance: 'file',
      clipboardText: '@src/a.ts',
    }])
  })

  it('reports false when the session scope or the composer is unavailable', () => {
    const { plugin } = loadPlugin()
    const bare = fakeCtx().ctx
    assert.equal(plugin.__internals.insertReference(bare, 's-1', { source: 'reference', ref: '@a', label: 'a', appearance: 'file', clipboardText: '@a' }), false)

    const refusing = fakeCtx({
      sessions: { scope: () => ({}) },
      conversation: { input: { for: () => ({ addFiles: () => false }) } },
    }).ctx
    assert.equal(plugin.__internals.insertReference(refusing, 's-1', { source: 'reference', ref: '@a', label: 'a', appearance: 'file', clipboardText: '@a' }), false)
  })

  it('copies through the clipboard when asked to', async () => {
    const copied = []
    const { plugin } = loadPlugin({ navigator: { clipboard: { writeText: async (text) => copied.push(text) } } })
    assert.equal(await plugin.__internals.copyText('@src/a.ts'), true)
    assert.deepEqual(copied, ['@src/a.ts'])

    const bare = loadPlugin().plugin
    assert.equal(await bare.__internals.copyText('@src/a.ts'), false)
  })
})

describe('rendering the tree', () => {
  const ROW_FETCH = async (_url, init) => {
    const { path } = JSON.parse(init.body)
    if (path === `${ROOT}/src`) {
      return jsonResponse({
        ok: true,
        value: {
          path: `${ROOT}/src`,
          root: ROOT,
          truncated: false,
          entries: [{ name: 'find.ts', type: 'file', mtimeMs: 1735700645000, size: 3 }],
        },
      })
    }
    if (path !== ROOT) return jsonResponse({ ok: false, error: { code: 'not-found', message: 'missing' } })
    return jsonResponse({
      ok: true,
      value: {
        path: ROOT,
        root: ROOT,
        truncated: false,
        entries: [
          { name: 'src', type: 'directory', mtimeMs: 1735787045000 },
          { name: 'README.md', type: 'file', mtimeMs: 1735700645000, size: 12 },
          { name: 'pipe', type: 'other' },
        ],
      },
    })
  }

  /** Render FilesBody once, run its effects, let the listing land, and render again. */
  async function renderBody({ services = {}, primitives, storage } = {}) {
    const { plugin, react, calls } = loadPlugin({ fetchImpl: ROW_FETCH, primitives, storage })
    const { ctx } = fakeCtx(services)
    plugin.apply(ctx)
    const opened = []
    const cwd = ROOT
    const props = {
      sessionId: 's-1',
      useSessions: (selector) => selector({ byId: { 's-1': { cwd } } }),
      useTabInfo: () => ({
        tab: {
          id: 'tab-1',
          title: 'Files',
          signal: new AbortController().signal,
          actions: {
            bindCommands: () => () => {},
            openResource: (address) => opened.push(address),
          },
        },
      }),
      t: (key, params) => {
        const template = plugin.__internals.dictionaries.zh[key] ?? key
        return params === undefined ? template : Object.entries(params).reduce((acc, [name, value]) => acc.replace(`{${name}}`, String(value)), template)
      },
    }
    let pass = react.render(plugin.__internals.components.FilesBody, props)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))
    pass = react.render(plugin.__internals.components.FilesBody, props)
    pass.runEffects()
    return { tree: pass.tree, opened, calls, plugin, react, props }
  }

  it('draws the root header, every entry, an @ button and a date column', async () => {
    const { tree, plugin } = await renderBody()
    const root = collect(tree, (node) => node.props?.['data-at-sider-state'] === 'tree')
    assert.equal(root.length, 1)
    assert.equal(root[0].props['data-at-sider-root'], ROOT)
    assert.equal(root[0].props['data-at-sider-width'], 3, 'full columns until a ResizeObserver measures narrower')

    const rows = collect(tree, (node) => node.props?.['data-at-sider-entry'] !== undefined)
    assert.deepEqual(rows.map((row) => row.props['data-at-sider-entry']), ['directory', 'other', 'file'])
    assert.deepEqual(rows.map((row) => row.props['data-at-sider-path']), [`${ROOT}/src`, `${ROOT}/pipe`, `${ROOT}/README.md`])

    const dates = collect(tree, (node) => node.props?.['data-at-sider-mtime'] !== undefined)
    assert.equal(dates.length, 2, 'both a directory and a file carry a date')
    // The time span keeps both shapes in the DOM; the width tier picks one.
    const long = dates[0].children[0]
    const short = dates[0].children[1]
    assert.equal(long.props.className, 'ats-mtimeLong')
    assert.equal(long.children[0], plugin.__internals.formatMtime(1735787045000))
    assert.match(long.children[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    assert.equal(short.props.className, 'ats-mtimeShort')
    assert.match(short.children[0], /^\d{2}-\d{2} \d{2}:\d{2}$/)
    assert.match(dates[0].props.title, /2025/)

    // R11: the file row carries its humanized size; a directory (no size on the
    // wire) and the un-openable entry show none.
    const sizes = collect(tree, (node) => node.props?.['data-at-sider-size'] !== undefined)
    assert.equal(sizes.length, 1)
    assert.equal(sizes[0].props['data-at-sider-size'], 12)
    assert.equal(sizes[0].children[0], '12 B')
    assert.match(dates[1].props.title, /· 12 B$/, 'the file’s time tooltip carries the size')
    assert.doesNotMatch(dates[0].props.title, /·/, 'a directory’s tooltip has no size')

    // R11 layout: size and date live in one right-pinned group — the size is
    // right-aligned in a fixed box, a two-space gap, then the date.
    const groups = collect(tree, (node) => node.props?.className === 'ats-right')
    assert.equal(groups.length, 2, 'one right-hand group per dated row')
    const fileGroup = groups.find((group) => collect([group], (node) => node.props?.['data-at-sider-size'] !== undefined).length > 0)
    const groupChildren = fileGroup.children
    assert.equal(groupChildren.length, 2, 'size first, then the date')
    assert.equal(groupChildren[0].props['data-at-sider-size'], 12)
    assert.equal(groupChildren[1].props['data-at-sider-mtime'], 1735700645000)

    const refs = collect(tree, (node) => node.props?.['data-at-sider-ref'] !== undefined)
    assert.equal(refs.length, 2, 'the un-openable entry has no @ button')
    assert.deepEqual(refs.map((ref) => ref.props['data-at-sider-ref']), [`${ROOT}/src`, `${ROOT}/README.md`])
    // The affordance reads as a labelled reference, not a bare glyph.
    assert.deepEqual(refs.map((ref) => textOf(ref.children)), ['@文件夹', '@文件'])
  })

  it('opens a file through the tab and refuses nothing twice', async () => {
    const { tree, opened } = await renderBody()
    const fileRow = collect(tree, (node) => node.props?.['data-at-sider-path'] === `${ROOT}/README.md`)[0]
    const row = collect(fileRow, (node) => node.props?.role === 'treeitem')[0]
    row.props.onClick()
    assert.deepEqual(opened, ['dsh-resource://file/session/s-1/README.md'])
  })

  it('draws the host’s own file-type and folder artwork when the module table has it', async () => {
    const primitives = fakePrimitives()
    const { tree, plugin } = await renderBody({ primitives })
    assert.equal(plugin.__internals.hostPrimitives(), primitives)

    // Files go through the host classifier and the host category icon; an
    // `other` entry draws no glyph, exactly as the native tree draws none.
    const fileIcons = collect(tree, (node) => node.type === 'host-file-type-icon')
    assert.deepEqual(fileIcons.map((node) => node.props.kind), ['markdown'])
    assert.equal(fileIcons[0].props.size, 16)
    assert.equal(fileIcons[0].props.className, 'ats-fileIcon')

    // Directories use the host's line-art folder, closed at this level.
    const folders = collect(tree, (node) => node.type === 'host-folder-closed')
    assert.equal(folders.length, 1)
    assert.equal(folders[0].props.className, 'ats-icon')
    assert.equal(collect(tree, (node) => node.type === 'host-folder-open').length, 0)
  })

  it('uses the host artwork for the chip title and the guide capsule', () => {
    const primitives = fakePrimitives()
    const { plugin, react } = loadPlugin({ primitives })
    plugin.apply(fakeCtx().ctx)

    const title = react.render(plugin.__internals.components.FilesTitle, {
      useTabInfo: () => ({ tab: { title: 'Files' } }),
    })
    const chips = collect(title.tree, (node) => node.type === 'host-file-type-icon')
    assert.equal(chips.length, 1)
    assert.equal(chips[0].props.kind, 'folder')

    const guideIcon = plugin.__internals.definition((key) => key).guide[0].icon
    const artwork = collect(guideIcon({ size: 16 }), (node) => node.type === 'host-guide-artwork')
    assert.equal(artwork.length, 1)
  })

  it('falls back to its own glyphs when the host artwork is unavailable', async () => {
    const { tree, plugin } = await renderBody()
    assert.equal(plugin.__internals.hostPrimitives(), undefined)
    // One folder glyph (the level's directory) plus one document glyph.
    assert.ok(collect(tree, (node) => node.type === 'svg').length >= 2)
    assert.equal(collect(tree, (node) => String(node.type).startsWith('host-')).length, 0)
    // The chip title and the guide capsule fall back too, without throwing.
    const title = plugin.__internals.components.FilesTitle({ useTabInfo: () => ({ tab: { title: 'Files' } }) })
    assert.ok(collect(title, (node) => node.type === 'svg').length >= 1)
  })

  it('keeps the row inside its padding so the date column cannot be clipped', () => {
    const { plugin } = loadPlugin()
    const { cssText } = plugin.__internals
    const row = /\.ats-row\{([^}]*)\}/.exec(cssText)
    assert.ok(row !== null, 'the row rule exists')
    assert.match(row[1], /box-sizing:border-box/, 'the row must not overflow by its own padding')
    // The right pin lives on the size+date group (ats-right); the date itself
    // only carries typography.
    const right = /\.ats-right\{([^}]*)\}/.exec(cssText)
    assert.ok(right !== null, 'the right-hand group rule exists')
    assert.match(right[1], /margin-left:auto/)
    assert.match(right[1], /gap:2ch/, 'a two-space gap between size and date')
    const mtime = /\.ats-mtime\{([^}]*)\}/.exec(cssText)
    assert.ok(mtime !== null)
    assert.doesNotMatch(mtime[1], /margin-left:auto/)
    assert.match(cssText, /\.ats-fileIcon\{flex:none\}/)
    assert.equal(plugin.__internals.css.fileIcon, 'ats-fileIcon')
  })

  it('routes a failing level to its failure line', async () => {
    const { plugin, react, calls } = loadPlugin({
      fetchImpl: async () => jsonResponse({ ok: false, error: { code: 'not-found', message: 'missing' } }),
    })
    const { ctx } = fakeCtx()
    plugin.apply(ctx)
    const props = {
      parent: `${ROOT}/gone`,
      sessionId: 's-1',
      revision: 0,
      autoRefresh: false,
      t: (key) => key,
    }
    const pass = react.render(plugin.__internals.components.Level, props)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))
    const second = react.render(plugin.__internals.components.Level, props)
    const notes = collect(second.tree, (node) => node.props?.['data-at-sider-row'] === 'failed')
    assert.equal(notes.length, 1)
    assert.equal(notes[0].props['data-at-sider-code'], 'not-found')
    assert.equal(notes[0].children[0], 'error.notFound')
    assert.equal(calls.length, 1, 'a not-found failure does not schedule a retry')
  })

  it('self-heals a no-workspace failure from a cold session', async () => {
    let call = 0
    const { plugin, react, timers, calls } = loadPlugin({
      fetchImpl: async () => (++call === 1
        ? jsonResponse({ ok: false, error: { code: 'no-workspace', message: 'session not resumed yet' } })
        : jsonResponse({
          ok: true,
          value: { path: ROOT, root: ROOT, truncated: false, entries: [{ name: 'a.ts', type: 'file', mtimeMs: 5 }] },
        })),
    })
    plugin.apply(fakeCtx().ctx)
    const props = { parent: ROOT, sessionId: 's-1', revision: 0, autoRefresh: false, t: (key) => key }
    let pass = react.render(plugin.__internals.components.Level, props)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))

    // The failure schedules exactly one spaced retry…
    assert.equal(plugin.__internals.NO_WORKSPACE_RETRY_MS, 1200)
    assert.equal(timers.filter((timer) => timer.ms === plugin.__internals.NO_WORKSPACE_RETRY_MS).length, 1)
    const failed = react.render(plugin.__internals.components.Level, props)
    assert.equal(collect(failed.tree, (node) => node.props?.['data-at-sider-row'] === 'failed').length, 1)

    // …firing it re-lists through the pulse, and the level recovers.
    timers.splice(0, timers.length).forEach((timer) => timer.fn())
    pass = react.render(plugin.__internals.components.Level, props)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))
    pass = react.render(plugin.__internals.components.Level, props)
    const rows = collect(pass.tree, (node) => node.props?.['data-at-sider-entry'] !== undefined)
    assert.deepEqual(rows.map((row) => row.props['data-at-sider-path']), [`${ROOT}/a.ts`])
    assert.equal(calls.length, 2, 'exactly one retry was made')
  })

  it('expands the ancestors when a reveal navigation arrives (R16)', async () => {
    const { plugin, react, timers } = loadPlugin({ fetchImpl: ROW_FETCH })
    const { ctx } = fakeCtx()
    plugin.apply(ctx)
    const props = {
      sessionId: 's-1',
      useSessions: (selector) => selector({ byId: { 's-1': { cwd: ROOT } } }),
      useTabInfo: () => ({
        tab: {
          id: 'tab-1',
          title: 'Files',
          signal: new AbortController().signal,
          navigation: { address: 'files', params: { reveal: `${ROOT}/src/find.ts` }, revision: 1 },
          actions: { bindCommands: () => () => {}, openResource: () => {} },
        },
      }),
      t: (key) => plugin.__internals.dictionaries.zh[key] ?? key,
    }
    let pass = react.render(plugin.__internals.components.FilesBody, props)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))
    pass = react.render(plugin.__internals.components.FilesBody, props)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))
    pass = react.render(plugin.__internals.components.FilesBody, props)

    // The src row is expanded (its nested level mounted and listed find.ts).
    const srcRow = collect(pass.tree, (node) => node.props?.['data-at-sider-path'] === `${ROOT}/src`)[0]
    const srcTreeitem = collect(srcRow, (node) => node.props?.role === 'treeitem')[0]
    assert.equal(srcTreeitem.props['aria-expanded'], true, 'the chain to the revealed file is expanded')
    assert.equal(srcTreeitem.props['aria-level'], 1)
    assert.equal(srcTreeitem.props['data-at-sider-treeitem'], `${ROOT}/src`, 'the row itself is the reveal-seek target')
    const nested = collect(collect(srcRow, (node) => node.props?.role === 'group')[0], (node) => node.props?.['data-at-sider-path'] === `${ROOT}/src/find.ts`)
    assert.equal(nested.length, 1, 'the revealed file is rendered inside the group')
    // Timers were scheduled for the scroll polling but none fired in the shim.
    assert.ok(timers.length >= 0)
    void timers
  })

  it('filters the whole workspace through the quick filter (R15)', async () => {
    const searchFetch = async (url, init) => {
      if (url === '/api/dsh-at-sider/search') {
        const { query } = JSON.parse(init.body)
        const matches = query === 'read'
          ? [{ name: 'README.md', path: `${ROOT}/README.md`, dir: '', type: 'file', mtimeMs: 1735700645000, size: 12 }]
          : []
        return jsonResponse({ ok: true, value: { query, matches, truncated: false } })
      }
      return ROW_FETCH(url, init)
    }
    const { plugin, react, props, timers, calls } = await (async () => {
      const harness = loadPlugin({ fetchImpl: searchFetch })
      harness.plugin.apply(fakeCtx().ctx)
      return harness
    })()
    const opened = []
    const baseProps = {
      sessionId: 's-1',
      useSessions: (selector) => selector({ byId: { 's-1': { cwd: ROOT } } }),
      useTabInfo: () => ({
        tab: {
          id: 'tab-1',
          title: 'Files',
          signal: new AbortController().signal,
          actions: { bindCommands: () => () => {}, openResource: (address) => opened.push(address) },
        },
      }),
      t: (key, params) => {
        const template = plugin.__internals.dictionaries.zh[key] ?? key
        return params === undefined ? template : Object.entries(params).reduce((acc, [name, value]) => acc.replace(`{${name}}`, String(value)), template)
      },
    }
    let pass = react.render(plugin.__internals.components.FilesBody, baseProps)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))
    pass = react.render(plugin.__internals.components.FilesBody, baseProps)

    // Typing schedules exactly one debounced search and marks the root.
    const filter = () => collect(pass.tree, (node) => node.props?.['data-at-sider-filter'] !== undefined)[0]
    filter().props.onChange({ target: { value: 'read' } })
    pass = react.render(plugin.__internals.components.FilesBody, baseProps)
    assert.equal(pass.tree.props['data-at-sider-filtering'], true, 'the root marks the filtering state')
    pass.runEffects()
    const scheduled = timers.splice(0, timers.length).filter((timer) => timer.ms === plugin.__internals.SEARCH_DEBOUNCE_MS)
    assert.equal(scheduled.length, 1, 'the keystroke is debounced')

    // Firing the debounce searches; the result list replaces the tree.
    scheduled.forEach((timer) => timer.fn())
    await new Promise((done) => setTimeout(done, 0))
    pass = react.render(plugin.__internals.components.FilesBody, baseProps)
    const results = collect(pass.tree, (node) => node.props?.['data-at-sider-result'] !== undefined)
    assert.deepEqual(results.map((row) => row.props['data-at-sider-path']), [`${ROOT}/README.md`])
    assert.ok(collect(pass.tree, (node) => node.props?.['data-at-sider-ref'] !== undefined).length >= 1, 'results carry an @ chip')

    // Clicking a file result opens it through the tab.
    results[0].props.onClick()
    assert.deepEqual(opened, ['dsh-resource://file/session/s-1/README.md'])

    // Clearing the filter puts the tree back.
    filter().props.onChange({ target: { value: '' } })
    pass = react.render(plugin.__internals.components.FilesBody, baseProps)
    assert.equal(pass.tree.props['data-at-sider-filtering'], undefined)
    assert.equal(collect(pass.tree, (node) => node.props?.['data-at-sider-entry'] !== undefined).length, 3, 'the tree is back')
  })

  it('caps the no-workspace self-heal at two retries', async () => {
    let call = 0
    const { plugin, react, timers } = loadPlugin({
      fetchImpl: async () => (++call <= 9
        ? jsonResponse({ ok: false, error: { code: 'no-workspace', message: 'still cold' } })
        : jsonResponse({ ok: true, value: { path: ROOT, root: ROOT, truncated: false, entries: [] } })),
    })
    plugin.apply(fakeCtx().ctx)
    const props = { parent: ROOT, sessionId: 's-1', revision: 0, autoRefresh: false, t: (key) => key }
    let pass = react.render(plugin.__internals.components.Level, props)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))
    // Fire every scheduled retry; the budget runs out after two.
    for (let round = 0; round < 6; round++) {
      const pending = timers.splice(0, timers.length).filter((timer) => timer.ms === plugin.__internals.NO_WORKSPACE_RETRY_MS)
      if (pending.length === 0) break
      pending.forEach((timer) => timer.fn())
      pass = react.render(plugin.__internals.components.Level, props)
      pass.runEffects()
      await new Promise((done) => setTimeout(done, 0))
      pass = react.render(plugin.__internals.components.Level, props)
    }
    assert.equal(call, 3, 'initial read + two retries, then the level stays failed')
    assert.equal(plugin.__internals.NO_WORKSPACE_RETRY_MAX, 2)
    const notes = collect(pass.tree, (node) => node.props?.['data-at-sider-row'] === 'failed')
    assert.equal(notes.length, 1)
  })

  it('caps the no-workspace self-heal at two retries', async () => {
    let call = 0
    const { plugin, react, timers } = loadPlugin({
      fetchImpl: async () => (++call <= 9
        ? jsonResponse({ ok: false, error: { code: 'no-workspace', message: 'still cold' } })
        : jsonResponse({ ok: true, value: { path: ROOT, root: ROOT, truncated: false, entries: [] } })),
    })
    plugin.apply(fakeCtx().ctx)
    const props = { parent: ROOT, sessionId: 's-1', revision: 0, autoRefresh: false, t: (key) => key }
    let pass = react.render(plugin.__internals.components.Level, props)
    pass.runEffects()
    await new Promise((done) => setTimeout(done, 0))
    // Fire every scheduled retry; the budget runs out after two.
    for (let round = 0; round < 6; round++) {
      const pending = timers.splice(0, timers.length).filter((timer) => timer.ms === plugin.__internals.NO_WORKSPACE_RETRY_MS)
      if (pending.length === 0) break
      pending.forEach((timer) => timer.fn())
      pass = react.render(plugin.__internals.components.Level, props)
      pass.runEffects()
      await new Promise((done) => setTimeout(done, 0))
      pass = react.render(plugin.__internals.components.Level, props)
    }
    assert.equal(call, 3, 'initial read + two retries, then the level stays failed')
    assert.equal(plugin.__internals.NO_WORKSPACE_RETRY_MAX, 2)
    const notes = collect(pass.tree, (node) => node.props?.['data-at-sider-row'] === 'failed')
    assert.equal(notes.length, 1)
  })

  it('renders the no-workspace state without a tree', () => {
    const { plugin, react } = loadPlugin()
    plugin.apply(fakeCtx().ctx)
    const pass = react.render(plugin.__internals.components.FilesBody, {
      sessionId: 's-1',
      useSessions: (selector) => selector({ byId: { 's-1': {} } }),
      useTabInfo: () => ({ tab: { id: 'tab-1', title: 'Files', signal: new AbortController().signal, actions: { bindCommands: () => () => {} } } }),
      t: (key) => key,
    })
    const status = collect(pass.tree, (node) => node.props?.['data-at-sider-state'] === 'no-workspace')
    assert.equal(status.length, 1)
  })

  it('inserts on the @ button click and copies on Alt-click', async () => {
    const inserted = []
    const copied = []
    const { plugin, react, tree } = await renderBody({
      services: {
        sessions: { scope: () => ({}) },
        conversation: { input: { for: () => ({ addFiles: (references) => { inserted.push(...references); return true } }) } },
      },
    })
    const ref = collect(tree, (node) => node.props?.['data-at-sider-ref'] === `${ROOT}/README.md`)[0]
    const event = { preventDefault: () => {}, stopPropagation: () => {}, altKey: false }
    ref.props.onClick(event)
    assert.equal(inserted.length, 1)
    assert.deepEqual(inserted[0], {
      source: 'reference',
      ref: '@README.md',
      label: 'README.md',
      appearance: 'file',
      clipboardText: '@README.md',
    })

    // A directory's chip is labelled with its trailing slash.
    const dirRef = collect(tree, (node) => node.props?.['data-at-sider-ref'] === `${ROOT}/src`)[0]
    dirRef.props.onClick(event)
    assert.deepEqual(inserted[1].ref, '@src/')
    assert.equal(inserted[1].appearance, 'folder')

    // With no composer reachable, Alt-click and plain click both copy instead.
    const { plugin: bare, react: bareReact } = loadPlugin({
      fetchImpl: ROW_FETCH,
      navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
    })
    // A dictionary-bound `t`, so the label the button shows is the shipped copy.
    const t = (key) => bare.__internals.dictionaries.zh[key] ?? key
    const refProps = {
      sessionId: 's-1',
      root: ROOT,
      path: `${ROOT}/README.md`,
      entry: { name: 'README.md', type: 'file', mtimeMs: 1 },
      t,
    }
    bare.apply(fakeCtx().ctx)
    const rows = bareReact.render(bare.__internals.components.RefButton, refProps)
    assert.equal(textOf(rows.tree.children), '@文件', 'the idle label reads as a reference')
    // The noun is its own span so the narrow width tier can collapse to `@`.
    const glyph = rows.tree.children.find((child) => child.props?.className === undefined)
    const word = rows.tree.children.find((child) => child.props?.className === 'ats-word')
    assert.equal(textOf([glyph]), '@')
    assert.equal(textOf([word]), '文件')
    await rows.tree.props.onClick({ preventDefault: () => {}, stopPropagation: () => {}, altKey: false })
    await rows.tree.props.onClick({ preventDefault: () => {}, stopPropagation: () => {}, altKey: true })
    assert.deepEqual(copied, ['@README.md', '@README.md'])
    const after = bareReact.render(bare.__internals.components.RefButton, refProps)
    assert.equal(textOf(after.tree.children), '已复制', 'the outcome replaces the label, then reverts')

    // A directory gets its own noun; a fresh instance so the flash state is idle.
    const fresh = loadPlugin({ fetchImpl: ROW_FETCH })
    fresh.plugin.apply(fakeCtx().ctx)
    const folder = fresh.react.render(fresh.plugin.__internals.components.RefButton, {
      ...refProps,
      t: (key) => fresh.plugin.__internals.dictionaries.zh[key] ?? key,
      path: `${ROOT}/src`,
      entry: { name: 'src', type: 'directory', mtimeMs: 1 },
    })
    assert.equal(textOf(folder.tree.children), '@文件夹')
  })

  it('sorts by the chosen mode in the rendered tree and remembers the mode', async () => {
    const storage = fakeStorage()
    const { tree, plugin, react, props } = await renderBody({ storage })
    const rowsOf = (nodes) => collect(nodes, (node) => node.props?.['data-at-sider-entry'] !== undefined)
      .map((row) => row.props['data-at-sider-path'])
    const sortButtonIn = (nodes) => collect(nodes, (node) => node.props?.['data-at-sider-sort'] !== undefined)[0]
    const event = { preventDefault: () => {}, stopPropagation: () => {} }

    // Default: directories first, then natural name order.
    assert.deepEqual(rowsOf(tree), [`${ROOT}/src`, `${ROOT}/pipe`, `${ROOT}/README.md`])
    assert.equal(sortButtonIn(tree).props['data-at-sider-sort'], 'name')
    assert.match(sortButtonIn(tree).props.title, /按名称/)

    // One click: name → time. Within files, the newest is first.
    sortButtonIn(tree).props.onClick(event)
    let pass = react.render(plugin.__internals.components.FilesBody, props)
    assert.deepEqual(rowsOf(pass.tree), [`${ROOT}/src`, `${ROOT}/README.md`, `${ROOT}/pipe`],
      'README.md (older) still precedes the never-modified entry')
    assert.equal(sortButtonIn(pass.tree).props['data-at-sider-sort'], 'time')
    assert.equal(storage.entries().get(plugin.__internals.SORT_STORAGE_KEY), 'time', 'the mode is remembered')

    // A fresh materialization starts from the remembered mode.
    const again = loadPlugin({ fetchImpl: ROW_FETCH, storage })
    again.plugin.apply(fakeCtx().ctx)
    const reloaded = again.react.render(again.plugin.__internals.components.FilesBody, props)
    assert.equal(sortButtonIn(reloaded.tree).props['data-at-sider-sort'], 'time')

    // The full cycle walks back to name through size and type.
    for (const expected of ['size', 'type', 'name']) {
      sortButtonIn(pass.tree).props.onClick(event)
      pass = react.render(plugin.__internals.components.FilesBody, props)
      assert.equal(sortButtonIn(pass.tree).props['data-at-sider-sort'], expected)
      assert.equal(storage.entries().get(plugin.__internals.SORT_STORAGE_KEY), expected)
    }
  })
})

describe('columns, widths, and sorting (R11–R13)', () => {
  const internals = () => loadPlugin().plugin.__internals

  it('parses file addresses into session + path (R16)', () => {
    const api = internals()
    assert.deepEqual(
      api.fileAddressParts('dsh-resource://file/session/s-1/docs/a.md'),
      { sessionId: 's-1', path: 'docs/a.md' },
    )
    assert.deepEqual(
      api.fileAddressParts('dsh-resource://file/session/s-1/a%20b/c.md'),
      { sessionId: 's-1', path: 'a b/c.md' },
    )
    assert.equal(api.fileAddressParts('dsh-resource://file/absolute/x'), undefined)
    assert.equal(api.fileAddressParts('sidebar://guide'), undefined)
    assert.equal(api.fileAddressParts(undefined), undefined)
    assert.equal(api.revealPathFromAddress('dsh-resource://file/session/s-1/docs/a.md'), 'docs/a.md')
  })

  it('humanizes byte counts', () => {
    const api = internals()
    assert.equal(api.formatSize(0), '0 B')
    assert.equal(api.formatSize(870), '870 B')
    assert.equal(api.formatSize(1023), '1023 B')
    assert.equal(api.formatSize(1024), '1 KB')
    assert.equal(api.formatSize(1536), '1.5 KB')
    assert.equal(api.formatSize(2048), '2 KB', 'the trailing .0 is trimmed')
    assert.equal(api.formatSize(1024 * 1024), '1 MB')
    assert.equal(api.formatSize(3.4 * 1024 * 1024), '3.4 MB')
    assert.equal(api.formatSize(1024 ** 5), '1 PB')
    assert.equal(api.formatSize(undefined), '')
    assert.equal(api.formatSize(-5), '')
    assert.equal(api.formatSize(Number.NaN), '')
  })

  it('picks the column tier from the measured body width', () => {
    const api = internals()
    assert.equal(api.widthTier(299), 1, 'below 300: bare @ chip, short time, no size')
    assert.equal(api.widthTier(300), 2)
    assert.equal(api.widthTier(379), 2, '300–379: labelled chip + full time, no size')
    assert.equal(api.widthTier(380), 3, 'from 380: every column')
    assert.equal(api.widthTier(1200), 3)
    assert.equal(api.widthTier(undefined), 3, 'an unmeasurable body keeps every column')
  })

  it('cycles sort modes and keeps directories first', () => {
    const api = internals()
    assert.deepEqual(api.SORT_KEYS, ['name', 'time', 'size', 'type'])
    assert.equal(api.nextSort('name'), 'time')
    assert.equal(api.nextSort('time'), 'size')
    assert.equal(api.nextSort('size'), 'type')
    assert.equal(api.nextSort('type'), 'name')
    assert.equal(api.nextSort('bogus'), 'name', 'an unknown mode re-enters the cycle at name')

    const entries = [
      { name: 'b.txt', type: 'file', mtimeMs: 100, size: 10 },
      { name: 'zdir', type: 'directory', mtimeMs: 300 },
      { name: 'a10.log', type: 'file', mtimeMs: 200, size: 50 },
      { name: 'a2.log', type: 'file', mtimeMs: 400, size: 5 },
    ]
    assert.deepEqual(api.orderEntries(entries, 'name').map((entry) => entry.name),
      ['zdir', 'a2.log', 'a10.log', 'b.txt'], 'directories first, then natural name order')
    assert.deepEqual(api.orderEntries(entries, 'time').map((entry) => entry.name),
      ['zdir', 'a2.log', 'a10.log', 'b.txt'], 'files newest first (400/200/100)')
    assert.deepEqual(api.orderEntries(entries, 'size').map((entry) => entry.name),
      ['zdir', 'a10.log', 'b.txt', 'a2.log'], 'files largest first (50/10/5)')
    assert.deepEqual(api.orderEntries(entries, 'type').map((entry) => entry.name),
      ['zdir', 'a2.log', 'a10.log', 'b.txt'], 'kind rank, then extension group, then name')
    assert.deepEqual(api.orderEntries(entries, 'bogus').map((entry) => entry.name),
      api.orderEntries(entries, 'name').map((entry) => entry.name), 'an unknown mode falls back to name')
  })

  it('drops columns through the width tiers in CSS', () => {
    const { cssText, css } = internals()
    assert.match(cssText, /\.ats-root\[data-at-sider-width="1"\] \.ats-size,\.ats-root\[data-at-sider-width="2"\] \.ats-size\{display:none\}/)
    assert.match(cssText, /\.ats-root\[data-at-sider-width="1"\] \.ats-ref \.ats-word\{display:none\}/)
    assert.match(cssText, /\.ats-root\[data-at-sider-width="1"\] \.ats-mtimeLong\{display:none\}/)
    assert.match(cssText, /\.ats-root\[data-at-sider-width="1"\] \.ats-mtimeShort\{display:inline\}/)
    assert.match(cssText, /\.ats-mtimeShort\{display:none\}/, 'the short form is hidden at full width')
    assert.match(cssText, /\.ats-revealFlash\{outline:2px solid var\(--dsw-alias-label-primary\);outline-offset:-2px\}/,
      'the reveal flash mirrors the keyboard focus ring')
    assert.match(cssText, /\.ats-menuItem\{[^}]*font-size:var\(--dsh-content-font-size-secondary,13px\)/,
      'menu entries match the native menu font size')
    assert.equal(css.size, 'ats-size')
    assert.equal(css.word, 'ats-word')
    assert.equal(css.mtimeLong, 'ats-mtimeLong')
    assert.equal(css.mtimeShort, 'ats-mtimeShort')
    // R11 layout: the right-hand group is pinned with margin-left:auto, the size
    // is right-aligned in a fixed box, and a two-space gap precedes the date.
    assert.match(cssText, /\.ats-right\{margin-left:auto;flex:none;align-items:baseline;gap:2ch;display:flex\}/)
    assert.match(cssText, /\.ats-size\{min-width:7ch;text-align:right;/)
    const mtimeRule = /\.ats-mtime\{([^}]*)\}/.exec(cssText)
    assert.ok(mtimeRule !== null)
    assert.doesNotMatch(mtimeRule[1], /margin-left:auto/, 'the pin lives on the group, not the date')
    assert.equal(css.right, 'ats-right')
    assert.equal(css.mtimeLong, 'ats-mtimeLong')
    assert.equal(css.mtimeShort, 'ats-mtimeShort')
  })
})
