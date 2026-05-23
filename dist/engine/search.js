// Negamax alpha-beta search with:
//   • Iterative deepening + aspiration windows
//   • Transposition table
//   • MVV-LVA + killer + history move ordering
//   • Late-Move Reductions (LMR)
//   • Null-move pruning
//   • Quiescence search (captures only)
// All scores are from the side-to-move's perspective.
//
// chess.js is loaded via CDN (no bare imports). The `+esm` jsdelivr endpoint
// transparently re-exports the UMD bundle as an ES module — works both in the
// main thread and inside module Web Workers.

import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm'
import { evaluate, PIECE_VALUES, gamePhase } from './evaluate.js'
import { zobristHash } from './zobrist.js'
import {
  ttGet, ttSet, ttNewAge, ttClear,
  TT_FLAG_EXACT, TT_FLAG_LOWER, TT_FLAG_UPPER,
} from './tt.js'
import {
  storeKiller, getKillers, clearKillers,
} from './killers.js'
import {
  updateHistory, getHistory, clearHistory,
} from './history.js'

const MATE_SCORE = 99999
const INF = 1e9

// ─── Move ordering ──────────────────────────────────────────────
function scoreMove(move, ply, ttBestSan) {
  if (ttBestSan && move.san === ttBestSan) return 1_000_000
  if (move.captured) {
    // MVV-LVA: prefer high-value victim, low-value attacker
    return 100_000 + (PIECE_VALUES[move.captured] || 0) - Math.floor((PIECE_VALUES[move.piece] || 0) / 10)
  }
  if (move.promotion) {
    return 90_000 + (PIECE_VALUES[move.promotion] || 0)
  }
  const [k1, k2] = getKillers(ply)
  if (k1 && move.san === k1) return 80_000
  if (k2 && move.san === k2) return 70_000
  return getHistory(move)
}

function orderMoves(moves, ply, ttBestSan) {
  const scored = moves.map((m) => ({ m, s: scoreMove(m, ply, ttBestSan) }))
  scored.sort((a, b) => b.s - a.s)
  return scored.map((x) => x.m)
}

