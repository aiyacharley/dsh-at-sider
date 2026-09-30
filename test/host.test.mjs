/**
 * Host-half tests: workspace containment, one level's listing with mtimes, the
 * truncation cap, and the route's request/response contract.
 *
 * Run with: node --test test/
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  AtSiderError,
  __internals,
  apply,
  handleListRequest,
  handleSearchRequest,
  listDirectory,
  resolveInsideWorkspace,
  ROUTE_PATH,
  SEARCH_ROUTE_PATH,
  searchWorkspace,
} from '../index.js'

/** @type {string} */
let root
/** @type {string} */
let outside

before(async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-at-sider-'))
  root = join(base, 'workspace')
  outside = join(base, 'elsewhere')
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
  await mkdir(join(root, 'zdir'), { recursive: true })
  for (const name of ['b.txt', 'a10.txt', 'a2.txt']) {
    const file = join(root, name)
    await writeFile(file, `content of ${name}`)
    const stamp = new Date(Date.UTC(2025, 0, 2, 3, 4, 5))
    await utimes(file, stamp, stamp)
  }
  await writeFile(join(outside, 'far.txt'), 'not in the workspace')
})

after(async () => {
  await rm(dirnameOf(root), { recursive: true, force: true })
})

/** The parent of a path, without pulling in another `node:path` import. */
function dirnameOf(path) {
  return path.slice(0, path.lastIndexOf('/')) || path.slice(0, path.lastIndexOf('\\'))
}

describe('plugin.apply', () => {
  /** A ctx that records what the plugin registers, and resolves services from `services`. */
  function fakeHostCtx(services = {}) {
    const routes = []
    const injected = []
    const ctx = {
      inject: (deps, callback) => {
        injected.push(deps)
        const scope = {
          get: (key) => services[key],
          effect: (fn) => {
            fn()
            return () => {}
          },
        }
        callback(scope)
      },
    }
    return { ctx, routes, injected }
  }

  const connection = (routes) => ({
    fetch: {
      register: (route) => {
        routes.push(route)
        return async () => {}
      },
    },
  })

  it('registers the listing and search routes for a live composition', async () => {
    const routes = []
    const { ctx, injected } = fakeHostCtx({
      connection: connection(routes),
      sessions: { get: (sessionId) => (sessionId === 's1' ? { header: { cwd: root } } : undefined) },
    })
    apply(ctx)

    assert.deepEqual(injected, [['connection', 'sessions']])
    assert.equal(routes.length, 2)
    const [listRoute, searchRoute] = routes
    assert.equal(listRoute.path, ROUTE_PATH)
    assert.equal(searchRoute.path, SEARCH_ROUTE_PATH)
    for (const route of routes) {
      assert.deepEqual(route.methods, ['POST'])
      assert.equal(route.requestBody, 'buffered')
      assert.equal(typeof route.fetch, 'function')
    }

    const response = await listRoute.fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', path: root }),
    }))
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.value.entries.map((entry) => entry.name), ['zdir', 'a2.txt', 'a10.txt', 'b.txt'])
    assert.ok(payload.value.entries.every((entry) => typeof entry.mtimeMs === 'number'))
  })

  it('stays inert when Connection or the session registry is absent', () => {
    const routes = []
    const bare = fakeHostCtx({})
    apply(bare.ctx)
    assert.equal(bare.routes.length, 0)

    const noFetch = fakeHostCtx({ connection: {}, sessions: {} })
    apply(noFetch.ctx)
    assert.equal(noFetch.routes.length, 0)

    const noSessions = fakeHostCtx({ connection: connection(routes) })
    apply(noSessions.ctx)
    assert.equal(routes.length, 2, 'the routes still register; the session lookup refuses later')
  })
})

