/**
 * dsh-at-sider — Host half.
 *
 * The Harness's own workspace-file service deliberately carries no modification
 * time: its directory entries are `{ name, type, size? }` and its file `version`
 * token is documented as opaque ("never parsed"). A date column therefore needs
 * a Host-side read of its own.
 *
 * This half contributes one authenticated Fetch route:
 *
 *   POST /api/dsh-at-sider/list   { sessionId, path }  ->  { ok, value | error }
 *
 * `value` is `{ path, root, entries: [{ name, type, mtimeMs, size? }], truncated }`.
 * The listing is confined to the session's workspace root: the requested path is
 * resolved against that root and refused when it escapes it, so the route can
 * never be used to enumerate arbitrary directories.
 *
 * @module dsh-at-sider
 */
import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/** The exact route this plugin owns, under Connection's authenticated `/api` fence. */
export const ROUTE_PATH = '/api/dsh-at-sider/list'
/** The recursive file-search route (R15). */
export const SEARCH_ROUTE_PATH = '/api/dsh-at-sider/search'
/** Directory entries returned for one level; the rest is reported as `truncated`. */
export const MAX_ENTRIES = 2000
/** Bounded `stat` concurrency for one level, so a huge directory cannot serialize. */
export const STAT_CONCURRENCY = 32
/** Search result cap; the walk stops as soon as this many matches are known. */
export const SEARCH_MAX_RESULTS = 200
/** Search depth cap below the workspace root. */
export const SEARCH_MAX_DEPTH = 12
/** Search walk cap on visited directories, bounding the whole traversal. */
export const SEARCH_MAX_DIRS = 4000
/** Directory names the search walk never descends into. */
export const SEARCH_SKIP_DIRS = ['node_modules', '.git']

const NUL = String.fromCharCode(0)

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** One typed failure of this route, mapped to a wire code the Client branches on. */
export class AtSiderError extends Error {
  /**
   * @param {string} code - stable wire code.
   * @param {string} message - human-readable detail.
   */
  constructor(code, message) {
    super(message)
    this.name = 'AtSiderError'
    this.code = code
  }
}

/**
 * Compare two entries for display: directories first, then by name.
 * @param {{ name: string, type: string }} left - first entry.
 * @param {{ name: string, type: string }} right - second entry.
 * @returns {number} negative, zero, or positive.
 */
export function compareEntries(left, right) {
  const group = Number(right.type === 'directory') - Number(left.type === 'directory')
  return group !== 0 ? group : byName.compare(left.name, right.name)
}

/** Normalize a path for containment comparison: `/` separators, no trailing slash, case-folded on Windows. */
function pathKey(path) {
  const unified = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? unified.toLowerCase() : unified
}

/**
 * Resolve `requested` against `root` and refuse anything outside it.
 * @param {string} root - absolute workspace root.
 * @param {string} requested - absolute or root-relative directory path.
 * @returns {string} the absolute path to list.
 * @throws {AtSiderError} `no-workspace`, `bad-request`, or `outside-workspace`.
 */
export function resolveInsideWorkspace(root, requested) {
  if (typeof root !== 'string' || root === '') {
    throw new AtSiderError('no-workspace', 'The session has no workspace directory')
  }
  if (typeof requested !== 'string' || requested === '') {
    throw new AtSiderError('bad-request', 'path is required')
  }
  if (requested.includes(NUL)) throw new AtSiderError('bad-request', 'path contains NUL')
  const rootAbs = resolve(root)
  const target = isAbsolute(requested) ? resolve(requested) : resolve(rootAbs, requested)
  const rootKey = pathKey(rootAbs)
  const targetKey = pathKey(target)
  if (targetKey !== rootKey && !targetKey.startsWith(`${rootKey}/`)) {
    throw new AtSiderError('outside-workspace', `"${requested}" is outside the session workspace`)
  }
  return target
}

/** The entry kind a `Dirent` reports without following its link, used when `stat` fails. */
function kindOfDirent(dirent) {
  if (dirent.isDirectory()) return 'directory'
  if (dirent.isFile()) return 'file'
  return 'other'
}