// ─── Quiescence search (captures only) ──────────────────────────
function quiescence(game, alpha, beta, nodeCounter) {
  nodeCounter.nodes++
  const standPat = evaluate(game)
  if (standPat >= beta) return beta
  if (standPat > alpha) alpha = standPat

  // Only search captures (and queen promotions implicitly via flags).
  const moves = game.moves({ verbose: true }).filter((m) => m.captured || m.promotion === 'q')

  // Order captures by MVV-LVA. Skip clearly losing captures (lazy SEE).
  moves.sort((a, b) => {
    const av = (PIECE_VALUES[a.captured] || 0) - Math.floor((PIECE_VALUES[a.piece] || 0) / 10)
    const bv = (PIECE_VALUES[b.captured] || 0) - Math.floor((PIECE_VALUES[b.piece] || 0) / 10)
    return bv - av
  })

  for (const m of moves) {
    // Delta pruning: skip captures that can't possibly raise alpha enough.
    const optimisticGain = (PIECE_VALUES[m.captured] || 0) + 200
    if (standPat + optimisticGain < alpha) continue

    game.move(m)
    const score = -quiescence(game, -beta, -alpha, nodeCounter)
    game.undo()

    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

// ─── Null-move helper ───────────────────────────────────────────
// Switch side-to-move without moving a piece, clearing en passant.
function makeNullGame(game) {
  const parts = game.fen().split(' ')
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-'
  // Bump halfmove clock to be safe (chess.js allows it).
  parts[4] = '0'
  return new Chess(parts.join(' '))
}

// ─── Main negamax search ────────────────────────────────────────
function negamax(game, depth, alpha, beta, ply, allowNull, ctx) {
  ctx.nodes++

  // Time check (every 4096 nodes)
  if ((ctx.nodes & 0xfff) === 0 && performance.now() - ctx.startTime > ctx.timeLimitMs) {
    ctx.aborted = true
    return 0
  }
  if (ctx.aborted) return 0

  const inCheck = game.isCheck()

  // Mate distance pruning.
  alpha = Math.max(alpha, -MATE_SCORE + ply)
  beta = Math.min(beta, MATE_SCORE - ply - 1)
  if (alpha >= beta) return alpha

  // Check extensions: don't drop into qsearch while in check.
  if (inCheck) depth++

  if (depth <= 0) return quiescence(game, alpha, beta, ctx)

  // Draw detection (cheap calls).
  if (ply > 0 && (
    game.isDraw() ||
    game.isStalemate() ||
    game.isThreefoldRepetition() ||
    game.isInsufficientMaterial()
  )) return 0

  // Transposition table probe.
  const hash = zobristHash(game)
  const ttEntry = ttGet(hash)
  let ttBestSan = null
  if (ttEntry) {
    ttBestSan = ttEntry.bestMove?.san || null
    if (ply > 0 && ttEntry.depth >= depth) {
      const s = ttEntry.score
      if (ttEntry.flag === TT_FLAG_EXACT) return s
      if (ttEntry.flag === TT_FLAG_LOWER && s >= beta) return s
      if (ttEntry.flag === TT_FLAG_UPPER && s <= alpha) return s
    }
  }

  // Null-move pruning: skip if in check, near-leaf, low material, or recursion-disabled.
  if (allowNull && !inCheck && depth >= 3 && gamePhase(game.board()) > 4 && Math.abs(beta) < MATE_SCORE - 1000) {
    const reduction = 2 + Math.floor(depth / 4)
    const nullGame = makeNullGame(game)
    const nullScore = -negamax(nullGame, depth - 1 - reduction, -beta, -beta + 1, ply + 1, false, ctx)
    if (ctx.aborted) return 0
    if (nullScore >= beta) {
      // Verify mate scores aren't returned via null-move (don't return mate from null pruning).
      if (Math.abs(nullScore) < MATE_SCORE - 1000) return nullScore
    }
  }

  const moves = orderMoves(game.moves({ verbose: true }), ply, ttBestSan)
  if (moves.length === 0) {
    return inCheck ? -MATE_SCORE + ply : 0
  }

  let bestScore = -INF
  let bestMove = null
  let flag = TT_FLAG_UPPER
  let movesSearched = 0
  const origAlpha = alpha

  for (const move of moves) {
    game.move(move)
    let score

    if (movesSearched === 0) {
      // Full-window for the first (likely best) move.
      score = -negamax(game, depth - 1, -beta, -alpha, ply + 1, true, ctx)
    } else {
      // Late-move reduction for quiet moves late in the list.
      // More conservative reductions improve strength at the cost of speed.
      let reduction = 0
      if (depth >= 4 && movesSearched >= 6 && !inCheck && !move.captured && !move.promotion) {
        reduction = 1
        if (movesSearched >= 10) reduction = 2
      }

      // Null-window search.
      score = -negamax(game, depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true, ctx)

      // Re-search at full depth if reduction returned a promising score.
      if (!ctx.aborted && score > alpha && reduction > 0) {
        score = -negamax(game, depth - 1, -alpha - 1, -alpha, ply + 1, true, ctx)
      }
      // Re-search with a full window if PV-node.
      if (!ctx.aborted && score > alpha && score < beta) {
        score = -negamax(game, depth - 1, -beta, -alpha, ply + 1, true, ctx)
      }
    }

    game.undo()
    if (ctx.aborted) return 0

    movesSearched++

    if (score > bestScore) {
      bestScore = score
      bestMove = move
    }

    if (score > alpha) {
      alpha = score
      flag = TT_FLAG_EXACT
    }

    if (alpha >= beta) {
      flag = TT_FLAG_LOWER
      if (!move.captured) {
        storeKiller(ply, move.san)
        updateHistory(move, depth)
      }
      break
    }
  }

  if (!ctx.aborted) {
    ttSet(hash, depth, bestScore, flag, bestMove)
  }

  return bestScore
}

// ─── Root search: returns best move + score ─────────────────────
function searchRoot(game, depth, alpha, beta, ctx) {
  const hash = zobristHash(game)
  const ttEntry = ttGet(hash)
  const ttBestSan = ttEntry?.bestMove?.san || null

  const moves = orderMoves(game.moves({ verbose: true }), 0, ttBestSan)
  if (moves.length === 0) return { move: null, score: 0 }

  let bestScore = -INF
  let bestMove = moves[0]
  const origAlpha = alpha

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]
    game.move(move)
    let score
    if (i === 0) {
      score = -negamax(game, depth - 1, -beta, -alpha, 1, true, ctx)
    } else {
      score = -negamax(game, depth - 1, -alpha - 1, -alpha, 1, true, ctx)
      if (!ctx.aborted && score > alpha && score < beta) {
        score = -negamax(game, depth - 1, -beta, -alpha, 1, true, ctx)
      }
    }
    game.undo()
    if (ctx.aborted) break

    if (score > bestScore) {
      bestScore = score
      bestMove = move
    }
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }

  ttSet(hash, depth, bestScore, bestScore <= origAlpha ? TT_FLAG_UPPER :
        bestScore >= beta ? TT_FLAG_LOWER : TT_FLAG_EXACT, bestMove)

  return { move: bestMove, score: bestScore }
}