describe('cold-session fallback (restored tab right after a restart)', () => {
  const internals = () => import('../index.js').then((m) => m.__internals)

  it('resolves the root from the live session header first', async () => {
    const { workspaceRootOf } = await internals()
    const sessions = { get: (id) => (id === 's1' ? { header: { cwd: 'C:/ws' } } : undefined) }
    assert.equal(await workspaceRootOf(sessions, 's1', () => { throw new Error('must not touch persistence') }), 'C:/ws')
  })

  it('falls back to the durable header when the session is not live yet', async () => {
    const { workspaceRootOf } = await internals()
    const sessions = { get: () => undefined }
    const persistence = { stat: async (id) => (id === 'cold' ? { header: { cwd: 'C:/cold-ws' } } : undefined) }
    assert.equal(await workspaceRootOf(sessions, 'cold', () => persistence), 'C:/cold-ws')
    assert.equal(await workspaceRootOf(sessions, 'other', () => persistence), undefined)
  })

  it('keeps working when persistence is missing, broken, or refuses', async () => {
    const { workspaceRootOf } = await internals()
    const sessions = { get: () => ({ header: {} }) }
    assert.equal(await workspaceRootOf(sessions, 's1'), undefined, 'no accessor at all')
    assert.equal(await workspaceRootOf(sessions, 's1', () => undefined), undefined, 'accessor returns nothing')
    assert.equal(await workspaceRootOf(sessions, 's1', () => ({})), undefined, 'persistence without stat')
    assert.equal(await workspaceRootOf(sessions, 's1', () => { throw new Error('service missing') }), undefined, 'accessor throws')
    const rejecting = { stat: async () => { throw new Error('boom') } }
    assert.equal(await workspaceRootOf(sessions, 's1', () => rejecting), undefined, 'stat rejects')
  })

  it('serves the route from the durable header for a cold session', async () => {
    const routes = []
    const services = {
      connection: { fetch: { register: (route) => { routes.push(route); return async () => {} } } },
      sessions: { get: () => undefined },
      sessionPersistence: { stat: async () => ({ header: { cwd: root } }) },
    }
    apply({
      inject: (deps, callback) => {
        callback({ get: (key) => services[key], effect: (fn) => { fn(); return () => {} } })
      },
    })
    assert.equal(routes.length, 2)
    const response = await routes[0].fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'restored', path: root }),
    }))
    const payload = await response.json()
    assert.equal(payload.ok, true, 'a cold session still lists')
    assert.equal(payload.value.entries.length, 4)
  })
})

describe('route path', () => {
  it('is an authenticated /api path made of legal segments', () => {
    assert.equal(ROUTE_PATH, '/api/dsh-at-sider/list')
    assert.ok(ROUTE_PATH.startsWith('/api/'))
    for (const segment of ROUTE_PATH.split('/').filter(Boolean)) {
      assert.match(segment, /^[A-Za-z0-9_$.-]+$/)
    }
  })
})

describe('resolveInsideWorkspace', () => {
  it('accepts the root itself and anything below it', () => {
    assert.equal(resolveInsideWorkspace(root, root), resolve(root))
    assert.equal(resolveInsideWorkspace(root, join(root, 'zdir')), resolve(join(root, 'zdir')))
  })

  it('resolves a root-relative path against the root', () => {
    assert.equal(resolveInsideWorkspace(root, 'zdir'), resolve(join(root, 'zdir')))
  })

  it('refuses a path that escapes the root', () => {
    assert.throws(() => resolveInsideWorkspace(root, resolve(root, '..')), (error) => {
      assert.ok(error instanceof AtSiderError)
      assert.equal(error.code, 'outside-workspace')
      return true
    })
    assert.throws(() => resolveInsideWorkspace(root, join(outside, 'far.txt')), /outside the session workspace/)
  })

  it('refuses a sibling whose name merely starts with the root', () => {
    assert.throws(() => resolveInsideWorkspace(root, `${root}-sibling/child`), (error) => {
      assert.equal(error.code, 'outside-workspace')
      return true
    })
  })

  it('refuses an empty path, a NUL byte, and a missing root', () => {
    assert.throws(() => resolveInsideWorkspace(root, ''), (error) => error.code === 'bad-request')
    assert.throws(() => resolveInsideWorkspace(root, `bad${String.fromCharCode(0)}path`), (error) => error.code === 'bad-request')
    assert.throws(() => resolveInsideWorkspace('', root), (error) => error.code === 'no-workspace')
  })
})

