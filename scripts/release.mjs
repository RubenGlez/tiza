#!/usr/bin/env node
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

const [pkg, bump = 'patch'] = process.argv.slice(2)

const packages = { core: 'packages/core', mcp: 'packages/mcp' }

if (!pkg || !packages[pkg]) {
  console.error(`Usage: release.mjs <${Object.keys(packages).join('|')}> [patch|minor|major]`)
  process.exit(1)
}

if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Bump must be patch, minor, or major')
  process.exit(1)
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts })
}

function get(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

const branch = get('git rev-parse --abbrev-ref HEAD')
if (branch !== 'main') {
  console.error(`Must be on main (currently on ${branch})`)
  process.exit(1)
}

const status = get('git status --porcelain')
if (status) {
  console.error('Working tree is dirty — commit or stash changes first')
  process.exit(1)
}

run('git fetch origin main')
const behind = get('git rev-list HEAD..origin/main --count')
if (behind !== '0') {
  console.error(`Branch is ${behind} commit(s) behind origin/main — pull first`)
  process.exit(1)
}

run('pnpm check')
run('pnpm test')
run('pnpm build')
run('pnpm typecheck')

const pkgDir = packages[pkg]
run(`npm version ${bump} --no-git-tag-version`, { cwd: pkgDir })

const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const tag = `${pkg}@v${version}`

run(`git add ${pkgDir}/package.json`)
run(`git commit -m "${tag}"`)
run(`git tag ${tag}`)
run('git push && git push --tags')
run('pnpm publish --provenance --no-git-checks', { cwd: pkgDir })
