// Main application orchestrator.
// Manages auth gate, game state, worker communication, UI controls, review,
// snapshot-based undo/redo, and game saving.
//
// chess.js v1.x is ESM-only (no global UMD bundle), so we import it from
// jsdelivr's auto-converting `+esm` endpoint. Same import is used by the
// Worker thread — the module is fetched once and cached by the browser.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm'

import { createBoard } from '/board.js'
import { renderMaterial } from '/ui/material.js'
import { createEvalBar } from '/ui/evalBar.js'
import { renderReviewPanel, renderReviewProgress, renderMyGamesTab } from '/ui/reviewPanel.js'
import { initAuth } from '/auth/auth.js'
import { saveGame } from '/games/saveGame.js'
import { annotationToClassification } from '/review/classify.js'
import { supabase } from '/supabaseClient.js'

// ─── State ───────────────────────────────────────────────────────
let game = new Chess()
let board = null
let evalBar = null
let worker = null
let playerColor = 'w'        // 'w' or 'b'
let difficulty = 'medium'
let ply = 0                   // half-move count
let gameHistory = []          // { fen, san, player } — fen is BEFORE the move
let moveListMoves = []        // { num, white, black } for display
let isGameOver = false
let isThinking = false
let currentOpeningName = null
let currentEco = null
let reviewAnnotations = null

// ─── Chess clock (10+0) ────────────────────────────────────────
const START_TIME_MS = 10 * 60 * 1000
let whiteTimeMs = START_TIME_MS
let blackTimeMs = START_TIME_MS
let clockTimer = null
let lastTick = null
let clockRunning = false
let noTimeLimit = false

// Snapshot-based undo/redo state. snapshots[currentIndex] is the LIVE FEN.
// Every completed half-move (player or engine) appends a new snapshot.
let snapshots = []
let currentIndex = -1
// True while we're "browsing the past" — live moves are blocked until either
// the user clicks New Game, redoes back to head, or makes a move (which
// truncates redo history).
let isBrowsingHistory = false

// ─── Threefold repetition detection ──────────────────────────────
// chess.js's isThreefoldRepetition() needs all moves to be applied to a SINGLE
// Chess instance via .move() to populate its internal history. We re-create
// `game` from FEN after every player move (board.js owns the move) AND on
// undo/redo restore — both of which wipe that internal history. So we run
// our own snapshot-based counter, keyed by the position component of the FEN.

/**
 * Strip the halfmove + fullmove counters from a FEN. Two positions that
 * differ ONLY in those counters are considered the same for repetition.
 */
function repetitionKey(fen) {
  // FEN: "<position> <stm> <castling> <ep> <halfmove> <fullmove>"
  return fen.split(' ').slice(0, 4).join(' ')
}

/** How many times the position at snapshots[idx] has occurred up to that index. */
function repetitionCountAt(idx) {
  if (idx < 0 || idx >= snapshots.length) return 0
  const key = repetitionKey(snapshots[idx])
  let count = 0
  for (let i = 0; i <= idx; i++) {
    if (repetitionKey(snapshots[i]) === key) count++
  }
  return count
}

/** True iff the live position has been reached at least 3 times in this game. */
function isThreefoldRepetitionNow() {
  return repetitionCountAt(currentIndex) >= 3
}

// ─── DOM refs ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)

// ─── Init (after auth) ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Hide both panels until auth resolves to avoid a flash of unauthenticated content.
  $('login-screen').classList.add('hidden')
  $('app-screen').classList.add('hidden')

  const session = await initAuth()
  if (!session) return // login screen is now visible; bootstrapping happens after login

  bootstrapApp()
})

// Re-bootstrap once login completes (auth.js dispatches this event).
window.addEventListener('auth:ready', () => {
  bootstrapApp()
})

