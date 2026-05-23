// games/saveGame.js — build → compress → store flow for finished games.
//
// Pipeline:  moveHistory + result  →  Markdown string
//                                  →  gzip (CompressionStream, native — no libs)
//                                  →  Base64 (so it fits in TEXT/VARCHAR cols)
//                                  →  INSERT into `games` table on Supabase.
//
// The reverse pipeline (decompress → SAN tokens → board replay) lives in
// ui/reviewPanel.js where the "My Games" tab needs it.

import { supabase } from '/supabaseClient.js'

/**
 * Build a human-readable Markdown game record. The string itself is what gets
 * compressed and stored — keeping it readable means a manual decompress (gzcat)
 * always produces something useful. We don't use PGN: the prompt explicitly
 * asks for plain numbered move text inside Markdown.
 *
 * @param {{ san: string }[]} moveHistory  – each entry must carry .san
 * @param {string} result                  – '1-0' | '0-1' | '1/2-1/2'
 */
export function buildGameMD(moveHistory, result) {
  const date = new Date().toISOString().split('T')[0]
  const lines = [`# Game — ${date}`, `**Result:** ${result}`, '']

  let moveLine = ''
  moveHistory.forEach((move, i) => {
    if (i % 2 === 0) moveLine += `${Math.floor(i / 2) + 1}. `
    moveLine += `${move.san} `
    // Wrap lines at 80 chars for readability in raw form.
    if (moveLine.length > 80) {
      lines.push(moveLine.trim())
      moveLine = ''
    }
  })
  if (moveLine.trim()) lines.push(moveLine.trim())

  return lines.join('\n')
}

/**
 * gzip-then-base64 a string using the native CompressionStream API.
 * Works in every modern browser; no external dependencies.
 */
export async function compressToBase64(str) {
  const encoder = new TextEncoder()
  const stream  = new CompressionStream('gzip')
  const writer  = stream.writable.getWriter()
  writer.write(encoder.encode(str))
  writer.close()
  const buffer = await new Response(stream.readable).arrayBuffer()
  const bytes  = new Uint8Array(buffer)
  // Convert binary → Base64 via btoa. We chunk the conversion because btoa
  // chokes on huge string args, but in practice game MDs are ~1-3 KB so this
  // single pass is fine.
  let binary = ''
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary)
}

/** Inverse of compressToBase64 — used by the My Games tab to view archives. */
export async function decompressFromBase64(base64gz) {
  const binary = atob(base64gz)
  const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0))
  const stream = new DecompressionStream('gzip')
  const writer = stream.writable.getWriter()
  writer.write(bytes)
  writer.close()
  return await new Response(stream.readable).text()
}

/**
 * Persist a completed game to Supabase. Safe to call after every game-over;
 * caller is expected to dedupe with a `saveAttempted` flag (see main.js).
 *
 * @param {{ san: string }[]} moveHistory
 * @param {string} result
 */
export async function saveGame(moveHistory, result) {
  if (!moveHistory || moveHistory.length === 0) {
    return { ok: false, error: 'No moves to save.' }
  }

  const rawMD    = buildGameMD(moveHistory, result)
  const moves_gz = await compressToBase64(rawMD)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // Not signed in — skip silently. Persistence is for logged-in users only.
    console.warn('saveGame skipped: no authenticated user.')
    return { ok: false, error: 'Not signed in.' }
  }

  const { error } = await supabase.from('games').insert({
    user_id:    user.id,
    moves_gz,                   // gzip-compressed, Base64-encoded MD string
    result,                     // '1-0' | '0-1' | '1/2-1/2'
    move_count: moveHistory.length,
  })

  if (error) {
    console.error('Failed to save game:', error.message)
    return { ok: false, error: error.message }
  }

  return { ok: true }
}
