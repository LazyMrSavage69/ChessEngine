# claudeMind.md — Chess Engine WebApp

## What This Project Is
A browser-based chess game where the user plays against a custom JavaScript chess engine. The engine runs in a Web Worker. chess.js handles rules. The engine handles search and evaluation. An opening book provides instant named-line responses. A post-game review classifies every move.

---

## Architecture Mental Model

```
[User] ←→ [Board UI + Drag-and-Drop + Animations]
                  ↕
           [chess.js] ← move validation, FEN, game state
                  ↕
     ┌────────────────────────┐
     │      Web Worker        │
     │  ┌──────────────────┐  │
     │  │  Opening Book    │  │  ← lookup first (ply ≤ 16)
     │  └──────────────────┘  │
     │  ┌──────────────────┐  │
     │  │  Engine Search   │  │  ← alpha-beta + LMR + null move
     │  │  search.js       │  │
     │  │  evaluate.js     │  │
     │  │  tt.js           │  │
     │  │  killers.js      │  │
     │  │  history.js      │  │
     │  └──────────────────┘  │
     │  ┌──────────────────┐  │
     │  │  Game Reviewer   │  │  ← post-game analysis
     │  │  reviewer.js     │  │
     │  └──────────────────┘  │
     └────────────────────────┘
```

---

## Opening Book

### Rules
- Only fire for ply ≤ 16 (i.e. first 8 moves per side). After that, fall through to engine search.
- Key = first 4 FEN fields only (position + side + castling + ep). Strip halfmove + fullmove clocks.
- Transposition fix: if exact FEN key misses, strip castling rights too and retry (handles transpositions after move 10).
- Moves are weighted. Pick randomly proportional to weight, not uniformly.

### Data Format (`openings.json`)
```json
{
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3": {
    "name": "King's Pawn Opening",
    "eco": "B00",
    "moves": [
      { "san": "e5", "weight": 40 },
      { "san": "c5", "weight": 35 },
      { "san": "e6", "weight": 15 },
      { "san": "c6", "weight": 10 }
    ]
  }
}
```

### Book Lookup Logic (`book.js`)
```javascript
import openings from './openings.json'

const MAX_BOOK_PLY = 16

export function bookMove(fen, ply) {
  if (ply > MAX_BOOK_PLY) return null

  // Primary key: position + side + castling + ep
  const parts = fen.split(' ')
  const key = parts.slice(0, 4).join(' ')
  let entry = openings[key]

  // Transposition fallback: strip castling rights
  if (!entry) {
    const fallbackKey = parts.slice(0, 2).join(' ')
    entry = Object.entries(openings).find(([k]) =>
      k.split(' ').slice(0, 2).join(' ') === fallbackKey
    )?.[1]
  }

  if (!entry) return null

  // Weighted random pick
  const total = entry.moves.reduce((s, m) => s + m.weight, 0)
  let r = Math.random() * total
  for (const m of entry.moves) {
    r -= m.weight
    if (r <= 0) return { move: m.san, name: entry.name, eco: entry.eco }
  }
  return { move: entry.moves[0].san, name: entry.name, eco: entry.eco }
}
```

### Openings to Cover (minimum set, with weighted lines)
| ECO | Opening | Key Lines |
|-----|---------|-----------|
| C20 | King's Pawn | Open Game, Vienna |
| C60 | Ruy Lopez | Main line, Berlin, Marshall |
| C44 | Scotch Game | Classical, Mieses |
| D00 | Queen's Pawn | London, Colle |
| D30 | Queen's Gambit | Accepted, Declined |
| E00 | Indian Defenses | King's Indian, Nimzo, Queen's Indian |
| B12 | Caro-Kann | Classical, Advance |
| B20 | Sicilian | Najdorf (a6 weight=50), Dragon, Scheveningen |
| C00 | French Defense | Advance, Classical |
| A00 | Irregular | King's Fianchetto, Bird's |

Populate `openings.json` from PGN databases (e.g. lichess opening explorer API) filtered to positions with ≥ 1000 master games. Each move's weight = its frequency in that dataset.

---

## Engine Design

### Board Representation
- 8×8 Uint8Array (index 0–63, a1=0, h8=63)
- Piece encoding: `0=empty, 1=wP, 2=wN, 3=wB, 4=wR, 5=wQ, 6=wK, 7=bP...12=bK`

### Piece-Square Tables (PST)