let bootstrapped = false
function bootstrapApp() {
  if (bootstrapped) return
  bootstrapped = true
  initWorker()
  initBoard()
  initEvalBar()
  initClock()
  initControls()
  initTabs()
  updateUI()

  // Save the starting position as snapshot[0] BEFORE any move is made.
  saveSnapshot(game.fen())

  // If player is black, engine moves first
  if (playerColor === 'b') {
    requestEngineMove()
  }
}

function initEvalBar() {
  const el = $('eval-bar')
  if (!el) return
  evalBar = createEvalBar(el)
  evalBar.setMaterialOnly(game)
}

function initClock() {
  updateClockUI()
  if (clockTimer) clearInterval(clockTimer)
  lastTick = performance.now()
  clockTimer = setInterval(tickClock, 200)
}

function tickClock() {
  if (!clockRunning) {
    lastTick = performance.now()
    return
  }
  if (noTimeLimit) {
    lastTick = performance.now()
    return
  }
  if (isGameOver || isBrowsingHistory) {
    lastTick = performance.now()
    return
  }
  if (!game) return

  const now = performance.now()
  const elapsed = Math.max(0, now - (lastTick || now))
  lastTick = now

  const side = game.turn()
  if (side === 'w') {
    whiteTimeMs = Math.max(0, whiteTimeMs - elapsed)
    if (whiteTimeMs === 0) return handleTimeout('b')
  } else {
    blackTimeMs = Math.max(0, blackTimeMs - elapsed)
    if (blackTimeMs === 0) return handleTimeout('w')
  }

  updateClockUI()
}

function handleTimeout(winnerColor) {
  if (isGameOver) return
  isGameOver = true
  clockRunning = false
  setThinking(false)
  if (board) board.setInteractive(false)
  const statusEl = $('game-status')
  const winner = winnerColor === 'w' ? 'White' : 'Black'
  statusEl.textContent = `Time — ${winner} wins!`
  statusEl.className = 'game-status active checkmate'
  updateClockUI()
}

