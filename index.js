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
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/** The exact route this plugin owns, under Connection's authenticated `/api` fence. */
export const ROUTE_PATH = '/api/dsh-at-sider/list'
/** Directory entries returned for one level; the rest is reported as `truncated`. */
export const MAX_ENTRIES = 2000
/** Bounded `stat` concurrency for one level, so a huge directory cannot serialize. */
export const STAT_CONCURRENCY = 32

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
 * @param {{ getSessionRoot?: (sessionId: string) => Promise<string | undefined> | string | undefined }} deps - session lookup seam.
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
    scope.effect(() => register({
      path: ROUTE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleListRequest(request, deps),
    }), 'dsh-at-sider: workspace listing route')
  })
}

/** Internals for the Host-side unit tests; not part of the plugin contract. */
export const __internals = {
  AtSiderError,
  compareEntries,
  kindOfDirent,
  listDirectory,
  mapFsError,
  mapLimit,
  pathKey,
  resolveInsideWorkspace,
  workspaceRootOf,
}