Tapered eval: blend midgame and endgame PSTs based on remaining material.
```javascript
const PHASE_MATERIAL = { n: 1, b: 1, r: 2, q: 4 } // max phase = 24
function gamePhase(game) {
  let phase = 0
  game.board().flat().forEach(sq => {
    if (sq && sq.type !== 'p' && sq.type !== 'k')
      phase += PHASE_MATERIAL[sq.type] || 0
  })
  return Math.min(phase, 24) // 24 = full midgame
}
function taperedEval(mgScore, egScore, phase) {
  return Math.round((mgScore * phase + egScore * (24 - phase)) / 24)
}

// PST[piece][square 0..63] — positive = good square for white
const PST_MG = {
  p: [ 0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
       5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
       5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0 ],
  n: [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,
      -30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,
      -40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,
      -10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,
      -10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5,
      -5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,
      -10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,
       0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,
      -10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  k_mg: [-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,
         -30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,
         -20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,
          20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  k_eg: [-50,-40,-30,-20,-20,-30,-40,-50,-30,-20,-10,0,0,-10,-20,-30,
         -30,-10,20,30,30,20,-10,-30,-30,-10,30,40,40,30,-10,-30,
         -30,-10,30,40,40,30,-10,-30,-30,-10,20,30,30,20,-10,-30,
         -30,-30,0,0,0,0,-30,-30,-50,-30,-30,-30,-30,-30,-30,-50]
}
```

### Zobrist Hashing (`zobrist.js`)
```javascript
// Precompute at worker startup — deterministic seed so TT stays valid within a session
const ZOBRIST_TABLE = (() => {
  const table = {}
  const pieces = ['wP','wN','wB','wR','wQ','wK','bP','bN','bB','bR','bQ','bK']
  // Use a seeded LCG for determinism
  let seed = 0xDEADBEEF
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed }
  pieces.forEach(p => {
    table[p] = Array.from({length:64}, () => (rand() * 0x100000000 + rand()) / 1)
  })
  table.side = rand()  // XOR when it's black's turn
  table.castling = Array.from({length:16}, () => rand())
  table.ep = Array.from({length:8}, () => rand())  // ep file
  return table
})()

export function zobristHash(game) {
  let h = 0
  game.board().flat().forEach((sq, i) => {
    if (sq) h ^= ZOBRIST_TABLE[sq.color === 'w' ? 'w' : 'b' + sq.type.toUpperCase()][i]
  })
  if (game.turn() === 'b') h ^= ZOBRIST_TABLE.side
  return h
}
```

### Transposition Table (`tt.js`)
```javascript
const TT_SIZE = 1 << 20  // ~1M entries
const tt = new Array(TT_SIZE)
let currentAge = 0

export function ttGet(hash) {
  const entry = tt[hash % TT_SIZE]
  if (!entry || entry.hash !== hash) return null
  return entry
}

export function ttSet(hash, depth, score, flag, bestMove) {
  const idx = hash % TT_SIZE
  const existing = tt[idx]
  // Replace if: empty, same position, deeper search, or stale age
  if (!existing || existing.age !== currentAge || existing.depth <= depth) {
    tt[idx] = { hash, depth, score, flag, bestMove, age: currentAge }
  }
}

export function ttNewAge() { currentAge++ }  // call at start of each move
export function ttClear()  { tt.fill(undefined); currentAge = 0 }
```

### Killer Moves (`killers.js`)
```javascript
// 2 killer slots per ply, max 64 ply
const killers = Array.from({length:64}, () => [null, null])

export function storeKiller(ply, move) {
  if (move !== killers[ply][0]) {
    killers[ply][1] = killers[ply][0]
    killers[ply][0] = move
  }
}
export function getKillers(ply) { return killers[ply] }
export function clearKillers()  { killers.forEach(k => { k[0]=null; k[1]=null }) }
```

### History Heuristic (`history.js`)
```javascript
const history = {}  // key: `${piece}${to}` → score

export function updateHistory(move, depth) {
  const key = move.piece + move.to
  history[key] = (history[key] || 0) + depth * depth
}
export function getHistory(move) {
  return history[move.piece + move.to] || 0
}
export function clearHistory() { Object.keys(history).forEach(k => delete history[k]) }
```

