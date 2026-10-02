// Runs every live check (or the ones named on the command line) one after another.
// Usage: npm run live            (builds first, then all checks)
//        node scripts/live/all.mjs register receipts
import { readdirSync } from 'fs'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { ROOT } from './lib.mjs'

const dir = join(ROOT, 'scripts', 'live', 'checks')
const wanted = process.argv.slice(2)
const names = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.slice(0, -4))
  .filter((n) => wanted.length === 0 || wanted.includes(n))

const failed = []
for (const name of names) {
  console.log(`\n== ${name}`)
  const r = spawnSync(process.execPath, [join(dir, `${name}.mjs`)], { stdio: 'inherit', cwd: ROOT })
  if (r.status !== 0) failed.push(name)
}
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : `\nAll ${names.length} live checks passed`)
process.exitCode = failed.length ? 1 : 0