/** Map one `node:fs` failure onto the route's wire code. */
function mapFsError(error, path) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  switch (code) {
    case 'ENOENT':
      return new AtSiderError('not-found', `no directory at "${path}"`)
    case 'ENOTDIR':
      return new AtSiderError('not-directory', `"${path}" is not a directory`)
    case 'EACCES':
    case 'EPERM':
      return new AtSiderError('permission-denied', `"${path}" is not readable`)
    case 'ELOOP':
      return new AtSiderError('not-directory', `"${path}" is a link loop`)
    default:
      return new AtSiderError('unavailable', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Run `worker` over `items` with bounded concurrency, preserving input order.
 * @param {readonly unknown[]} items - inputs.
 * @param {number} concurrency - how many run in flight.
 * @param {(item: unknown, index: number) => Promise<unknown>} worker - one item's work.
 * @returns {Promise<unknown[]>} results in input order.
 */
export async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length)
  let next = 0
  const width = Math.max(1, Math.min(concurrency, items.length))
  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * List one workspace directory with each child's modification time.
 * @param {string} root - absolute workspace root.
 * @param {string} requested - absolute or root-relative directory path.
 * @param {{ maxEntries?: number, concurrency?: number }} [options] - test/override seams.
 * @returns {Promise<{ path: string, root: string, entries: object[], truncated: boolean }>} one level.
 * @throws {AtSiderError} on a refused path or an unreadable directory.
 */
export async function listDirectory(root, requested, options = {}) {
  const maxEntries = options.maxEntries ?? MAX_ENTRIES
  const dir = resolveInsideWorkspace(root, requested)
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    throw mapFsError(error, requested)
  }
  const visible = dirents.slice(0, maxEntries)
  const entries = await mapLimit(visible, options.concurrency ?? STAT_CONCURRENCY, async (dirent) => {
    const child = join(dir, dirent.name)
    // `stat` follows a link, so a directory link lists like its target and a
    // broken link degrades to the kind the entry itself reports.
    const info = await stat(child).catch(() => undefined)
    const type = info === undefined
      ? kindOfDirent(dirent)
      : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
    const entry = { name: dirent.name, type }
    if (info !== undefined) {
      entry.mtimeMs = info.mtimeMs
      if (info.isFile()) entry.size = info.size
    }
    return entry
  })
  entries.sort(compareEntries)
  return {
    path: dir,
    root: resolve(root),
    entries,
    truncated: dirents.length > maxEntries,
  }
}

