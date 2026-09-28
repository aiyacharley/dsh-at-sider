#!/usr/bin/env node
/**
 * scripts/sync-mirror.mjs — ask npmmirror (registry.npmmirror.com, the default
 * registry for many users in China) to sync this package right after a release,
 * then poll until the just-published version is visible. Runs after the publish
 * step in release.yml; a mirror hiccup only prints a note and never fails the
 * release.
 *
 * Adapted from the sibling `dsh-pubmed` repository's script (same author, MIT).
 *
 * Implementation note: no AbortSignal.timeout (its handle races process.exit on
 * Windows and trips a libuv assertion, exit 0xC0000409) — an explicit
 * AbortController plus clearTimeout, and no process.exit: exitCode only.
 *
 * Manual run: node scripts/sync-mirror.mjs   (reads name/version from package.json)
 */
import { readFileSync } from 'node:fs'

const MIRROR = 'https://registry.npmmirror.com'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const { name, version } = pkg
const deadline = Date.now() + 5 * 60_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function json(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), 20_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  } finally {
    clearTimeout(timer)
  }
}

async function mirrorHas() {
  const { body } = await json(`${MIRROR}/${name}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } })
  return body?.versions !== undefined && version in body.versions
}

async function main() {
  try {
    if (await mirrorHas()) {
      console.log(`npmmirror already has ${name}@${version}`)
      return 0
    }
    const { body: task } = await json(`${MIRROR}/-/package/${name}/syncs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skipDependencies: true }),
    })
    console.log(`npmmirror sync requested for ${name}@${version}: task ${task?.id ?? '?'} (${task?.state ?? '?'})`)
    while (Date.now() < deadline) {
      await sleep(5_000)
      if (await mirrorHas()) {
        console.log(`npmmirror now serves ${name}@${version}`)
        return 0
      }
      if (task?.id !== undefined) {
        const { body: status } = await json(`${MIRROR}/-/package/${name}/syncs/${task.id}`)
        if (status?.state === 'fail') {
          console.log(`npmmirror sync task failed: ${status?.error ?? 'unknown'} — it will pick the version up on its own schedule.`)
          return 0
        }
      }
    }
    console.log(`npmmirror has not surfaced ${name}@${version} yet; users can pass --registry https://registry.npmjs.org meanwhile.`)
  } catch (error) {
    console.log(`npmmirror sync skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
  return 0
}

process.exitCode = await main()