### Move Ordering (MVV-LVA + killers + history)
```javascript
const PIECE_VALUES = { p:100, n:320, b:330, r:500, q:900, k:20000 }

function scoreMove(move, ply) {
  if (move.captured) {
    // MVV-LVA: victim value - attacker value/10
    return 10000 + PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece] / 10
  }
  const [k1, k2] = getKillers(ply)
  if (move.san === k1) return 9000
  if (move.san === k2) return 8000
  return getHistory(move)
}

function orderMoves(moves, ply) {
  return moves.map(m => ({ m, s: scoreMove(m, ply) }))
              .sort((a, b) => b.s - a.s)
              .map(x => x.m)
}
```

### Static Exchange Evaluation (SEE)
```javascript
// Returns centipawn gain/loss of a capture sequence on a square
export function see(game, move) {
  const target = PIECE_VALUES[move.captured] || 0
  game.move(move)
  const response = leastValuableAttacker(game, move.to)
  let gain = target
  if (response) {
    gain -= Math.max(0, see(game, response))
  }
  game.undo()
  return gain
}

// Use SEE to prune losing captures in quiescence
function orderCaptures(captures, game) {
  return captures
    .map(m => ({ m, s: see(game, m) }))
    .filter(x => x.s >= 0)  // prune losing captures
    .sort((a, b) => b.s - a.s)
    .map(x => x.m)
}
```

### Search (`search.js`)
```javascript
const NULL_MOVE_REDUCTION = 3
const LMR_FULL_DEPTH_MOVES = 4
const LMR_REDUCTION_LIMIT = 3

function alphaBeta(game, depth, alpha, beta, isMax, ply, nullMoveAllowed) {
  const hash = zobristHash(game)
  const cached = ttGet(hash)
  if (cached && cached.depth >= depth) {
    if (cached.flag === 'EXACT') return cached.score
    if (cached.flag === 'LOWER') alpha = Math.max(alpha, cached.score)
    if (cached.flag === 'UPPER') beta = Math.min(beta, cached.score)
    if (alpha >= beta) return cached.score
  }

  if (depth === 0) return quiescence(game, alpha, beta)

  // Null move pruning (skip if in check, endgame, or recursive null)
  const inCheck = game.in_check()
  if (nullMoveAllowed && !inCheck && depth >= 3 && gamePhase(game) > 4) {
    // Make a null move: switch side without moving
    const nullFen = makeNullMoveFen(game.fen())
    const nullGame = new Chess(nullFen)
    const nullScore = -alphaBeta(nullGame, depth - NULL_MOVE_REDUCTION - 1,
                                  -beta, -beta + 1, !isMax, ply + 1, false)
    if (nullScore >= beta) return beta  // cutoff
  }

  const moves = orderMoves(game.moves({ verbose: true }), ply)
  if (moves.length === 0) {
    if (inCheck) return isMax ? -99999 + ply : 99999 - ply
    return 0  // stalemate
  }

  let bestScore = -Infinity
  let bestMove = null
  let flag = 'UPPER'
  let movesSearched = 0

  for (const move of moves) {
    game.move(move)

    let score
    if (movesSearched === 0) {
      // Full-window search on first (best) move
      score = -alphaBeta(game, depth - 1, -beta, -alpha, !isMax, ply + 1, true)
    } else {
      // LMR: reduce depth for quiet moves late in the list
      let reduction = 0
      if (!inCheck && movesSearched >= LMR_FULL_DEPTH_MOVES &&
          depth >= LMR_REDUCTION_LIMIT && !move.captured && !move.promotion) {
        reduction = Math.floor(Math.sqrt(movesSearched) * 0.5)
      }
      // Null-window search
      score = -alphaBeta(game, depth - 1 - reduction, -alpha - 1, -alpha, !isMax, ply + 1, true)
      // Re-search at full depth if LMR failed high
      if (score > alpha && reduction > 0) {
        score = -alphaBeta(game, depth - 1, -alpha - 1, -alpha, !isMax, ply + 1, true)
      }
      // Re-search with full window if PV node
      if (score > alpha && score < beta) {
        score = -alphaBeta(game, depth - 1, -beta, -alpha, !isMax, ply + 1, true)
      }
    }

    game.undo()
    movesSearched++

    if (score > bestScore) {
      bestScore = score
      bestMove = move
      flag = 'EXACT'
    }
    alpha = Math.max(alpha, score)
    if (alpha >= beta) {
      flag = 'LOWER'
      if (!move.captured) {
        storeKiller(ply, move.san)
        updateHistory(move, depth)
      }
      break
    }
  }

  ttSet(hash, depth, bestScore, flag, bestMove)
  return bestScore
}

// Null move FEN helper: swap side to move, clear ep square
function makeNullMoveFen(fen) {
  const parts = fen.split(' ')
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-'
  return parts.join(' ')
}
```