/** A JSON reply that never caches: the Client re-reads on every invalidation. */
function jsonReply(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

/** The wire shape one route failure takes. */
function failure(code, message, status = 200) {
  return jsonReply({ ok: false, error: { code, message } }, status)
}

/**
 * Resolve a Session's workspace root: the live session header first, then the
 * durable header from session persistence.
 *
 * The persistence fallback is what keeps a restored sidebar tab working right
 * after a Host restart: the previously-open Session is not live in the registry
 * yet at that moment (the native `workspaceFiles` scope resolves through the
 * same `sessionPersistence.stat` fallback), so without it the route would answer
 * `no-workspace` and the tree would refuse to draw until a manual reload.
 * @param {object | undefined} sessions - the live session registry.
 * @param {string} sessionId - the authorizing session.
 * @param {() => unknown} [getPersistence] - lazy accessor for the persistence service.
 * @returns {Promise<string | undefined>} the absolute workspace root, or undefined.
 */
async function workspaceRootOf(sessions, sessionId, getPersistence) {
  const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
  const live = session?.header?.cwd
  if (typeof live === 'string' && live !== '') return live
  let persistence
  try {
    persistence = typeof getPersistence === 'function' ? getPersistence() : undefined
  } catch {
    persistence = undefined
  }
  if (typeof persistence?.stat !== 'function') return undefined
  const stored = await persistence.stat(sessionId).catch(() => undefined)
  const cwd = stored?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/**
 * Handle one listing request. Exported for tests; the route below is its only caller.
 * @param {Request} request - the buffered Fetch request.
 * @param {{ getSessionRoot?: (sessionId: string) => Promise<string | undefined> | string | undefined, runGit?: typeof runGit }} deps - session lookup seam and an optional git runner override (tests).
 * @returns {Promise<Response>} the JSON reply.
 */
export async function handleListRequest(request, deps) {
  let body
  try {
    body = await request.json()
  } catch {
    return failure('bad-request', 'body is not JSON', 400)
  }
  const record = typeof body === 'object' && body !== null ? body : {}
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  const path = typeof record.path === 'string' ? record.path : ''
  if (sessionId === '') return failure('bad-request', 'missing sessionId', 400)
  if (path === '') return failure('bad-request', 'missing path', 400)
  let root
  try {
    root = await deps.getSessionRoot(sessionId)
  } catch {
    root = undefined
  }
  if (root === undefined) return failure('no-workspace', 'The session has no workspace directory')
  try {
    const value = await listDirectory(root, path)
    // R40a: git state rides the listing; a failure here must never fail the
    // listing itself.
    try {
      const state = await gitState(root, typeof deps.runGit === 'function' ? { runGit: deps.runGit } : {})
      attachGitState(value, state)
    } catch {
      value.git = { available: false }
    }
    return jsonReply({ ok: true, value })
  } catch (error) {
    if (error instanceof AtSiderError) return failure(error.code, error.message)
    return failure('unavailable', error instanceof Error ? error.message : String(error))
  }
}

/** Normalize a host path for the wire: `/` separators whatever the platform uses. */
function toSlash(path) {
  return path.replace(/\\/g, '/')
}

// ─── Git state (R40a) ────────────────────────────────────────────────────────
// The work tree's current status (untracked / unstaged / staged) and the HEAD
// commit, read with bounded git subprocesses and attached to the listing
// response. Outside a repository — or without a git executable — the state is
// `available: false` and the Client renders nothing.

const GIT_TIMEOUT_MS = 3000
const GIT_MAX_BYTES = 1_000_000
const GIT_CACHE_TTL_MS = 30_000

/**
 * Run `git <args>` to completion with a timeout and a bounded stdout. Every
 * failure mode (missing executable, timeout, nonzero exit) resolves instead of
 * throwing: the caller treats the result as facts.
 * @param {readonly string[]} args - git arguments; never shell-interpreted.
 * @param {string} cwd - working directory for the command.
 * @returns {Promise<{ code: number | null, stdout: string, truncated: boolean }>} the run's facts.
 */
function runGit(args, cwd) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('git', args, { cwd, windowsHide: true })
    } catch {
      resolve({ code: null, stdout: '', truncated: false })
      return
    }
    let stdout = ''
    let truncated = false
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* already gone */ }
      resolve({ code: null, stdout, truncated })
    }, GIT_TIMEOUT_MS)
    child.stdout?.on('data', (chunk) => {
      if (stdout.length >= GIT_MAX_BYTES) {
        truncated = true
        return
      }
      stdout += chunk.toString('utf8')
      if (stdout.length >= GIT_MAX_BYTES) truncated = true
    })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: null, stdout: '', truncated: false })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, truncated })
    })
  })
}

/**
 * Parse `git status --porcelain=v1 -z --branch` output. Rename and copy records
 * carry the original path as a second NUL-terminated field, which the parser
 * must consume; paths may contain any character except NUL.
 * @param {string} stdout - the command's stdout.
 * @returns {{ branch: string | undefined, ahead: number, behind: number, files: Map<string, 'staged' | 'unstaged' | 'untracked'> }} the parsed status, paths relative to the repository root.
 */
export function parseStatus(stdout) {
  const records = stdout.split('\0')
  let branch
  let ahead = 0
  let behind = 0
  let index = 0
  if (records[0]?.startsWith('## ')) {
    const line = records[0].slice(3)
    if (line.startsWith('No commits yet on ')) {
      branch = line.slice('No commits yet on '.length)
    } else {
      const dots = line.indexOf('...')
      branch = dots === -1 ? line : line.slice(0, dots)
      const bracket = line.match(/\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/)
      if (bracket !== null) {
        ahead = Number(bracket[1] ?? 0)
        behind = Number(bracket[2] ?? bracket[3] ?? 0)
      }
    }
    index = 1
  }
  const files = new Map()
  for (; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4 || record[2] !== ' ') continue
    const x = record[0]
    const y = record[1]
    const path = record.slice(3)
    let state
    if (x === '?' && y === '?') state = 'untracked'
    else if (x !== ' ' && x !== '?') state = 'staged'
    else state = 'unstaged'
    files.set(path, state)
    // A rename/copy record's next NUL field is the original path; consume it so
    // it is not misread as another status record.
    if ((x === 'R' || x === 'C' || y === 'R' || y === 'C') && records[index + 1] !== undefined) index += 1
  }
  return { branch, ahead, behind, files }
}

