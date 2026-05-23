// Opening book lookup: given a FEN, return a weighted-random book move
// or null if out of book. Only fires for ply ≤ 16.

import openings from './openings.js'

const MAX_BOOK_PLY = 16

/**
 * Look up a book move for the given FEN.
 * @param {string} fen – current position FEN
 * @param {number} ply – half-move count (0 = start)
 * @returns {{ move: string, name: string|null, eco: string|null } | null}
 */
export function bookMove(fen, ply) {
  if (ply > MAX_BOOK_PLY) return null

  const parts = fen.split(' ')
  // Primary key: position + side + castling + ep (strip halfmove + fullmove clocks)
  const key = parts.slice(0, 4).join(' ')
  let entry = openings[key]

  // Transposition fallback: match on position + side only (strip castling + ep)
  if (!entry) {
    const fallback = parts.slice(0, 2).join(' ')
    const found = Object.entries(openings).find(
      ([k]) => k.split(' ').slice(0, 2).join(' ') === fallback
    )
    if (found) entry = found[1]
  }

  if (!entry || !entry.moves || entry.moves.length === 0) return null

  // Weighted random pick
  const total = entry.moves.reduce((s, m) => s + (m.weight || 1), 0)
  let r = Math.random() * total
  for (const m of entry.moves) {
    r -= m.weight || 1
    if (r <= 0) return { move: m.san, name: entry.name, eco: entry.eco }
  }
  // Fallback to first move
  return { move: entry.moves[0].san, name: entry.name, eco: entry.eco }
}
