// Static evaluation: material + tapered piece-square tables + structural terms.
// Returns a centipawn score from the SIDE-TO-MOVE's perspective (negamax-friendly).

export const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }

// Phase weights — sum across non-pawn, non-king pieces. Max = 24 (full midgame).
const PHASE_MATERIAL = { n: 1, b: 1, r: 2, q: 4 }

// PSTs are indexed 0..63 with index 0 = a8 (top-left from white's view),
// index 63 = h1. Positive values favor white. For black pieces we mirror
// vertically: black-relative-index = (7 - rank) * 8 + file.
const PST_MG = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
}

const PST_EG = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    80, 80, 80, 80, 80, 80, 80, 80,
    50, 50, 50, 50, 50, 50, 50, 50,
    30, 30, 30, 30, 30, 30, 30, 30,
    20, 20, 20, 20, 20, 20, 20, 20,
    10, 10, 10, 10, 10, 10, 10, 10,
    10, 10, 10, 10, 10, 10, 10, 10,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: PST_MG.n,
  b: PST_MG.b,
  r: PST_MG.r,
  q: PST_MG.q,
  k: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
}

export function gamePhase(board) {
  let phase = 0
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (!sq || sq.type === 'p' || sq.type === 'k') continue
      phase += PHASE_MATERIAL[sq.type] || 0
    }
  }
  return Math.min(phase, 24)
}

function taper(mg, eg, phase) {
  return Math.round((mg * phase + eg * (24 - phase)) / 24)
}

// Convert chess.js (rank-row, file-col) → PST index for white pieces.
// chess.js board()[0] is rank 8 (top from white's view), so row 0 = PST index 0..7.
function pstIndex(row, col, isWhite) {
  return isWhite ? row * 8 + col : (7 - row) * 8 + col
}

function evalPawnStructure(board) {
  // Doubled & isolated pawn penalties. Positive = good for white.
  const wFiles = new Array(8).fill(0)
  const bFiles = new Array(8).fill(0)
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (sq?.type !== 'p') continue
      if (sq.color === 'w') wFiles[c]++
      else bFiles[c]++
    }
  }
  let score = 0
  for (let c = 0; c < 8; c++) {
    if (wFiles[c] > 1) score -= 20 * (wFiles[c] - 1)
    if (bFiles[c] > 1) score += 20 * (bFiles[c] - 1)
    const wIsolated = wFiles[c] > 0 &&
      (c === 0 || wFiles[c - 1] === 0) && (c === 7 || wFiles[c + 1] === 0)
    const bIsolated = bFiles[c] > 0 &&
      (c === 0 || bFiles[c - 1] === 0) && (c === 7 || bFiles[c + 1] === 0)
    if (wIsolated) score -= 15
    if (bIsolated) score += 15
  }
  return score
}

function evalKingShield(board) {
  // Count friendly pawns directly adjacent (and one rank ahead) of each king.
  let score = 0
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (!sq || sq.type !== 'k') continue
      const isWhite = sq.color === 'w'
      const sign = isWhite ? 1 : -1
      const shieldRow = isWhite ? r - 1 : r + 1
      if (shieldRow < 0 || shieldRow > 7) continue
      let shield = 0
      for (let dc = -1; dc <= 1; dc++) {
        const fc = c + dc
        if (fc < 0 || fc > 7) continue
        const front = board[shieldRow][fc]
        if (front?.type === 'p' && front.color === sq.color) shield++
      }
      score += sign * shield * 10
    }
  }
  return score
}

/**
 * Negamax sign convention: this function ALWAYS returns the score from the
 * SIDE-TO-MOVE's perspective.
 *   • Positive = side to move is winning.
 *   • Negative = side to move is losing.
 *
 * Implementation strategy:
 *   1. Accumulate `mg` / `eg` from WHITE's perspective (the natural orientation
 *      of the piece-square tables). A White piece contributes positively, a
 *      Black piece contributes negatively.
 *   2. At the end, taper between midgame/endgame and flip the sign if it is
 *      Black to move so the caller always gets a side-to-move score.
 *
 * Sanity check: on an empty board with one extra White queen, this returns a
 * large POSITIVE value when it's White's turn and a large NEGATIVE value when
 * it's Black's turn — matching the negamax convention used by search.js.
 *
 * PST mirroring is delegated to `pstIndex()`:
 *   • White pieces: indexed as-is (board()[0] = rank 8 in chess.js, which is
 *     PST index 0..7 — the squares closest to Black's back rank, where White
 *     pieces want to push toward).
 *   • Black pieces: rank is mirrored (7 - row) so a Black pawn near promotion
 *     scores like a White pawn near promotion from White's table.
 */
export function evaluate(game) {
  if (game.isCheckmate()) {
    // The side to move has been mated → very bad for them.
    return -99999
  }
  if (game.isDraw() || game.isStalemate() || game.isThreefoldRepetition() ||
      game.isInsufficientMaterial()) {
    return 0
  }

  const board = game.board()
  const phase = gamePhase(board)
  let mg = 0, eg = 0
  let wBishops = 0, bBishops = 0

  // Accumulate from WHITE's perspective. The final sign flip handles black-to-move.
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (!sq) continue
      const isWhite = sq.color === 'w'
      // sign = +1 for own (white) pieces, -1 for opponent (black). This is the
      // "material from white's view" sign — NOT the side-to-move flip, which
      // happens at the bottom of the function.
      const sign = isWhite ? 1 : -1
      const idx = pstIndex(r, c, isWhite)
      const base = PIECE_VALUES[sq.type]
      const mgPst = PST_MG[sq.type]?.[idx] ?? 0
      const egPst = PST_EG[sq.type]?.[idx] ?? 0

      mg += sign * (base + mgPst)
      eg += sign * (base + egPst)

      if (sq.type === 'b') {
        if (isWhite) wBishops++
        else bBishops++
      }
    }
  }

  // Bishop pair bonus (from white's view)
  if (wBishops >= 2) { mg += 30; eg += 50 }
  if (bBishops >= 2) { mg -= 30; eg -= 50 }

  // Pawn structure (slightly weightier in endgame). Already +white / -black.
  const pawn = evalPawnStructure(board)
  mg += pawn
  eg += Math.round(pawn * 1.5)

  // King safety only matters in midgame.
  mg += Math.round(evalKingShield(board) * (phase / 24))

  // Mobility from the side-to-move only (cheap proxy for activity).
  // We add it AFTER the white-perspective accumulation, then handle the flip
  // below — so mobility always benefits whoever is to move.
  const mobility = game.moves().length
  const mobilityBonus = mobility * 2

  let score = taper(mg, eg, phase)
  // Final negamax flip: convert white-perspective score → side-to-move score.
  if (game.turn() === 'b') score = -score
  // Mobility is added AFTER the flip so it benefits whoever is on move.
  score += mobilityBonus
  return score
}
