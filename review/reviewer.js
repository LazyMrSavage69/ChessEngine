// Post-game review: re-evaluate every position at a fixed depth,
// compare the actual move to the engine's best move, compute delta,
// then layer in tactical overrides (Brilliant / Great / Book).

import { Chess } from 'chess.js'
import { search, MATE_SCORE } from '../engine/search.js'
import { PIECE_VALUES } from '../engine/evaluate.js'
import { bookMove } from '../opening/book.js'
import { classify, brilliant, great, book } from './classify.js'

const REVIEW_DEPTH = 4
const REVIEW_TIME  = 2000 // ms per position

// Minimum value a sacrificed piece must have to count as a Brilliant. Pawn
// sacrifices are too noisy and rarely "brilliant" in the chess.com sense.
const BRILLIANT_MIN_SAC_VALUE = 280
// Played-move eval must still be at least this many cp to call it Brilliant —
// you don't get a Brilliant for a losing sacrifice.
const BRILLIANT_MIN_EVAL_CP   = 50
// Gap (in cp) between the best move and the second-best move that qualifies
// the played move as a "Great" / only-move.
const GREAT_GAP_CP            = 150

/**
 * Analyse a full game and return per-move annotations.
 * @param {{ fen: string, moveSan: string, player: string }[]} history
 * @param {(progress: { index: number, total: number }) => void} [onProgress]
 */
export function reviewGame(history, onProgress) {
  const annotations = []

  for (let i = 0; i < history.length; i++) {
    const { fen, moveSan, player } = history[i]

    try {
      // 0. Opening-book override: if the played move appears in our book at
      //    this position (within book depth), mark it as Book and skip the
      //    expensive search/classification entirely.
      const bookHit = bookMove(fen, i)
      if (bookHit && bookHit.move === moveSan) {
        const game = new Chess(fen)
        const played = game.move(moveSan)
        annotations.push({
          moveSan: played?.san || moveSan,
          bestMove: null,
          delta: 0,
          classification: book(),
          fen,
          player,
          arrow: null,
        })
        if (onProgress) onProgress({ index: i, total: history.length })
        continue
      }

      // 1. Find engine's best move + score from this position.
      const bestResult = search(fen, REVIEW_DEPTH, REVIEW_TIME)
      const bestScore  = bestResult.score
      const bestMove   = bestResult.move

      // 2. Play the actual move and evaluate the resulting position.
      const game = new Chess(fen)
      const played = game.move(moveSan)
      if (!played) {
        annotations.push({
          moveSan, bestMove: null, delta: 0,
          classification: classify(0, true), fen, player, arrow: null,
        })
        if (onProgress) onProgress({ index: i, total: history.length })
        continue
      }

      const afterResult = search(game.fen(), REVIEW_DEPTH, REVIEW_TIME)
      const actualScore = -afterResult.score // negate: was from opponent's POV

      // 3. Delta = how much worse the actual move was vs best.
      const delta = Math.max(0, bestScore - actualScore)
      const isBest = bestMove && played.san === bestMove.san

      let classification = classify(delta, isBest)

      // 4. Tactical overrides.
      if (isBest) {
        // Brilliant: best move AND it's a sound material sacrifice.
        if (isBrilliantMove(fen, played, actualScore)) {
          classification = brilliant()
        } else if (isGreatMove(fen, played, bestScore)) {
          // Great: best move AND no other move is even close (only-move).
          classification = great()
        }
      }

      // Arrow data: red for played, green for best (only when notably worse).
      const arrow = delta > 100 && bestMove && !isBest
        ? {
            from: played.from,
            to: played.to,
            bestFrom: bestMove.from,
            bestTo: bestMove.to,
          }
        : null

      annotations.push({
        moveSan: played.san,
        bestMove,
        delta,
        classification,
        fen,
        player,
        arrow,
      })
    } catch (err) {
      annotations.push({
        moveSan, bestMove: null, delta: 0,
        classification: classify(0, true), fen, player, arrow: null,
      })
    }

    if (onProgress) {
      onProgress({ index: i, total: history.length })
    }
  }

  return annotations
}

/**
 * Brilliant heuristic: after the played move, the moved piece sits on a
 * square attacked by a STRICTLY cheaper enemy piece (a real sacrifice), and
 * the resulting position is still at least equal — proving the sacrifice is
 * sound. We exclude pawn sacrifices.
 */
function isBrilliantMove(fen, played, postMoveEvalCp) {
  if (postMoveEvalCp < BRILLIANT_MIN_EVAL_CP) return false

  const movedValue = PIECE_VALUES[played.piece] || 0
  if (movedValue < BRILLIANT_MIN_SAC_VALUE) return false

  const game = new Chess(fen)
  game.move(played.san)
  // It's the opponent's turn now: can they capture our moved piece?
  const replies = game.moves({ verbose: true })
  const attackers = replies.filter(m => m.to === played.to)
  if (attackers.length === 0) return false

  const cheapestAttackerValue = Math.min(
    ...attackers.map(m => PIECE_VALUES[m.piece] || Infinity)
  )
  // Sacrifice = attacker is worth less than what we just put on that square.
  return cheapestAttackerValue < movedValue
}

/**
 * Great-move heuristic: the played move is the engine's best and the
 * NEXT-best alternative is dramatically worse — i.e. the player had to find
 * "the only move". We compute this by re-searching the position with each
 * alternative move played, taking the best of those, and comparing.
 *
 * To keep review time reasonable this only runs for promising candidates
 * (already known to be the best move).
 */
function isGreatMove(fen, played, bestScoreCp) {
  const game = new Chess(fen)
  const moves = game.moves({ verbose: true })
  if (moves.length <= 1) return false // only one legal move isn't "great", just forced

  // Score each alternative at shallow depth (one ply less than review depth).
  const altDepth = Math.max(2, REVIEW_DEPTH - 1)
  let bestAlt = -Infinity
  for (const alt of moves) {
    if (alt.san === played.san) continue
    game.move(alt)
    // Search from opponent's view, negate to get our view.
    const r = search(game.fen(), altDepth, 400)
    const ourScore = -r.score
    game.undo()
    if (ourScore > bestAlt) bestAlt = ourScore
    // Early exit: if any alternative is already close, it's not "great".
    if (bestScoreCp - bestAlt < GREAT_GAP_CP) return false
  }
  return bestScoreCp - bestAlt >= GREAT_GAP_CP
}