/**
 * Iterative-deepening search with aspiration windows.
 * onIteration callback fires after each depth completes.
 */
export function search(fen, maxDepth = 4, timeLimitMs = 3000, onIteration) {
  const game = new Chess(fen)
  ttNewAge()
  clearKillers()
  clearHistory()

  const ctx = {
    startTime: performance.now(),
    timeLimitMs,
    nodes: 0,
    aborted: false,
  }

  const ASPIRATION_WINDOW = 50
  let bestMove = null
  let bestScore = 0
  let prevScore = 0
  let completedDepth = 0

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha, beta
    if (depth >= 4) {
      alpha = prevScore - ASPIRATION_WINDOW
      beta = prevScore + ASPIRATION_WINDOW
    } else {
      alpha = -INF
      beta = INF
    }

    let result, attempts = 0
    while (true) {
      result = searchRoot(game, depth, alpha, beta, ctx)
      if (ctx.aborted) break
      if (result.score <= alpha && attempts < 4) {
        alpha -= ASPIRATION_WINDOW * (1 << attempts)
        attempts++
      } else if (result.score >= beta && attempts < 4) {
        beta += ASPIRATION_WINDOW * (1 << attempts)
        attempts++
      } else {
        break
      }
    }

    if (ctx.aborted) break

    bestMove = result.move
    bestScore = result.score
    prevScore = result.score
    completedDepth = depth

    if (onIteration) {
      onIteration({
        depth,
        score: result.score,
        move: result.move,
        nodes: ctx.nodes,
        timeMs: performance.now() - ctx.startTime,
      })
    }

    // Early exit on forced mate.
    if (Math.abs(result.score) > MATE_SCORE - 1000) break

    // Time check: don't start a new iteration if we've used most of our budget.
    if (performance.now() - ctx.startTime > timeLimitMs * 0.5) break
  }

  return {
    move: bestMove,
    score: bestScore,
    depth: completedDepth,
    nodes: ctx.nodes,
    timeMs: performance.now() - ctx.startTime,
  }
}

export { searchRoot, MATE_SCORE }

// Reset tables — called at the start of a new game.
export function resetEngine() {
  ttClear()
  clearKillers()
  clearHistory()
}

// ─── Multi-PV style root search (top N moves) ───────────────────
/**
 * Search the position and return the top `n` root moves ranked by score.
 *
 * Used by the classification pipeline (review/classify.js) which needs:
 *   • the best score from full-depth search
 *   • the top 3 moves so it can tell whether the played move was at least
 *     "engine top-3" (qualifies as Great when it's a non-obvious top-3)
 *
 * This is NOT true Multi-PV — we simply iterate root moves, do a full search
 * after each, and pick the best `n` by resulting score. Slightly more
 * expensive than a single search but accurate.
 *
 * @returns {{ topMoves: { move, score }[], bestScore: number }}
 */
export function searchTopMoves(fen, n = 3, maxDepth = 4, timeLimitMs = 2000) {
  const game = new Chess(fen)
  const ctx = {
    startTime: performance.now(),
    timeLimitMs,
    nodes: 0,
    aborted: false,
  }
  const rootMoves = game.moves({ verbose: true })
  if (rootMoves.length === 0) return { topMoves: [], bestScore: 0 }

  const scored = []
  for (const m of rootMoves) {
    game.move(m)
    // Negate because the inner search is from opponent's view.
    const score = -negamax(game, maxDepth - 1, -INF, INF, 1, true, ctx)
    game.undo()
    if (ctx.aborted) break
    scored.push({ move: m, score })
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, n)
  return { topMoves: top, bestScore: top[0]?.score ?? 0 }
}

/**
 * Run a depth-1 search and return the single best move — used by the
 * classifier to detect "obvious" moves (the kind a human would play without
 * thinking). A move that's both played AND matches the depth-1 best is not
 * worthy of a "Great" annotation, no matter how good it is.
 */
export function searchObviousMove(fen, timeLimitMs = 200) {
  const game = new Chess(fen)
  const ctx = {
    startTime: performance.now(),
    timeLimitMs,
    nodes: 0,
    aborted: false,
  }
  const moves = game.moves({ verbose: true })
  if (moves.length === 0) return null

  let bestMove = moves[0]
  let bestScore = -INF
  for (const m of moves) {
    game.move(m)
    // Depth 1 = just evaluate the resulting position (already inside qsearch).
    const score = -quiescence(game, -INF, INF, ctx)
    game.undo()
    if (score > bestScore) {
      bestScore = score
      bestMove = m
    }
  }
  return bestMove
}
