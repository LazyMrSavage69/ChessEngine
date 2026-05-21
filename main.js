// Main application orchestrator.
// Manages game state, worker communication, UI controls, and review.

import { Chess } from 'chess.js'
import { createBoard } from './board.js'
import { renderMaterial } from './ui/material.js'
import { createEvalBar } from './ui/evalBar.js'
import { renderReviewPanel, renderReviewProgress } from './ui/reviewPanel.js'

// ─── State ───────────────────────────────────────────────────────
let game = new Chess()
let board = null
let evalBar = null
let worker = null
let playerColor = 'w'        // 'w' or 'b'
let difficulty = 'medium'
let ply = 0                   // half-move count
let gameHistory = []          // { fen, moveSan, player }
let fenHistory = []           // array of FEN strings for undo / review navigation
let moveListMoves = []        // { num, white, black } for display
let isGameOver = false
let isThinking = false
let currentOpeningName = null
let currentEco = null
let reviewAnnotations = null

// ─── DOM refs ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)

// ─── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initWorker()
  initBoard()
  initEvalBar()
  initControls()
  updateUI()

  // If player is black, engine moves first
  if (playerColor === 'b') {
    requestEngineMove()
  }
})

function initEvalBar() {
  evalBar = createEvalBar($('eval-bar'))
  evalBar.setMaterialOnly(game)
}

// ─── Worker ──────────────────────────────────────────────────────
function initWorker() {
  worker = new Worker(
    new URL('./engine/worker.js', import.meta.url),
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
  fenHistory = [game.fen()]
}

function handlePlayerMove(move, fen) {
  // Record history
  gameHistory.push({
    fen: fenHistory[fenHistory.length - 1], // position BEFORE the move
    moveSan: move.san,
    player: move.color,
  })
  fenHistory.push(fen)
  ply++

  // Track opening from player's move
  // (engine will also report opening info)

  addMoveToList(move)
  game = new Chess(fen)
  updateUI()

  if (checkGameOver()) return

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

  gameHistory.push({
    fen: beforeFen,
    moveSan: move.san,
    player: move.color,
  })
  fenHistory.push(game.fen())
  ply++

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
  checkGameOver()
}

function requestEngineMove() {
  if (isGameOver) return
  setThinking(true)

  worker.postMessage({
    type: 'search',
    fen: game.fen(),
    ply,
    difficulty,
  })
}

// ─── Controls ────────────────────────────────────────────────────
function initControls() {
  $('btn-new-game').addEventListener('click', newGame)
  $('btn-flip').addEventListener('click', flipBoard)
  $('btn-undo').addEventListener('click', undoMove)
  $('btn-review').addEventListener('click', startReview)

  $('select-difficulty').addEventListener('change', (e) => {
    difficulty = e.target.value
  })

  $('select-side').addEventListener('change', (e) => {
    playerColor = e.target.value
    newGame()
  })
}

function newGame() {
  game = new Chess()
  ply = 0
  gameHistory = []
  fenHistory = [game.fen()]
  moveListMoves = []
  isGameOver = false
  isThinking = false
  currentOpeningName = null
  currentEco = null
  reviewAnnotations = null

  worker.postMessage({ type: 'reset' })

  board.setPosition(game.fen())
  board.setInteractive(true)
  board.clearArrows()

  if (evalBar) evalBar.reset()

  // Clear UI
  $('move-list').innerHTML = ''
  $('game-status').className = 'game-status'
  $('game-status').textContent = ''
  $('review-container').innerHTML = ''
  $('opening-name').textContent = ''
  $('opening-eco').textContent = ''
  resetEngineInfo()

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

function undoMove() {
  if (gameHistory.length < 2 || isThinking) return

  // Undo two half-moves (player + engine)
  gameHistory.pop()
  gameHistory.pop()
  fenHistory.pop()
  fenHistory.pop()
  ply -= 2

  const fen = fenHistory[fenHistory.length - 1]
  game = new Chess(fen)
  board.setPosition(fen)
  board.clearArrows()

  // Rebuild move list
  rebuildMoveList()
  updateUI()
  if (evalBar) evalBar.setMaterialOnly(game)

  isGameOver = false
  $('game-status').className = 'game-status'
  $('game-status').textContent = ''
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
      blackEl.addEventListener('click', () => navigateToMove(parseInt(blackEl.dataset.histIdx)))
      lastRow.appendChild(blackEl)
    }
  }

  // Auto-scroll
  listEl.scrollTop = listEl.scrollHeight
}

function rebuildMoveList() {
  const listEl = $('move-list')
  listEl.innerHTML = ''

  for (let i = 0; i < gameHistory.length; i++) {
    const h = gameHistory[i]
    const fakeMove = { san: h.moveSan, color: h.player }
    // Temporarily adjust ply for correct numbering
    const savedPly = ply
    ply = i + 1
    addMoveToList(fakeMove)
    ply = savedPly
  }
  // Fix: re-assign correct ply
  ply = gameHistory.length
}

function navigateToMove(histIdx) {
  if (histIdx < 0 || histIdx >= gameHistory.length) return
  const fen = fenHistory[histIdx + 1] // +1 because fenHistory[0] is start position
  board.setPosition(fen)
  board.clearArrows()

  // Highlight active move
  $('move-list').querySelectorAll('.move-san').forEach(el => el.classList.remove('active'))
  const activeEl = $('move-list').querySelector(`.move-san[data-hist-idx="${histIdx}"]`)
  if (activeEl) activeEl.classList.add('active')
}

// ─── Game Over ───────────────────────────────────────────────────
function checkGameOver() {
  const statusEl = $('game-status')

  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'Black' : 'White'
    statusEl.textContent = `Checkmate — ${winner} wins!`
    statusEl.className = 'game-status active checkmate'
    isGameOver = true
    board.setInteractive(false)
    return true
  }

  if (game.isStalemate()) {
    statusEl.textContent = 'Stalemate — Draw'
    statusEl.className = 'game-status active draw'
    isGameOver = true
    board.setInteractive(false)
    return true
  }

  if (game.isDraw() || game.isThreefoldRepetition() || game.isInsufficientMaterial()) {
    statusEl.textContent = 'Draw'
    statusEl.className = 'game-status active draw'
    isGameOver = true
    board.setInteractive(false)
    return true
  }

  if (game.isCheck()) {
    statusEl.textContent = 'Check!'
    statusEl.className = 'game-status active check'
    return false
  }

  statusEl.className = 'game-status'
  statusEl.textContent = ''
  return false
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

  // Disable board while engine thinks
  if (board) {
    board.setInteractive(!val && !isGameOver)
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
      const fen = fenHistory[idx + 1]
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
