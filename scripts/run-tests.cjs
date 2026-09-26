// Runs Vitest inside Electron's bundled Node, because better-sqlite3 is
// compiled for Electron (see "postinstall") and won't load in plain Node.
const { spawnSync } = require('child_process')
const { join } = require('path')
const electron = require('electron')

const vitest = join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(electron, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(result.status ?? 1)