### Iterative Deepening with Aspiration Windows
```javascript
const ASPIRATION_WINDOW = 50  // centipawns

function search(fen, maxDepth, timeLimitMs = 3000) {
  const game = new Chess(fen)
  ttNewAge()
  clearKillers()
  clearHistory()

  let bestMove = null
  let prevScore = 0
  const startTime = performance.now()

  for (let depth = 1; depth <= maxDepth; depth++) {
    // Time check: abort if we've used > 80% of budget
    if (depth > 2 && performance.now() - startTime > timeLimitMs * 0.8) break

    let alpha, beta
    if (depth >= 4) {
      alpha = prevScore - ASPIRATION_WINDOW
      beta  = prevScore + ASPIRATION_WINDOW
    } else {
      alpha = -Infinity
      beta  =  Infinity
    }

    let result
    while (true) {
      result = searchRoot(game, depth, alpha, beta, startTime, timeLimitMs)
      if (result.score <= alpha) {
        alpha -= ASPIRATION_WINDOW * 2   // widen on fail-low
      } else if (result.score >= beta) {
        beta  += ASPIRATION_WINDOW * 2   // widen on fail-high
      } else {
        break  // within window
      }
    }

    prevScore = result.score
    bestMove = result.move
    self.postMessage({ type: 'info', depth, score: result.score, move: bestMove })
  }
  return bestMove
}
```

### Quiescence Search
```javascript
function quiescence(game, alpha, beta) {
  const standPat = evaluate(game)
  if (standPat >= beta) return beta
  alpha = Math.max(alpha, standPat)

  const captures = game.moves({ verbose: true }).filter(m => m.captured)
  for (const move of orderCaptures(captures, game)) {
    game.move(move)
    const score = -quiescence(game, -beta, -alpha)
    game.undo()
    if (score >= beta) return beta
    alpha = Math.max(alpha, score)
  }
  return alpha
}
```

### Evaluation (`evaluate.js`)
```javascript
const PIECE_VALUES = { p:100, n:320, b:330, r:500, q:900, k:20000 }

function evaluate(game) {
  if (game.in_checkmate()) return game.turn() === 'w' ? -99999 : 99999
  if (game.in_draw())      return 0

  const board = game.board()
  const phase = gamePhase(game)
  let mgScore = 0, egScore = 0

  let whiteBishops = 0, blackBishops = 0

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (!sq) continue
      const isWhite = sq.color === 'w'
      const sign = isWhite ? 1 : -1
      const idx = isWhite ? r * 8 + c : (7 - r) * 8 + c

      const base = PIECE_VALUES[sq.type]
      const mgPST = sq.type === 'k'
        ? PST_MG.k_mg[idx]
        : (PST_MG[sq.type]?.[idx] || 0)
      const egPST = sq.type === 'k'
        ? PST_MG.k_eg[idx]
        : (PST_MG[sq.type]?.[idx] || 0)

      mgScore += sign * (base + mgPST)
      egScore += sign * (base + egPST)

      if (sq.type === 'b') isWhite ? whiteBishops++ : blackBishops++
    }
  }

  // Bishop pair bonus
  if (whiteBishops >= 2) { mgScore += 30; egScore += 50 }
  if (blackBishops >= 2) { mgScore -= 30; egScore -= 50 }

  // Pawn structure
  const pawnScore = evalPawns(board)
  mgScore += pawnScore
  egScore += pawnScore * 1.5  // pawn structure matters more in endgame

  // King safety (only meaningful in midgame)
  mgScore += evalKingSafety(board, game) * (phase / 24)

  // Mobility bonus (count legal moves)
  const mobility = game.moves().length
  mgScore += mobility * 3

  return taperedEval(mgScore, egScore, phase)
}

function evalPawns(board) {
  let score = 0
  const files = { w: Array(8).fill(0), b: Array(8).fill(0) }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (sq?.type === 'p') {
        const side = sq.color
        files[side][c]++
      }
    }
  }

  for (let c = 0; c < 8; c++) {
    // Doubled pawns
    if (files.w[c] > 1) score -= 20 * (files.w[c] - 1)
    if (files.b[c] > 1) score += 20 * (files.b[c] - 1)
    // Isolated pawns
    const wIsolated = files.w[c] > 0 &&
      (c === 0 || files.w[c-1] === 0) && (c === 7 || files.w[c+1] === 0)
    const bIsolated = files.b[c] > 0 &&
      (c === 0 || files.b[c-1] === 0) && (c === 7 || files.b[c+1] === 0)
    if (wIsolated) score -= 15
    if (bIsolated) score += 15
  }
  return score
}

function evalKingSafety(board, game) {
  let score = 0
  // Find kings
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (sq?.type !== 'k') continue
      const sign = sq.color === 'w' ? 1 : -1
      const pawnRank = sq.color === 'w' ? r - 1 : r + 1
      // Count pawn shield (pawns directly in front of king)
      let shield = 0
      for (let dc = -1; dc <= 1; dc++) {
        const fc = c + dc
        if (fc < 0 || fc > 7) continue
        if (pawnRank >= 0 && pawnRank < 8 && board[pawnRank][fc]?.type === 'p'
            && board[pawnRank][fc].color === sq.color) shield++
      }
      score += sign * shield * 10
    }
  }
  return score
}
```