function formatClock(ms) {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function updateClockUI() {
  const top = $('clock-top')
  const bottom = $('clock-bottom')
  if (!top || !bottom) return

  const isFlipped = board?.isFlipped()
  const topColor = isFlipped ? 'w' : 'b'
  const bottomColor = isFlipped ? 'b' : 'w'

  const topMs = topColor === 'w' ? whiteTimeMs : blackTimeMs
  const bottomMs = bottomColor === 'w' ? whiteTimeMs : blackTimeMs

  top.textContent = noTimeLimit ? '∞' : formatClock(topMs)
  bottom.textContent = noTimeLimit ? '∞' : formatClock(bottomMs)

  top.classList.toggle('low-time', !noTimeLimit && topMs <= 30_000)
  bottom.classList.toggle('low-time', !noTimeLimit && bottomMs <= 30_000)
}

// ─── Worker ──────────────────────────────────────────────────────
function initWorker() {
  // Root-relative URL so the worker resolves correctly under both
  // http-server and Vercel (which serves /dist as the root).
  worker = new Worker(
    new URL('/engine/worker.js', import.meta.url),
    { type: 'module' }
  )

  worker.onmessage = (e) => {
    const msg = e.data

    switch (msg.type) {
      case 'bestmove':
        handleEngineMove(msg)
        break

      case 'info':
        updateEngineInfo(msg)
        break

      case 'review_progress':
        renderReviewProgress($('review-container'), msg.index, msg.total)
        break

      case 'review_done':
        reviewAnnotations = msg.annotations
        showReview(msg.annotations)
        break

      case 'classified':
        handleClassified(msg)
        break

      case 'error':
        console.error('Worker error:', msg.message)
        setThinking(false)
        break
    }
  }

  worker.onerror = (err) => {
    console.error('Worker fatal error:', err)
    setThinking(false)
  }
}

// ─── Board ───────────────────────────────────────────────────────
function initBoard() {
  const container = $('board-container')
  board = createBoard(container, {
    onMove: handlePlayerMove,
  })
  board.setPosition(game.fen())
}

function handlePlayerMove(move, fen) {
  // Live moves are blocked while browsing snapshot history. The board guards
  // against this too (it disables interaction during thinking) but defense in
  // depth keeps state consistent.
  if (isBrowsingHistory) return

  if (!clockRunning && ply === 0) {
    clockRunning = true
    lastTick = performance.now()
  }

  // Record history
  const beforeFen = snapshots[currentIndex] // current head before this move
  gameHistory.push({
    fen: beforeFen,
    san: move.san,
    player: move.color,
  })
  ply++
  saveSnapshot(fen)

  addMoveToList(move)
  game = new Chess(fen)
  updateUI()

  // Dispatch live classification to the worker so the move list can show
  // the !!/!/?/?? badge once the engine finishes thinking.
  dispatchClassify(beforeFen, fen, move)

  if (checkGameOver()) {
    persistGameIfFinished()
    return
  }

  // Engine's turn
  requestEngineMove()
}

function handleEngineMove(msg) {
  setThinking(false)

  if (!msg.move) return

  // Update opening info
  if (msg.bookMove && msg.openingName) {
    currentOpeningName = msg.openingName
    currentEco = msg.eco
    showOpeningToast(msg.openingName, msg.eco)
  }

  // Capture whose turn it was BEFORE applying the move so we can convert the
  // engine's side-to-move score into a White-perspective eval for the bar.
  const engineSide = game.turn()
  if (evalBar) {
    if (msg.score !== undefined) {
      evalBar.setEngineScore(msg.score, engineSide)
    } else if (msg.bookMove) {
      // Book moves have no engine score — show material balance as a baseline.
      evalBar.setMaterialOnly(game)
    }
  }

  // Play the move on the board
  const beforeFen = game.fen()
  const move = game.move(msg.move)
  if (!move) {
    console.error('Engine returned invalid move:', msg.move)
    return
  }

  if (!clockRunning && ply === 0) {
    clockRunning = true
    lastTick = performance.now()
  }

  gameHistory.push({
    fen: beforeFen,
    san: move.san,
    player: move.color,
  })
  ply++
  saveSnapshot(game.fen())

  // Animate the move on the board
  board.animateMoveTo(game.fen(), move.from, move.to)

  addMoveToList(move)

  // Update engine info with final result
  if (msg.score !== undefined) {
    updateEngineInfo({
      depth: msg.depth,
      score: msg.score,
      nodes: msg.nodes,
      move: msg.move,
      timeMs: msg.timeMs,
      bookMove: msg.bookMove,
    })
  }

  updateUI()
  if (checkGameOver()) {
    persistGameIfFinished()
  }
}

function requestEngineMove() {
  if (isGameOver || isBrowsingHistory) return
  setThinking(true)

  worker.postMessage({
    type: 'search',
    fen: game.fen(),
    ply,
    difficulty,
  })
}

// ─── Live classification dispatch ────────────────────────────────
/**
 * Ask the worker to classify a played move. Result arrives via the
 * 'classified' message and is rendered as a badge next to the move SAN.
 */
function dispatchClassify(fenBefore, fenAfter, move) {
  worker.postMessage({
    type: 'classify',
    fenBefore,
    fenAfter,
    moveSan: move.san,
    playedMove: { from: move.from, to: move.to, promotion: move.promotion || null },
  })
}

function handleClassified(msg) {
  // Find the matching SAN in the move list (last occurrence — classification
  // arrives in dispatch order, so the most recent unbadged one with this SAN
  // is the right target).
  const cells = $('move-list').querySelectorAll(`.move-san[data-san="${cssEscape(msg.moveSan)}"]`)
  const target = Array.from(cells).reverse().find(c => !c.dataset.classified)
  if (!target) return

  target.dataset.classified = '1'
  if (!msg.annotation) return // standard move — no badge needed

  const cls = annotationToClassification(msg.annotation)
  const badge = document.createElement('span')
  badge.className = `cls-badge cls-${cls.cls} cls-inline`
  badge.textContent = cls.short
  badge.title = `${cls.label} — cp loss: ${msg.cploss ?? '?'}`
  target.appendChild(badge)
}

function cssEscape(s) {
  // Minimal CSS attribute-selector escape — SAN tokens contain only safe chars
  // (letters/digits/+#=/-) but we still escape quotes defensively.
  return String(s).replace(/"/g, '\\"')
}

// ─── Snapshot Undo / Redo ────────────────────────────────────────
/**
 * Append a FEN snapshot. Always discards any "future" (redo) history so the
 * timeline is linear: making a new move from a rewound state forks off a new
 * line and abandons the old one.
 */
function saveSnapshot(fen) {
  // Discard everything beyond the current head.
  snapshots.splice(currentIndex + 1)
  snapshots.push(fen)
  currentIndex = snapshots.length - 1
  isBrowsingHistory = false
  lastTick = performance.now()
  updateUndoRedoButtons()
}

function undo() {
  if (currentIndex <= 0) return
  currentIndex--
  restoreFEN(snapshots[currentIndex])
  // We are now potentially BEFORE the latest move → we're browsing.
  isBrowsingHistory = currentIndex < snapshots.length - 1
  lastTick = performance.now()
  updateUndoRedoButtons()
  // IMPORTANT: do NOT trigger an engine move after undo — player decides.
}

function redo() {
  if (currentIndex >= snapshots.length - 1) return
  currentIndex++
  restoreFEN(snapshots[currentIndex])
  isBrowsingHistory = currentIndex < snapshots.length - 1
  lastTick = performance.now()
  updateUndoRedoButtons()
}

/**
 * Hard-reset every game-state slice from the FEN. Board state, side to move,
 * castling rights, en-passant square, halfmove clock, fullmove number.
 */
function restoreFEN(fen) {
  game = new Chess()
  game.load(fen)
  board.restoreFEN(fen)
  if (evalBar) evalBar.setMaterialOnly(game)
  // Re-sync `ply` from the FEN so move numbering stays consistent if the user
  // makes a new move from this point. Fullmove starts at 1; ply = (fullmove-1)*2 + (turn=='b' ? 1 : 0).
  const parts = fen.split(' ')
  const fullmove = parseInt(parts[5] || '1', 10)
  const sideToMove = parts[1]
  ply = Math.max(0, (fullmove - 1) * 2 + (sideToMove === 'b' ? 1 : 0))

  // Recompute the visible state (game-over/check banner, move list highlight).
  updateUI()
  highlightMoveListForIndex(currentIndex - 1) // -1 because index 0 = before move 0
  // Game-over flag must be re-derived from the restored position — undoing
  // away from checkmate (or threefold) should re-enable the board.
  isGameOver = game.isCheckmate()
    || game.isStalemate()
    || game.isDraw()
    || isThreefoldRepetitionNow()
  if (board) board.setInteractive(!isGameOver && !isThinking && !isBrowsingHistory)
}

function updateUndoRedoButtons() {
  const undoBtn = $('btn-undo')
  const redoBtn = $('btn-redo')
  if (undoBtn) undoBtn.disabled = currentIndex <= 0
  if (redoBtn) redoBtn.disabled = currentIndex >= snapshots.length - 1
}

// ─── Controls ────────────────────────────────────────────────────
function initControls() {
  $('btn-new-game').addEventListener('click', newGame)
  $('btn-flip').addEventListener('click', flipBoard)
  $('btn-undo').addEventListener('click', undo)
  $('btn-redo').addEventListener('click', redo)
  $('btn-review').addEventListener('click', startReview)

  $('select-difficulty').addEventListener('change', (e) => {
    difficulty = e.target.value
  })

  $('select-side').addEventListener('change', (e) => {
    playerColor = e.target.value
    newGame()
  })

  const noTimerToggle = $('toggle-no-timer')
  if (noTimerToggle) {
    noTimerToggle.addEventListener('change', (e) => {
      noTimeLimit = !!e.target.checked
      updateClockUI()
    })
  }
}

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn')
  const panels  = document.querySelectorAll('.tab-panel')
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'))
      panels.forEach(p => p.classList.remove('active'))
      btn.classList.add('active')
      const id = btn.dataset.tab
      const panel = document.getElementById(id)
      if (panel) panel.classList.add('active')

      // Lazy-load games tab content on first activation.
      if (id === 'games-tab') {
        renderMyGamesTab($('games-container'), supabase, (fen) => {
          // Replay viewer: restore the board to the chosen FEN.
          board.restoreFEN(fen)
          if (evalBar) evalBar.setMaterialOnly(new Chess(fen))
        })
      }
    })
  })
}