describe('listDirectory', () => {
  it('reports every child with its modification time, directories first', async () => {
    const level = await listDirectory(root, root)
    assert.equal(level.root, resolve(root))
    assert.equal(level.truncated, false)
    assert.deepEqual(level.entries.map((entry) => entry.name), ['zdir', 'a2.txt', 'a10.txt', 'b.txt'])
    assert.deepEqual(level.entries.map((entry) => entry.type), ['directory', 'file', 'file', 'file'])
    for (const entry of level.entries) {
      assert.equal(typeof entry.mtimeMs, 'number')
      assert.ok(Number.isFinite(entry.mtimeMs))
    }
    const a2 = level.entries.find((entry) => entry.name === 'a2.txt')
    assert.equal(a2.size, 'content of a2.txt'.length)
    assert.ok(Math.abs(a2.mtimeMs - Date.UTC(2025, 0, 2, 3, 4, 5)) < 2000)
  })

  it('cuts the level at the entry cap and says so', async () => {
    const level = await listDirectory(root, root, { maxEntries: 2 })
    assert.equal(level.truncated, true)
    assert.equal(level.entries.length, 2)
  })

  it('maps filesystem failures onto the route codes', async () => {
    await assert.rejects(listDirectory(root, join(root, 'missing')), (error) => error.code === 'not-found')
    await assert.rejects(listDirectory(root, join(root, 'a2.txt')), (error) => error.code === 'not-directory')
    await assert.rejects(listDirectory(root, outside), (error) => error.code === 'outside-workspace')
  })

  it('keeps bounded stat concurrency order-preserving', async () => {
    const { mapLimit } = __internals
    const seen = []
    const results = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      seen.push(value)
      await new Promise((done) => setTimeout(done, 2))
      return value * 2
    })
    assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14])
    assert.equal(seen.length, 7)
  })
})

