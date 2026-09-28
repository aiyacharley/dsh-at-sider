#!/usr/bin/env node
// scripts/run-tests.mjs — run the offline test suite: every test/*.test.mjs
// through `node --test`, in one process, with a nonzero exit on failure.
// The suite is fully offline (no network, no browser): the Host half is driven
// through real requests against a temp workspace, and the Client artifact is
// loaded the way the module system loads it, with `window`/`navigator`/`fetch`
// injected.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = readdirSync(join(root, 'test'))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join('test', name))

if (files.length === 0) {
  console.error('no test/*.test.mjs files found')
  process.exitCode = 1
} else {
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' })
  process.exitCode = result.status ?? 1
}
