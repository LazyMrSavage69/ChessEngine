// Zobrist hashing for chess positions.
// Uses a deterministic LCG so the same position always hashes the same way
// within a session — required for the transposition table to be valid.

const PIECES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK']

function buildTable() {
  let seed = 0xDEADBEEF >>> 0
  const rand = () => {
    seed = ((seed * 1664525) + 1013904223) >>> 0
    return seed
  }

  const table = {
    pieces: {},     // pieces[pieceCode][square 0..63]
    side: rand(),   // XOR when it's black to move
    castling: Array.from({ length: 16 }, () => rand()), // index = castling-rights bitmask
    ep: Array.from({ length: 8 }, () => rand()),        // ep target file (a..h)
  }
  for (const p of PIECES) {
    table.pieces[p] = Array.from({ length: 64 }, () => rand())
  }
  return table
}

const Z = buildTable()

// Convert a chess.js board() index (rank-major, rank 8 first) and file index
// into a 0..63 square index (a1=0, h8=63).
function squareIndex(rank8Top, file) {
  // chess.js board() returns rows top-down: row 0 = rank 8, row 7 = rank 1.
  const rank = 7 - rank8Top // rank 0 = rank 1, rank 7 = rank 8
  return rank * 8 + file
}

function castlingMask(castlingStr) {
  // 4-bit mask: K=1, Q=2, k=4, q=8
  let m = 0
  if (castlingStr.includes('K')) m |= 1
  if (castlingStr.includes('Q')) m |= 2
  if (castlingStr.includes('k')) m |= 4
  if (castlingStr.includes('q')) m |= 8
  return m
}

/**
 * Hash a chess.js Chess instance to a 32-bit unsigned integer.
 */
export function zobristHash(game) {
  let h = 0
  const board = game.board()
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (!sq) continue
      const code = (sq.color === 'w' ? 'w' : 'b') + sq.type.toUpperCase()
      const idx = squareIndex(r, c)
      h ^= Z.pieces[code][idx]
    }
  }
  if (game.turn() === 'b') h ^= Z.side

  const fenParts = game.fen().split(' ')
  h ^= Z.castling[castlingMask(fenParts[2] || '-')]
  const ep = fenParts[3]
  if (ep && ep !== '-') {
    const file = ep.charCodeAt(0) - 97 // 'a' = 97
    if (file >= 0 && file < 8) h ^= Z.ep[file]
  }

  return h >>> 0
}