---

## Post-Game Review

### How It Works
1. After game ends, send full `gameHistory[]` (array of `{ fen, move, player }`) to Web Worker.
2. Worker runs `alphaBeta` at depth 5 on every position — both the actual move and the best move — so deltas are computed at equal search depth.
3. Classify each move and compute accuracy.
4. Return annotations + best-move arrows for blunders.

### reviewer.js
```javascript
export async function reviewGame(history) {
  const annotations = []

  for (let i = 0; i < history.length; i++) {
    const { fen, move, player } = history[i]
    const REVIEW_DEPTH = 4  // depth 4 sufficient; depth 5 is too slow for 40+ moves

    // Score after the move actually played
    const gameActual = new Chess(fen)
    gameActual.move(move)
    const actualScore = alphaBeta(gameActual, REVIEW_DEPTH - 1,
                                   -Infinity, Infinity, player !== 'w', 1, true)

    // Best move + score from this position
    const { move: bestMove, score: bestScore } = searchRoot(new Chess(fen), REVIEW_DEPTH)

    // Delta: centipawns lost relative to player's color
    const sign = player === 'w' ? 1 : -1
    const delta = sign * (bestScore - actualScore)

    const classification = classify(Math.max(0, delta), move === bestMove)
    const arrow = delta > 100 ? { from: move.from, to: move.to,
                                   bestFrom: bestMove.from, bestTo: bestMove.to } : null

    annotations.push({ move, bestMove, delta, classification, fen, arrow })
    self.postMessage({ type: 'review_progress', index: i, total: history.length })
  }

  return annotations
}
```

### classify.js
```javascript
export function classify(delta, isBest) {
  if (isBest || delta <= 0)  return { label: 'Best',       icon: '✅', color: '#4caf50' }
  if (delta <= 30)           return { label: 'Good',       icon: '👍', color: '#8bc34a' }
  if (delta <= 100)          return { label: 'Inaccuracy', icon: '⚠️', color: '#ff9800' }
  if (delta <= 300)          return { label: 'Mistake',    icon: '❌', color: '#f44336' }
  return                            { label: 'Blunder',    icon: '💀', color: '#9c27b0' }
}

export function accuracy(annotations) {
  if (!annotations.length) return 100
  const cpLosses = annotations.map(a => Math.max(0, a.delta))
  const avg = cpLosses.reduce((s, v) => s + v, 0) / cpLosses.length
  return Math.round(100 * Math.exp(-0.00375 * avg))
}
```

### Review Panel UI
```
┌─────────────────────────────────────────────┐
│  GAME REVIEW                                │
│  Opening: Sicilian Defense, Najdorf (B96)   │
│  White Accuracy: 74%   Black Accuracy: 61%  │
├─────────────────────────────────────────────┤
│  Move  White            Black               │
│  1.    e4 ✅            c5 ✅               │
│  2.    Nf3 ✅           d6 👍               │
│  ...                                        │
│  12.   Bxf6?? ❌ -230cp  ...               │
│        Best: Qd2  [arrow overlay on board]  │
├─────────────────────────────────────────────┤
│  Summary                                    │
│  ✅ Best: 8  👍 Good: 3  ⚠️ Inaccuracy: 2  │
│  ❌ Mistake: 1   💀 Blunder: 1             │
└─────────────────────────────────────────────┘
```

Blunder arrows: draw SVG arrow (red) from actual move's destination; draw green arrow for best move. Overlay on board when user clicks the move in the review panel.

---