function newGame() {
  game = new Chess()
  ply = 0
  gameHistory = []
  moveListMoves = []
  isGameOver = false
  isThinking = false
  currentOpeningName = null
  currentEco = null
  reviewAnnotations = null
  snapshots = []
  currentIndex = -1
  isBrowsingHistory = false
  whiteTimeMs = START_TIME_MS
  blackTimeMs = START_TIME_MS
  lastTick = performance.now()
  clockRunning = false
  // Reset the per-game persistence guard so the next finished game gets saved.
  saveAttempted = false

  worker.postMessage({ type: 'reset' })

  board.setPosition(game.fen())
  board.setInteractive(true)
  board.clearArrows()

  updateClockUI()

  if (evalBar) evalBar.reset()

  // Clear UI
  $('move-list').innerHTML = ''
  $('game-status').className = 'game-status'
  $('game-status').textContent = ''
  $('review-container').innerHTML = ''
  $('opening-name').textContent = ''
  $('opening-eco').textContent = ''
  resetEngineInfo()

  // Save starting position as the first snapshot.
  saveSnapshot(game.fen())
  updateUI()

  // If playing as black, flip board and let engine move first
  if (playerColor === 'b') {
    if (!board.isFlipped()) board.flip()
    requestEngineMove()
  } else {
    if (board.isFlipped()) board.flip()
  }
  if (evalBar) evalBar.setFlipped(board.isFlipped())
}