/** The git facts one workspace root resolves to; cached per cwd for {@link GIT_CACHE_TTL_MS}. */
const gitCache = new Map()
const gitInFlight = new Map()

/**
 * Read the workspace's git state: repository location, status map, and HEAD.
 * `status` maps repository-relative paths to their work-tree state; the caller
 * maps them onto workspace entries with `--show-prefix`.
 * @param {string} root - absolute workspace root.
 * @param {{ runGit?: typeof runGit, now?: () => number }} [deps] - test seams.
 * @returns {Promise<object>} `{ available: false }` or `{ available: true, branch, ahead, behind, head?, status }`.
 */
export async function gitState(root, deps = {}) {
  const run = deps.runGit ?? runGit
  const now = deps.now ?? Date.now
  const key = toSlash(root)
  const cached = gitCache.get(key)
  if (cached !== undefined && cached.expires > now()) return cached.value
  const inFlight = gitInFlight.get(key)
  if (inFlight !== undefined) return inFlight
  const task = (async () => {
    const located = await run(['rev-parse', '--show-toplevel', '--show-prefix'], root)
    if (located.code !== 0) return { available: false }
    const [rootLine = '', prefixLine = ''] = located.stdout.split(/\r?\n/)
    const prefix = prefixLine.replace(/\r$/, '')
    const status = await run(['status', '--porcelain=v1', '-z', '--branch'], root)
    const parsed = status.code === 0 ? parseStatus(status.stdout) : { branch: undefined, ahead: 0, behind: 0, files: new Map() }
    const log = await run(['log', '-1', '--format=%H%x09%h%x09%at%x09%an%x09%s'], root)
    let head
    if (log.code === 0 && log.stdout.trim() !== '') {
      const [fullHash = '', shortHash = '', at = '', author = '', ...subject] = log.stdout.trim().split('\t')
      head = {
        hash: shortHash !== '' ? shortHash : fullHash.slice(0, 7),
        subject: subject.join('\t'),
        author,
        time: Number.isFinite(Number(at)) ? Number(at) * 1000 : undefined,
      }
    }
    return {
      available: true,
      branch: parsed.branch,
      ahead: parsed.ahead,
      behind: parsed.behind,
      head,
      status: parsed.files,
      prefix,
    }
  })()
  gitInFlight.set(key, task)
  try {
    const value = await task
    gitCache.set(key, { expires: now() + GIT_CACHE_TTL_MS, value })
    return value
  } finally {
    gitInFlight.delete(key)
  }
}

/**
 * Attach the git state to a listing: the root-level block plus one `git` field
 * per file entry whose workspace-relative path the status map covers.
 * @param {{ path: string, root: string, entries: object[] }} value - the listing.
 * @param {object} state - the state {@link gitState} resolved for the root.
 * @returns {void} mutates `value` in place.
 */
function attachGitState(value, state) {
  if (state.available !== true) {
    value.git = { available: false }
    return
  }
  const prefix = state.prefix ?? ''
  const base = toSlash(value.path).startsWith(toSlash(value.root))
    ? toSlash(value.path).slice(toSlash(value.root).length).replace(/^\/+|\/+$/g, '')
    : ''
  for (const entry of value.entries) {
    if (entry.type !== 'file') continue
    const relative = base === '' ? entry.name : `${base}/${entry.name}`
    const state2 = state.status.get(`${prefix}${relative}`)
    if (state2 !== undefined) entry.git = state2
  }
  value.git = {
    available: true,
    branch: state.branch,
    ahead: state.ahead,
    behind: state.behind,
    head: state.head,
  }
}

/**
 * Recursively find entries whose name contains `query` (case-insensitive),
 * starting at the workspace root. The walk is bounded three ways — depth, visited
 * directories, and result count — and never descends into `node_modules`/`.git`
 * or through directory symlinks (cycle safety). Only matches are stat'd.
 * @param {string} root - absolute workspace root.
 * @param {string} query - the substring to look for.
 * @param {{ maxResults?: number, maxDepth?: number, maxDirs?: number }} [options] - test/override seams.
 * @returns {Promise<{ root: string, query: string, matches: object[], truncated: boolean, visited: number }>} the matches.
 * @throws {AtSiderError} `no-workspace` when the root is empty.
 */