## Difficulty Levels
| Level | Depth | Book? | Random% | Approx ELO |
|-------|-------|-------|---------|------------|
| Beginner | 1 | No  | 30% random legal move | ~600 |
| Easy     | 2 | Yes | 10%                   | ~900 |
| Medium   | 4 | Yes | 0%                    | ~1400 |
| Hard     | 5 | Yes | 0%                    | ~1800 |
| Expert   | 6 | Yes | 0%                    | ~2100+ |

At Beginner/Easy levels, inject randomness so the engine occasionally ignores hanging pieces — otherwise even depth-1 never blunders material.

```javascript
function maybeRandomMove(game, difficulty) {
  const thresholds = { beginner: 0.30, easy: 0.10 }
  if (Math.random() < (thresholds[difficulty] || 0)) {
    const moves = game.moves()
    return moves[Math.floor(Math.random() * moves.length)]
  }
  return null
}
```

---

## Web Worker Message Protocol

```javascript
// Main → Worker
{ type: 'search',  fen, depth, timeLimitMs, difficulty }
{ type: 'review',  history }
{ type: 'cancel' }

// Worker → Main
{ type: 'bestmove',        move }
{ type: 'book_move',       move, name, eco }
{ type: 'info',            depth, score, nodes, move }
{ type: 'review_done',     annotations }
{ type: 'review_progress', index, total }
{ type: 'error',           message }   // ← NEW
```

Worker must wrap all logic in `try/catch` and post `{ type: 'error' }` on failure. Main thread must handle `'error'` type and show a user-visible message.

---

## Board UI

### Drag-and-Drop
```javascript
let draggedPiece = null, fromSquare = null

pieceEl.addEventListener('mousedown', e => {
  draggedPiece = pieceEl
  fromSquare = squareEl
  pieceEl.style.position = 'absolute'
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', onDrop)
})

function onDrop(e) {
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.square')
  if (target && target !== fromSquare) {
    const move = game.move({ from: fromSquare.dataset.sq, to: target.dataset.sq,
                              promotion: 'q' })  // auto-queen; show UI for real choice
    if (move) handlePlayerMove(move)
  }
  cancelDrag()
}
```

### Promotion UI
When `move.flags.includes('p')`, show a modal with 4 piece choices (Q, R, B, N) before committing the move. Do not auto-promote without asking.

### Animation (FLIP)
```javascript
function animateMove(piece, fromSquare, toSquare) {
  const from = fromSquare.getBoundingClientRect()
  piece.style.transition = 'none'
  toSquare.appendChild(piece)
  const to = piece.getBoundingClientRect()
  const dx = from.left - to.left
  const dy = from.top - to.top
  piece.style.transform = `translate(${dx}px, ${dy}px)`
  requestAnimationFrame(() => {
    piece.style.transition = 'transform 0.25s ease'
    piece.style.transform = ''
  })
}
```

---

## Opening UI Behavior
- Engine plays book move → show toast: `"Sicilian Defense — Najdorf Variation (B96)"`
- Player plays known book move → also show opening name
- Out of book (ply > 16 or no entry) → banner disappears
- Track opening name in state; keep visible in game header until out of book

---

## Performance Notes
- Opening book lookup: O(1) per FEN key
- Search depth 4: ~50k–200k nodes, ~0.5–2s in JS
- Review (40 moves × depth 4): ~20–80s — run in Worker, show progress bar
- Zobrist tables precomputed once at worker startup
- TT size: 1M entries (~32MB) — sufficient for depth ≤ 6
- Use `performance.now()` inside `searchRoot` to enforce `timeLimitMs` per move

---

## Common Bugs to Avoid

| Bug | Fix |
|-----|-----|
| King in check after move | chess.js filters pseudo-legal moves automatically |
| En passant missing | FEN ep field handled by chess.js |
| Castling through check | chess.js validates; respect FEN castling rights in TT |
| Promotion not triggered | Check `move.flags.includes('p')`; show choice UI |
| Engine blocks UI | Always use Web Worker for search AND review |
| Review delta wrong | Run alphaBeta at equal depth for both actual and best move |
| Review NaN accuracy | Guard `if (!annotations.length) return 100` |
| Book key mismatch | Strip halfmove + fullmove; retry without castling rights |
| Aspiration fail-loop | Widen window by 2× on each fail; add hard Infinity fallback |
| Null move in check | Skip null move pruning when `game.in_check()` |
| TT stale entries | Increment `currentAge` at each root call; skip old entries |
| Drag ghost piece | Set `draggable=false` on board img elements |