function flipBoard() {
  board.flip()
  if (evalBar) evalBar.setFlipped(board.isFlipped())
}

// ─── Move List ───────────────────────────────────────────────────
function addMoveToList(move) {
  const listEl = $('move-list')

  if (move.color === 'w') {
    // New move pair
    const moveNum = Math.ceil(ply / 2)
    const row = document.createElement('div')
    row.className = 'move-row'
    row.dataset.moveNum = moveNum

    const numEl = document.createElement('span')
    numEl.className = 'move-number'
    numEl.textContent = `${moveNum}.`

    const whiteEl = document.createElement('span')
    whiteEl.className = 'move-san'
    whiteEl.textContent = move.san
    whiteEl.dataset.histIdx = gameHistory.length - 1
    whiteEl.dataset.san = move.san
    whiteEl.addEventListener('click', () => navigateToMove(parseInt(whiteEl.dataset.histIdx)))

    row.appendChild(numEl)
    row.appendChild(whiteEl)
    listEl.appendChild(row)
  } else {
    // Add black's move to the last row
    const lastRow = listEl.querySelector('.move-row:last-child')
    if (lastRow) {
      const blackEl = document.createElement('span')
      blackEl.className = 'move-san'
      blackEl.textContent = move.san
      blackEl.dataset.histIdx = gameHistory.length - 1
      blackEl.dataset.san = move.san
      blackEl.addEventListener('click', () => navigateToMove(parseInt(blackEl.dataset.histIdx)))
      lastRow.appendChild(blackEl)
    }
  }

  // Auto-scroll
  listEl.scrollTop = listEl.scrollHeight
}

