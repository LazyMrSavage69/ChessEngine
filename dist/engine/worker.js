// Web Worker: handles engine search + opening book lookups + post-game review
// + per-move classification. All heavy computation lives here so the UI thread
// stays responsive.
//
// chess.js is loaded via CDN (no bare imports) — see engine/search.js for the
// rationale on the `+esm` jsdelivr endpoint.

import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm'
import { search, resetEngine, searchTopMoves, searchObviousMove } from './search.js'
import { PIECE_VALUES } from './evaluate.js'
import { bookMove } from '../opening/book.js'
import { reviewGame } from '../review/reviewer.js'
import { classifyMove } from '../review/classify.js'

// Difficulty presets: { depth, timeLimitMs, randomPct }
const DIFFICULTY = {
  beginner: { depth: 1, timeLimitMs: 700,  randomPct: 0.30 },
  easy:     { depth: 2, timeLimitMs: 1500, randomPct: 0.10 },
  medium:   { depth: 4, timeLimitMs: 4000, randomPct: 0 },
  hard:     { depth: 6, timeLimitMs: 7000, randomPct: 0 },
  expert:   { depth: 7, timeLimitMs: 10000, randomPct: 0 },
}

// Depth used for per-move "live" classification — kept lower than the engine's
// playing depth so the classify round-trip isn't a multi-second hang after every
// move. Quality is still sufficient to differentiate brilliant/blunder.
const CLASSIFY_DEPTH       = 4
const CLASSIFY_TIME_MS     = 1500

function pickRandomMove(fen) {
  const game = new Chess(fen)
  const moves = game.moves()
  if (moves.length === 0) return null
  return moves[Math.floor(Math.random() * moves.length)]
}

/**
 * Decide whether `playedMove` constitutes a "sacrifice" — needed by
 * classifyMove() to award '!!'. Two complementary heuristics:
 *
 *   1. Capture-with-higher: we captured a piece worth strictly LESS than the
 *      capturing piece. (Q takes P, R takes N, etc.) — a classic positional/
 *      tactical sacrifice.
 *   2. Undefended-square: after the move, the destination square has NO
 *      friendly defender (so any enemy attacker can grab it for free).
 *
 * If either is true we call it a sacrifice. False positives are tolerated
 * because classifyMove() additionally requires near-zero cp loss + winning
 * eval before stamping a Brilliant — the sacrifice flag alone is not enough.
 *
 * @param {string} fenBefore   – position before the move
 * @param {object} playedMove  – { from, to, promotion } (or a chess.js verbose move)
 * @returns {boolean}
 */
function detectSacrifice(fenBefore, playedMove) {
  const game = new Chess(fenBefore)
  const verbose = game.moves({ verbose: true }).find(m =>
    m.from === playedMove.from && m.to === playedMove.to &&
    (!playedMove.promotion || m.promotion === playedMove.promotion)
  )
  if (!verbose) return false

  // (1) Capture-with-higher: attacker outweighs victim.
  if (verbose.captured) {
    const attacker = PIECE_VALUES[verbose.piece]    || 0
    const victim   = PIECE_VALUES[verbose.captured] || 0
    if (attacker > victim) return true
  }

  // (2) Undefended destination — apply the move, then check whether the moving
  // side has ANY defender of the destination square. If not, the piece is
  // hanging (or it's a positional sacrifice).
  const after = new Chess(fenBefore)
  after.move(verbose)
  // After the move, opponent is to move. To find OUR defenders of `to`, we
  // need pseudo-legal moves from our side. chess.js doesn't expose this
  // directly, so we make a null-style switch by flipping the side in the FEN.
  const parts = after.fen().split(' ')
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-'
  const defenderProbe = new Chess(parts.join(' '))
  const defenders = defenderProbe.moves({ verbose: true })
    .filter(m => m.to === verbose.to && m.from !== verbose.to)
  if (defenders.length === 0) return true

  return false
}

self.onmessage = function (e) {
  const msg = e.data

  try {
    switch (msg.type) {
      case 'search': {
        const { fen, ply, difficulty } = msg
        const preset = DIFFICULTY[difficulty] || DIFFICULTY.medium

        // 1. Try opening book first
        const book = bookMove(fen, ply || 0)
        if (book) {
          self.postMessage({
            type: 'bestmove',
            move: book.move,
            bookMove: true,
            openingName: book.name,
            eco: book.eco,
          })
          return
        }

        // 2. Random move injection for lower difficulties
        if (preset.randomPct > 0 && Math.random() < preset.randomPct) {
          const randomSan = pickRandomMove(fen)
          if (randomSan) {
            self.postMessage({
              type: 'bestmove',
              move: randomSan,
              bookMove: false,
              openingName: null,
              eco: null,
            })
            return
          }
        }

        // 3. Engine search with iterative deepening
        const result = search(fen, preset.depth, preset.timeLimitMs, (info) => {
          self.postMessage({
            type: 'info',
            depth: info.depth,
            score: info.score,
            nodes: info.nodes,
            move: info.move?.san || null,
            timeMs: info.timeMs,
          })
        })

        self.postMessage({
          type: 'bestmove',
          move: result.move?.san || null,
          score: result.score,
          depth: result.depth,
          nodes: result.nodes,
          timeMs: result.timeMs,
          bookMove: false,
          openingName: null,
          eco: null,
        })
        break
      }

      case 'review': {
        const { history } = msg
        const annotations = reviewGame(history, (progress) => {
          self.postMessage({
            type: 'review_progress',
            index: progress.index,
            total: progress.total,
          })
        })
        self.postMessage({ type: 'review_done', annotations })
        break
      }

      case 'classify': {
        // Per-move live classification.
        // Worker computes EVERYTHING needed (scores, top moves, sacrifice flag)
        // then hands it to the pure classifyMove() function in classify.js.
        const { fenBefore, fenAfter, playedMove, moveSan } = msg

        // 1. Full-depth top-3 moves on fenBefore → bestScore + topMoves.
        const { topMoves, bestScore } = searchTopMoves(
          fenBefore, 3, CLASSIFY_DEPTH, CLASSIFY_TIME_MS
        )

        // 2. Depth-1 obvious move on fenBefore.
        const obviousMove = searchObviousMove(fenBefore)

        // 3. Full-depth eval on fenAfter — negate so playedScore is from the
        //    MOVING side's perspective (engine returns side-to-move POV after
        //    the move, which is the OPPONENT of the player who just moved).
        const afterResult = search(fenAfter, CLASSIFY_DEPTH, CLASSIFY_TIME_MS)
        const playedScore = -afterResult.score

        // 4. Sacrifice detection.
        const isSacrifice = detectSacrifice(fenBefore, playedMove)

        // 5. Classify — pure function call, no side effects.
        const annotation = classifyMove(
          bestScore,
          playedScore,
          playedMove,
          obviousMove,
          topMoves.map(({ move }) => ({ from: move.from, to: move.to })),
          isSacrifice
        )

        self.postMessage({
          type: 'classified',
          annotation,
          moveSan,
          // Extra context the UI may want to display (best line, eval after).
          bestMoveSan: topMoves[0]?.move?.san || null,
          cploss: Math.max(0, bestScore - playedScore),
          playedScore,
        })
        break
      }

      case 'reset': {
        resetEngine()
        break
      }

      default:
        break
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) })
  }
}