describe('handleListRequest', () => {
  const request = (body) => new Request(`http://127.0.0.1${ROUTE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const deps = {
    getSessionRoot: (sessionId) => (sessionId === 's1' ? root : undefined),
  }

  it('answers one level for a live session', async () => {
    const response = await handleListRequest(request({ sessionId: 's1', path: root }), deps)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.value.path, resolve(root))
    assert.equal(payload.value.entries.length, 4)
  })

  it('rejects a malformed body with 400', async () => {
    const response = await handleListRequest(request('{not json'), deps)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'bad-request')
  })

  it('rejects a missing session id or path', async () => {
    assert.equal((await handleListRequest(request({ path: root }), deps)).status, 400)
    assert.equal((await handleListRequest(request({ sessionId: 's1' }), deps)).status, 400)
  })

  it('reports an unknown session as no-workspace', async () => {
    const response = await handleListRequest(request({ sessionId: 'gone', path: root }), deps)
    const payload = await response.json()
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'no-workspace')
  })

  it('reports an escaping path without leaking it', async () => {
    const response = await handleListRequest(request({ sessionId: 's1', path: outside }), deps)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'outside-workspace')
    assert.equal(payload.value, undefined)
  })

  it('does not cache and never throws on a transport-level surprise', async () => {
    const broken = { json: async () => { throw new Error('boom') } }
    const response = await handleListRequest(broken, deps)
    assert.equal(response.status, 400)
  })
})

describe('searchWorkspace (R15)', () => {
  /** @type {string} */
  let ws

  before(async () => {
    ws = join(await mkdtemp(join(tmpdir(), 'dsh-at-sider-search-')), 'ws')
    await mkdir(join(ws, 'src', 'deep'), { recursive: true })
    await mkdir(join(ws, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(join(ws, '.git'), { recursive: true })
    await writeFile(join(ws, 'find-me-root.txt'), 'r')
    await writeFile(join(ws, 'src', 'find-me.ts'), 'a')
    await writeFile(join(ws, 'src', 'deep', 'also-find-me.md'), 'b')
    await writeFile(join(ws, 'node_modules', 'pkg', 'find-me-hidden.mjs'), 'hidden')
    await writeFile(join(ws, '.git', 'find-me-in-git'), 'hidden')
  })

  after(async () => {
    await rm(dirnameOf(ws), { recursive: true, force: true })
  })

  it('finds matches at any depth and never descends into node_modules/.git', async () => {
    const result = await searchWorkspace(ws, 'find-me')
    assert.equal(result.truncated, false)
    assert.deepEqual(result.matches.map((match) => `${match.dir}/${match.name}`).sort(), [
      '/find-me-root.txt',
      '/src/deep/also-find-me.md',
      '/src/find-me.ts',
    ])
    assert.ok(result.matches.every((match) => typeof match.mtimeMs === 'number'))
    assert.ok(result.matches.every((match) => !match.path.includes('.git') && !match.path.includes('node_modules')),
      'the walk never reports entries from node_modules or .git')
  })

  it('is empty for a blank query without walking', async () => {
    const result = await searchWorkspace(ws, '   ')
    assert.deepEqual(result.matches, [])
    assert.equal(result.visited, 0)
  })

  it('honors the result cap and reports truncation', async () => {
    const result = await searchWorkspace(ws, 'find-me', { maxResults: 2 })
    assert.equal(result.truncated, true)
    assert.equal(result.matches.length, 2)
  })

  it('honors the depth cap', async () => {
    const result = await searchWorkspace(ws, 'also-find-me', { maxDepth: 1 })
    assert.equal(result.matches.length, 0, 'the only match sits two levels deep')
  })

  it('answers the search route end to end', async () => {
    const response = await handleSearchRequest(new Request(`http://127.0.0.1${SEARCH_ROUTE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', query: 'find-me' }),
    }), { getSessionRoot: () => ws })
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.value.matches.length, 3)
    assert.equal(payload.value.truncated, false)
  })

  it('answers no-workspace for an unknown session', async () => {
    const response = await handleSearchRequest(new Request(`http://127.0.0.1${SEARCH_ROUTE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'gone', query: 'find-me' }),
    }), { getSessionRoot: () => undefined })
    const payload = await response.json()
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'no-workspace')
  })
})

describe('git state (R40a)', () => {
  const { parseStatus, gitState, attachGitState } = __internals
  /** Run git in `cwd`; throws with stderr on failure so fixture bugs are loud. */
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

  describe('parseStatus', () => {
    it('parses the branch line, ahead/behind, and the three work-tree states', () => {
      const stdout = [
        '## main...origin/main [ahead 2, behind 1]',
        ' M unstaged.txt',
        'M  staged.txt',
        '?? untracked.txt',
        'MM both.txt',
        '',
      ].join('\0')
      const parsed = parseStatus(stdout)
      assert.equal(parsed.branch, 'main')
      assert.equal(parsed.ahead, 2)
      assert.equal(parsed.behind, 1)
      assert.equal(parsed.files.get('unstaged.txt'), 'unstaged')
      assert.equal(parsed.files.get('staged.txt'), 'staged')
      assert.equal(parsed.files.get('untracked.txt'), 'untracked')
      assert.equal(parsed.files.get('both.txt'), 'staged', 'staged wins when a file is both')
    })

    it('consumes a rename record second path and keeps paths with spaces', () => {
      const stdout = [
        '## main',
        'R  renamed with space.txt',
        'a dir/old name.txt',
        '',
      ].join('\0')
      const parsed = parseStatus(stdout)
      assert.equal(parsed.branch, 'main')
      assert.equal(parsed.ahead, 0)
      assert.ok(parsed.files.has('renamed with space.txt'))
      assert.equal(parsed.files.get('renamed with space.txt'), 'staged')
      assert.equal(parsed.files.size, 1, 'the original-path record is consumed, not parsed as a status')
    })

    it('parses a repository with no commits yet', () => {
      const parsed = parseStatus(['## No commits yet on main', '?? a.txt', ''].join('\0'))
      assert.equal(parsed.branch, 'main')
      assert.equal(parsed.files.get('a.txt'), 'untracked')
    })
  })

  describe('gitState', () => {
    it('assembles branch, ahead/behind, head, and the status map from a working repository', async () => {
      const base = await mkdtemp(join(tmpdir(), 'dsh-at-sider-git-'))
      const ws = join(base, 'ws')
      await mkdir(ws, { recursive: true })
      git(ws, 'init', '-b', 'main')
      git(ws, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-m', 'first commit')
      await writeFile(join(ws, 'clean.txt'), 'committed')
      git(ws, 'add', '.')
      git(ws, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', 'add clean.txt')
      await writeFile(join(ws, 'dirty.txt'), 'changed')

      const state = await gitState(ws, { now: () => Date.now() })
      assert.equal(state.available, true)
      assert.equal(state.branch, 'main')
      assert.equal(state.status.get('dirty.txt'), 'untracked')
      assert.equal(state.status.get('clean.txt'), undefined, 'a committed, unchanged file carries no state')
      assert.ok(state.head.subject.includes('add clean.txt'))
      assert.ok(state.head.hash.length >= 7)
      await rm(base, { recursive: true, force: true })
    })

    it('degrades to available:false outside a repository', async () => {
      const base = await mkdtemp(join(tmpdir(), 'dsh-at-sider-nogit-'))
      await mkdir(base, { recursive: true })
      const state = await gitState(base, { now: () => Date.now() })
      assert.deepEqual(state, { available: false })
      await rm(base, { recursive: true, force: true })
    })

    it('caches per cwd within the TTL and collapses concurrent reads', async () => {
      let runs = 0
      const runner = async () => {
        runs += 1
        return { code: 128, stdout: '', truncated: false }
      }
      await gitState('X:/cached-a', { runGit: runner, now: () => Date.now() })
      await gitState('X:/cached-a', { runGit: runner, now: () => Date.now() })
      await Promise.all([gitState('X:/cached-b', { runGit: runner, now: () => Date.now() }), gitState('X:/cached-b', { runGit: runner, now: () => Date.now() })])
      assert.equal(runs, 2, 'one run per cwd: the second read hits the cache, the concurrent pair collapses')
    })
  })

  describe('listing integration', () => {
    /** @type {string} */
    let ws

    before(async () => {
      ws = join(await mkdtemp(join(tmpdir(), 'dsh-at-sider-gitroute-')), 'ws')
      await mkdir(ws, { recursive: true })
      git(ws, 'init', '-b', 'main')
      await writeFile(join(ws, 'clean.txt'), 'committed')
      await writeFile(join(ws, 'dirty.txt'), 'will be modified')
      git(ws, 'add', '.')
      git(ws, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', 'initial: clean and dirty')
      await writeFile(join(ws, 'dirty.txt'), 'now modified')
      await writeFile(join(ws, 'untracked.txt'), 'brand new')
    })

    after(async () => {
      await rm(dirnameOf(ws), { recursive: true, force: true })
    })

    it('attaches the git block and per-file fields to the listing response', async () => {
      const response = await handleListRequest(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', path: ws }),
      }), { getSessionRoot: () => ws })
      const payload = await response.json()
      assert.equal(payload.ok, true)
      assert.equal(payload.value.git.available, true)
      assert.equal(payload.value.git.branch, 'main')
      assert.ok(payload.value.git.head.subject.startsWith('initial:'))
      assert.ok(Array.isArray(payload.value.git.commits) && payload.value.git.commits.length >= 1,
        'the git block carries the recent-commit list for the bottom bar')
      assert.equal(payload.value.git.commits[0].hash, payload.value.git.head.hash,
        'the newest commit leads the list')
      const byName = new Map(payload.value.entries.map((entry) => [entry.name, entry]))
      assert.equal(byName.get('dirty.txt').git, 'unstaged')
      assert.equal(byName.get('untracked.txt').git, 'untracked')
      assert.equal(byName.get('clean.txt').git, undefined, 'a clean file carries no git field')
      assert.equal(byName.get('clean.txt').type, 'file')
    })

    it('attaches available:false outside a repository and colors nothing', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'dsh-at-sider-bare-'))
      try {
        await writeFile(join(bare, 'x.txt'), 'plain')
        const response = await handleListRequest(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: 's1', path: bare }),
        }), { getSessionRoot: () => bare })
        const payload = await response.json()
        assert.equal(payload.value.git.available, false)
        assert.equal(payload.value.git.repos.length, 0)
        assert.ok(payload.value.entries.every((entry) => entry.git === undefined))
      } finally {
        await rm(bare, { recursive: true, force: true })
      }
    })

    it('maps entries of a workspace nested inside a repository via --show-prefix', async () => {
      // The workspace root is a subdirectory of the repository: the status map
      // is repository-relative, so the prefix must bridge the two.
      const base = await mkdtemp(join(tmpdir(), 'dsh-at-sider-nested-'))
      const repo = join(base, 'repo')
      const nested = join(repo, 'packages', 'app')
      await mkdir(nested, { recursive: true })
      git(repo, 'init', '-b', 'main')
      await writeFile(join(nested, 'inner.txt'), 'nested content')
      git(repo, 'add', '.')
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', 'nested initial')
      await writeFile(join(nested, 'inner.txt'), 'nested modified')

      const response = await handleListRequest(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', path: nested }),
      }), { getSessionRoot: () => nested })
      const payload = await response.json()
      assert.equal(payload.value.git.available, true)
      assert.equal(payload.value.entries.find((entry) => entry.name === 'inner.txt')?.git, 'unstaged',
        'the repo-relative status maps through the workspace prefix')
      await rm(base, { recursive: true, force: true })
    })
  })

  it('attachGitState tolerates an empty status map and missing head', () => {
    const value = { path: 'C:/ws', root: 'C:/ws', entries: [{ name: 'a.txt', type: 'file' }] }
    attachGitState(value, { available: true, branch: 'main', ahead: 0, behind: 0, head: undefined, status: new Map(), prefix: '' })
    assert.equal(value.git.available, true)
    assert.equal(value.git.head, undefined)
    assert.equal(value.entries[0].git, undefined)
  })

  describe('multi-repository workspaces (R40a)', () => {
    /** Build one repository at `dir` with one committed + one modified file. */
    const makeRepo = async (dir, subject) => {
      await mkdir(dir, { recursive: true })
      git(dir, 'init', '-b', 'main')
      await writeFile(join(dir, 'committed.txt'), 'committed')
      git(dir, 'add', '.')
      git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', subject)
      await writeFile(join(dir, 'committed.txt'), 'modified now')
    }

    it('discovers repositories at the first and second levels, not deeper', async () => {
      const base = await mkdtemp(join(tmpdir(), 'dsh-at-sider-disc-'))
      const ws = join(base, 'ws')
      await mkdir(join(ws, 'plain'), { recursive: true })
      await makeRepo(join(ws, 'alpha'), 'alpha initial')
      await makeRepo(join(ws, 'tools', 'beta'), 'beta initial')
      await makeRepo(join(ws, 'tools', 'beta', 'too-deep', 'nested'), 'too deep')
      const repos = await __internals.discoverRepos(ws, { now: () => Date.now() })
      assert.deepEqual(repos.map((repo) => repo.rel).sort(), ['alpha', 'tools/beta'],
        'level-1 and level-2 repositories are discovered; level-3 is not')
      await rm(base, { recursive: true, force: true })
    })

    it('marks a discovered but broken .git as invalid and keeps the selector honest', async () => {
      const base = await mkdtemp(join(tmpdir(), 'dsh-at-sider-brokengit-'))
      const ws = join(base, 'ws')
      await mkdir(join(ws, 'broken', '.git'), { recursive: true })
      await writeFile(join(ws, 'note.txt'), 'plain file')
      const repos = await __internals.discoverRepos(ws, { now: () => Date.now() })
      assert.deepEqual(repos.map((repo) => [repo.rel, repo.valid]), [['broken', false]],
        'a .git without HEAD is discovered but invalid')

      const response = await handleListRequest(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', path: ws }),
      }), { getSessionRoot: () => ws })
      const payload = await response.json()
      assert.equal(payload.value.git.available, false)
      assert.equal(payload.value.git.repos.length, 1)
      assert.equal(payload.value.git.repos[0].valid, false)
      assert.equal(payload.value.git.selected, undefined)
      await rm(base, { recursive: true, force: true })
    })

    it('serves a repository selector and per-repo dots for a workspace of sub-repositories', async () => {
      const base = await mkdtemp(join(tmpdir(), 'dsh-at-sider-multi-'))
      const ws = join(base, 'ws')
      await mkdir(ws, { recursive: true })
      await makeRepo(join(ws, 'alpha'), 'alpha initial')
      await makeRepo(join(ws, 'libs', 'beta'), 'beta initial')
      await writeFile(join(ws, 'stray.txt'), 'inside no repository')

      const list = async (gitRepo) => handleListRequest(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', path: ws, gitRepo }),
      }), { getSessionRoot: () => ws }).then((response) => response.json())

      // Default: the first discovered repository is selected.
      const first = await list(undefined)
      assert.equal(first.value.git.available, true)
      assert.deepEqual(first.value.git.repos.map((repo) => repo.rel).sort(), ['alpha', 'libs/beta'])
      assert.equal(first.value.git.selected, 'alpha')
      const firstByName = new Map(first.value.entries.map((entry) => [entry.name, entry]))
      assert.equal(firstByName.get('alpha').type, 'directory')
      assert.equal(firstByName.get('stray.txt').git, undefined, 'a file in no repository has no dot')

      // Selecting the other repository re-anchors the state.
      const second = await list('libs/beta')
      assert.equal(second.value.git.selected, 'libs/beta')
      assert.ok(second.value.git.head.subject.startsWith('beta initial'))
      assert.equal(second.value.git.commits[0].hash, second.value.git.head.hash)
      await rm(base, { recursive: true, force: true })
    })
  })
})
