// build.js — Vercel build step.
// Copies the project into ./dist and replaces the env-var placeholders inside
// config.js with the real values from process.env. We deliberately patch
// config.js (not index.html) so the script-tag-loaded Supabase client picks
// them up at runtime without any bundler.

import {
  readFileSync, writeFileSync, mkdirSync, cpSync, rmSync,
  existsSync, readdirSync, statSync,
} from 'fs'
import { join } from 'path'

const SRC_CONFIG = 'config.js'

// Items at the project root that should NOT be copied into dist/.
const SKIP = new Set([
  'dist',
  'node_modules',
  '.git',
  '.env',
  '.env.local',
])

// 1. Read and patch config.js.
let config = readFileSync(SRC_CONFIG, 'utf8')
config = config
  .replace("'__SUPABASE_URL__'",      `'${process.env.SUPABASE_URL || ''}'`)
  .replace("'__SUPABASE_ANON_KEY__'", `'${process.env.SUPABASE_ANON_KEY || ''}'`)

// 2. Reset dist/.
if (existsSync('dist')) rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

// 3. Copy every top-level entry into dist/, skipping the blocklist. We can't
//    cpSync('.','dist',...) because Node refuses to copy a directory into a
//    subdirectory of itself.
for (const entry of readdirSync('.')) {
  if (SKIP.has(entry)) continue
  const srcPath = entry
  const dstPath = join('dist', entry)
  const isDir   = statSync(srcPath).isDirectory()
  if (isDir) {
    cpSync(srcPath, dstPath, { recursive: true })
  } else {
    cpSync(srcPath, dstPath)
  }
}

// 4. Overwrite dist/config.js with the injected version.
writeFileSync('dist/config.js', config)

console.log('Build complete → dist/')
