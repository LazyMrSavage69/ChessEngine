// Web Worker: handles engine search + opening book lookups + post-game review.
// All heavy computation runs here so the UI thread stays responsive.

import { Chess } from 'chess.js'
import { search, resetEngine } from './search.js'
import { bookMove } from '../opening/book.js'
import { reviewGame } from '../review/reviewer.js'

// Difficulty presets: { depth, timeLimitMs, randomPct }
const DIFFICULTY = {
  beginner: { depth: 1, timeLimitMs: 500,  randomPct: 0.30 },
  easy:     { depth: 2, timeLimitMs: 1000, randomPct: 0.10 },
  medium:   { depth: 4, timeLimitMs: 3000, randomPct: 0 },
  hard:     { depth: 5, timeLimitMs: 5000, randomPct: 0 },
  expert:   { depth: 6, timeLimitMs: 8000, randomPct: 0 },
}

function pickRandomMove(fen) {
  const game = new Chess(fen)
  const moves = game.moves()
  if (moves.length === 0) return null
  return moves[Math.floor(Math.random() * moves.length)]
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