function highlightMoveListForIndex(histIdx) {
  $('move-list').querySelectorAll('.move-san').forEach(el => el.classList.remove('active'))
  if (histIdx < 0) return
  const activeEl = $('move-list').querySelector(`.move-san[data-hist-idx="${histIdx}"]`)
  if (activeEl) activeEl.classList.add('active')
}

function navigateToMove(histIdx) {
  if (histIdx < 0 || histIdx >= gameHistory.length) return
  // snapshot index = histIdx + 1 (snapshot[0] is the start position).
  currentIndex = histIdx + 1
  restoreFEN(snapshots[currentIndex])
  isBrowsingHistory = currentIndex < snapshots.length - 1
  updateUndoRedoButtons()
  board.clearArrows()
}

// ─── Game Over ───────────────────────────────────────────────────
// Order matters: a position can satisfy several "isXxx" checks at once
// (e.g. threefold AND 50-move). We check most-specific → least-specific so
// the user sees a meaningful banner.
function checkGameOver() {
  const statusEl = $('game-status')

  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'Black' : 'White'
    statusEl.textContent = `Checkmate — ${winner} wins!`
    statusEl.className = 'game-status active checkmate'
    isGameOver = true
    board.setInteractive(false)
    updateClockUI()
    return true
  }

  if (game.isStalemate()) {
    statusEl.textContent = 'Stalemate — Draw (égalité)'
    statusEl.className = 'game-status active draw'
    isGameOver = true
    board.setInteractive(false)
    updateClockUI()
    return true
  }

  // Threefold: prefer our snapshot-based counter (chess.js's may have lost
  // its internal history due to FEN reloads), but accept either.
  if (isThreefoldRepetitionNow() || game.isThreefoldRepetition()) {
    statusEl.textContent = 'Draw — Threefold Repetition (égalité)'
    statusEl.className = 'game-status active draw'
    isGameOver = true
    board.setInteractive(false)
    updateClockUI()
    return true
  }

  if (game.isInsufficientMaterial()) {
    statusEl.textContent = 'Draw — Insufficient Material (égalité)'
    statusEl.className = 'game-status active draw'
    isGameOver = true
    board.setInteractive(false)
    updateClockUI()
    return true
  }

  // Whatever's left under chess.js's catch-all isDraw() is the 50-move rule
  // (since checkmate/stalemate/insufficient/threefold are already handled).
  if (game.isDraw()) {
    statusEl.textContent = 'Draw — 50-Move Rule (égalité)'
    statusEl.className = 'game-status active draw'
    isGameOver = true
    board.setInteractive(false)
    updateClockUI()
    return true
  }

  if (game.isCheck()) {
    statusEl.textContent = 'Check!'
    statusEl.className = 'game-status active check'
    return false
  }

  statusEl.className = 'game-status'
  statusEl.textContent = ''
  updateClockUI()
  return false
}

// ─── Persist completed game ──────────────────────────────────────
let saveAttempted = false
async function persistGameIfFinished() {
  if (!isGameOver || saveAttempted) return
  saveAttempted = true
  // Determine result string from the final position.
  // Mate: side-to-move has just been mated, so the OTHER side wins.
  // Anything else here (stalemate, threefold, insufficient material, 50-move)
  // is a draw → 1/2-1/2.
  let result
  if (game.isCheckmate()) result = game.turn() === 'w' ? '0-1' : '1-0'
  else result = '1/2-1/2'

  try {
    const saved = await saveGame(gameHistory, result)
    if (!saved?.ok) {
      showSystemToast(`Save failed: ${saved?.error || 'Unknown error'}`)
    }
  } catch (err) {
    console.error('saveGame failed:', err)
    showSystemToast(`Save failed: ${err.message || 'Unknown error'}`)
  }
}

