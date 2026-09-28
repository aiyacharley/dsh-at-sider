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
      return { type, props: props ?? {}, children }
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

/** Load the browser artifact and materialize its plugin, per test. */
function loadPlugin({ fetchImpl, navigator: navigatorImpl } = {}) {
  const registrations = []
  const window = {
    __ModuleLoader__: { load: (registration) => registrations.push(registration) },
    setTimeout: () => 1,
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
  new Function('window', 'navigator', 'fetch', source)(window, navigatorValue, fetchFn)
  assert.equal(registrations.length, 1, 'the artifact must register exactly one module')
  const [registration] = registrations
  const react = createReact()
  const plugin = registration.factory((specifier) => {
    if (specifier === 'react') return react.React
    throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
  })
  return { registration, plugin, react, calls }
}

/** A ctx that records every registration and resolves optional services from `services`. */
function fakeCtx(services = {}) {
  const record = { dictionaries: [], tabTypes: [], slots: [], registrations: [] }
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
        return () => {}
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
    assert.deepEqual(plugin.inject, ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'])
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

    assert.deepEqual(record.slots, ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
    const body = record.registrations[0]
    assert.equal(body.options.key, 'dsh-at-sider')
    assert.equal(body.options.locale, 'atSider')
    assert.equal(typeof body.component, 'function')
    const title = record.registrations[1]
    assert.equal(title.options.key, 'dsh-at-sider')
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
  async function renderBody({ services = {} } = {}) {
    const { plugin, react, calls } = loadPlugin({ fetchImpl: ROW_FETCH })
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

    const rows = collect(tree, (node) => node.props?.['data-at-sider-entry'] !== undefined)
    assert.deepEqual(rows.map((row) => row.props['data-at-sider-entry']), ['directory', 'other', 'file'])
    assert.deepEqual(rows.map((row) => row.props['data-at-sider-path']), [`${ROOT}/src`, `${ROOT}/pipe`, `${ROOT}/README.md`])

    const dates = collect(tree, (node) => node.props?.['data-at-sider-mtime'] !== undefined)
    assert.equal(dates.length, 2, 'both a directory and a file carry a date')
    assert.equal(dates[0].children[0], plugin.__internals.formatMtime(1735787045000))
    assert.match(dates[0].children[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    assert.match(dates[0].props.title, /2025/)

    const refs = collect(tree, (node) => node.props?.['data-at-sider-ref'] !== undefined)
    assert.equal(refs.length, 2, 'the un-openable entry has no @ button')
    assert.deepEqual(refs.map((ref) => ref.props['data-at-sider-ref']), [`${ROOT}/src`, `${ROOT}/README.md`])
  })

  it('opens a file through the tab and refuses nothing twice', async () => {
    const { tree, opened } = await renderBody()
    const fileRow = collect(tree, (node) => node.props?.['data-at-sider-path'] === `${ROOT}/README.md`)[0]
    const row = collect(fileRow, (node) => node.props?.role === 'button')[0]
    row.props.onClick()
    assert.deepEqual(opened, ['dsh-resource://file/session/s-1/README.md'])
  })

  it('routes a failing level to its failure line', async () => {
    const { plugin, react } = loadPlugin({
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
    bare.apply(fakeCtx().ctx)
    const rows = bareReact.render(bare.__internals.components.RefButton, {
      sessionId: 's-1',
      root: ROOT,
      path: `${ROOT}/README.md`,
      entry: { name: 'README.md', type: 'file', mtimeMs: 1 },
      t: (key) => key,
    })
    await rows.tree.props.onClick({ preventDefault: () => {}, stopPropagation: () => {}, altKey: false })
    await rows.tree.props.onClick({ preventDefault: () => {}, stopPropagation: () => {}, altKey: true })
    assert.deepEqual(copied, ['@README.md', '@README.md'])
  })
})
