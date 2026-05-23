// build.js — Vercel build step.
// Copies the project into ./public and replaces the env-var placeholders inside
// config.js with the real values from process.env. We deliberately patch
// config.js (not index.html) so the script-tag-loaded Supabase client picks
// them up at runtime without any bundler.

import {
  readFileSync, writeFileSync, mkdirSync, cpSync, rmSync,
  existsSync, readdirSync, statSync,
} from 'fs'
import { join } from 'path'

const SRC_CONFIG = 'config.js'

// Items at the project root that should NOT be copied into public/.
const SKIP = new Set([
  'public',
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

// 2. Reset public/.
if (existsSync('public')) rmSync('public', { recursive: true, force: true })
mkdirSync('public', { recursive: true })

// 3. Copy every top-level entry into public/, skipping the blocklist. We can't
//    cpSync('.','public',...) because Node refuses to copy a directory into a
//    subdirectory of itself.
for (const entry of readdirSync('.')) {
  if (SKIP.has(entry)) continue
  const srcPath = entry
  const dstPath = join('public', entry)
  const isDir   = statSync(srcPath).isDirectory()
  if (isDir) {
    cpSync(srcPath, dstPath, { recursive: true })
  } else {
    cpSync(srcPath, dstPath)
  }
}

// 4. Overwrite public/config.js with the injected version.
writeFileSync('public/config.js', config)

console.log('Build complete → public/')