// ─── Engine Info ─────────────────────────────────────────────────
function updateEngineInfo(info) {
  const depthEl = $('info-depth')
  const scoreEl = $('info-score')
  const nodesEl = $('info-nodes')
  const moveEl = $('info-move')

  if (info.bookMove) {
    depthEl.textContent = 'Book'
    scoreEl.textContent = '—'
    scoreEl.className = 'info-value book-move'
    nodesEl.textContent = '—'
    moveEl.textContent = info.move || '—'
    moveEl.className = 'info-value book-move'
    return
  }

  if (info.depth !== undefined) depthEl.textContent = info.depth
  if (info.nodes !== undefined) nodesEl.textContent = formatNodes(info.nodes)
  if (info.move !== undefined) {
    moveEl.textContent = typeof info.move === 'string' ? info.move : (info.move?.san || '—')
    moveEl.className = 'info-value'
  }

  if (info.score !== undefined) {
    const cp = info.score
    const display = cp >= 0 ? `+${(cp / 100).toFixed(2)}` : `${(cp / 100).toFixed(2)}`
    scoreEl.textContent = display
    scoreEl.className = `info-value ${cp > 0 ? 'score-positive' : cp < 0 ? 'score-negative' : ''}`

    // Live-update the eval bar from the side currently being searched.
    if (evalBar) {
      evalBar.setEngineScore(cp, game.turn())
    }
  }
}

function resetEngineInfo() {
  $('info-depth').textContent = '—'
  $('info-score').textContent = '—'
  $('info-score').className = 'info-value'
  $('info-nodes').textContent = '—'
  $('info-move').textContent = '—'
  $('info-move').className = 'info-value'
}

function formatNodes(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ─── Thinking indicator ──────────────────────────────────────────
function setThinking(val) {
  isThinking = val
  const indicator = $('thinking-indicator')
  indicator.classList.toggle('active', val)

  // Disable board while engine thinks or while browsing history.
  if (board) {
    board.setInteractive(!val && !isGameOver && !isBrowsingHistory)
  }
}

// ─── Opening info ────────────────────────────────────────────────
function showOpeningToast(name, eco) {
  if (!name) return

  $('opening-name').textContent = name
  $('opening-eco').textContent = eco || ''

  // Toast notification
  const container = $('toast-container')
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.innerHTML = `
    <div class="toast-title">${name}</div>
    ${eco ? `<div class="toast-sub">${eco}</div>` : ''}
  `
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 3200)
}

function showSystemToast(message) {
  const container = $('toast-container')
  if (!container) return
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.innerHTML = `<div class="toast-title">${message}</div>`
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 3200)
}

// ─── Review ──────────────────────────────────────────────────────
function startReview() {
  if (gameHistory.length === 0) return

  const container = $('review-container')
  renderReviewProgress(container, 0, gameHistory.length)

  worker.postMessage({
    type: 'review',
    history: gameHistory,
  })
}

function showReview(annotations) {
  const container = $('review-container')
  renderReviewPanel(container, annotations, currentOpeningName, currentEco, (idx, arrow) => {
    // Navigate board to position at that move index
    if (idx >= 0 && idx < gameHistory.length) {
      const fen = snapshots[idx + 1]
      board.setPosition(fen)
      // Draw review arrows (red = played move, green = best move recommendation)
      board.drawReviewArrows(arrow)
    }
  })
}

// ─── UI update ───────────────────────────────────────────────────
function updateUI() {
  // Material
  const whiteCapEl = $('white-material')
  const blackCapEl = $('black-material')
  if (whiteCapEl && blackCapEl) {
    renderMaterial(game, whiteCapEl, blackCapEl)
  }

  updateClockUI()

  // Turn indicator
  const topName = $('player-top-name')
  const bottomName = $('player-bottom-name')
  if (topName && bottomName) {
    const isFlipped = board?.isFlipped()
    const topColor = isFlipped ? 'w' : 'b'
    const bottomColor = isFlipped ? 'b' : 'w'

    topName.textContent = topColor === playerColor ? 'You' : `Engine (${difficulty})`
    bottomName.textContent = bottomColor === playerColor ? 'You' : `Engine (${difficulty})`
  }
}