export async function searchWorkspace(root, query, options = {}) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const startDir = resolveInsideWorkspace(root, root)
  const maxResults = options.maxResults ?? SEARCH_MAX_RESULTS
  const maxDepth = options.maxDepth ?? SEARCH_MAX_DEPTH
  const maxDirs = options.maxDirs ?? SEARCH_MAX_DIRS
  if (needle === '') {
    return { root: toSlash(startDir), query: '', matches: [], truncated: false, visited: 0 }
  }
  const matches = []
  let truncated = false
  let visited = 0
  const queue = [{ dir: startDir, depth: 0, display: '' }]
  while (queue.length > 0) {
    if (matches.length >= maxResults || visited >= maxDirs) {
      truncated = true
      break
    }
    const { dir, depth, display } = queue.shift()
    visited += 1
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (matches.length >= maxResults) {
        truncated = true
        break
      }
      const child = join(dir, dirent.name)
      if (dirent.isDirectory() && depth < maxDepth && !SEARCH_SKIP_DIRS.includes(dirent.name.toLowerCase())) {
        queue.push({ dir: child, depth: depth + 1, display: `${display}/${dirent.name}` })
      }
      if (dirent.name.toLowerCase().includes(needle)) {
        const info = await stat(child).catch(() => undefined)
        const type = info === undefined
          ? kindOfDirent(dirent)
          : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
        const match = { name: dirent.name, path: toSlash(child), dir: display, type }
        if (info !== undefined) {
          match.mtimeMs = info.mtimeMs
          if (info.isFile()) match.size = info.size
        }
        matches.push(match)
      }
    }
  }
  return { root: toSlash(startDir), query: needle, matches, truncated, visited }
}

/**
 * Handle one search request. Exported for tests; the route below is its only caller.
 * @param {Request} request - the buffered Fetch request.
 * @param {{ getSessionRoot?: (sessionId: string) => Promise<string | undefined> | string | undefined }} deps - session lookup seam.
 * @returns {Promise<Response>} the JSON reply.
 */
export async function handleSearchRequest(request, deps) {
  let body
  try {
    body = await request.json()
  } catch {
    return failure('bad-request', 'body is not JSON', 400)
  }
  const record = typeof body === 'object' && body !== null ? body : {}
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  const query = typeof record.query === 'string' ? record.query : ''
  if (sessionId === '') return failure('bad-request', 'missing sessionId', 400)
  let root
  try {
    root = await deps.getSessionRoot(sessionId)
  } catch {
    root = undefined
  }
  if (root === undefined) return failure('no-workspace', 'The session has no workspace directory')
  try {
    const value = await searchWorkspace(root, query)
    return jsonReply({ ok: true, value })
  } catch (error) {
    if (error instanceof AtSiderError) return failure(error.code, error.message)
    return failure('unavailable', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Register the route for as long as Connection and the Session registry compose.
 * Missing services keep the plugin inert instead of failing the profile load.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['connection', 'sessions'], (scope) => {
    const connection = scope.get('connection')
    const sessions = scope.get('sessions')
    const register = typeof connection?.fetch?.register === 'function'
      ? connection.fetch.register.bind(connection.fetch)
      : undefined
    if (register === undefined) return
    const deps = {
      getSessionRoot: (sessionId) => workspaceRootOf(sessions, sessionId, () => {
        // sessionPersistence is read lazily and tolerantly: a composition
        // without it simply has no cold-session fallback.
        try {
          return scope.get('sessionPersistence')
        } catch {
          return undefined
        }
      }),
    }
    scope.effect(() => {
      register({
        path: ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleListRequest(request, deps),
      })
      register({
        path: SEARCH_ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleSearchRequest(request, deps),
      })
    }, 'dsh-at-sider: workspace routes')
  })
}

/** Internals for the Host-side unit tests; not part of the plugin contract. */
export const __internals = {
  AtSiderError,
  attachGitState,
  compareEntries,
  gitState,
  handleSearchRequest,
  kindOfDirent,
  listDirectory,
  mapFsError,
  mapLimit,
  parseStatus,
  pathKey,
  resolveInsideWorkspace,
  runGit,
  searchWorkspace,
  workspaceRootOf,
}
