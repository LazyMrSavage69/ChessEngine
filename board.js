// Board rendering: draws the 8×8 board, handles drag-and-drop,
// click-to-move, legal move highlights, animations, and promotion UI.

import { Chess } from 'chess.js'

// Cburnett SVG piece set from Wikimedia Commons
const PIECE_SVG = {
  wK: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
  wQ: 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
  wR: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
  wB: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
  wN: 'https://upload.wikimedia.org/wikipedia/commons/2/28/Chess_nlt45.svg',
  wP: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
  bK: 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg',
  bQ: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
  bR: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
  bB: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
  bN: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
  bP: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
}

// Unicode fallback
const PIECE_UNICODE = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

/**
 * Create and manage the chess board.
 */
export function createBoard(containerEl, config = {}) {
  const {
    onMove = () => {},
    onSquareClick = () => {},
  } = config

  let flipped = false
  let selectedSquare = null
  let legalMoves = []
  let lastMove = null
  let interactive = true
  let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  let dragState = null
  let currentArrows = null
  // Bumped whenever the board's authoritative state changes. An in-flight
  // animation captures the token at start; if the token has changed by the
  // time the animation finishes, the stale callback is skipped so it can't
  // overwrite a newer position (e.g. the engine's reply).
  let renderToken = 0

  // Build the board DOM
  const boardEl = document.createElement('div')
  boardEl.className = 'board'
  boardEl.id = 'chess-board'

  // Square elements indexed by algebraic notation
  const squares = {}

  function buildSquares() {
    boardEl.innerHTML = ''
    const rankOrder = flipped ? [...RANKS].reverse() : RANKS
    const fileOrder = flipped ? [...FILES].reverse() : FILES

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const rank = rankOrder[r]
        const file = fileOrder[f]
        const sq = file + rank
        const isLight = (r + f) % 2 === 0

        const squareEl = document.createElement('div')
        squareEl.className = `square ${isLight ? 'light' : 'dark'}`
        squareEl.dataset.sq = sq

        // Coordinate labels
        if (f === 0) {
          const rankLabel = document.createElement('span')
          rankLabel.className = 'coord coord-rank'
          rankLabel.textContent = rank
          squareEl.appendChild(rankLabel)
        }
        if (r === 7) {
          const fileLabel = document.createElement('span')
          fileLabel.className = 'coord coord-file'
          fileLabel.textContent = file
          squareEl.appendChild(fileLabel)
        }

        squareEl.addEventListener('mousedown', (e) => onSquareMouseDown(e, sq))
        // Touch support: preventDefault so the page doesn't scroll while dragging.
        squareEl.addEventListener('touchstart', (e) => onSquareTouchStart(e, sq), { passive: false })
        squareEl.addEventListener('click', () => handleSquareClick(sq))

        boardEl.appendChild(squareEl)
        squares[sq] = squareEl
      }
    }

    // Re-draw arrows after rebuild (board flip)
    if (currentArrows) drawReviewArrows(currentArrows)
  }

  buildSquares()
  containerEl.appendChild(boardEl)

  // ─── SVG Arrow Overlay ──────────────────────────────────────────
  const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svgOverlay.setAttribute('class', 'arrow-overlay')
  svgOverlay.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:20', 'overflow:visible',
  ].join(';')

  // Arrowhead markers
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  const makeMarker = (id, color) => {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
    marker.setAttribute('id', id)
    marker.setAttribute('markerWidth', '4')
    marker.setAttribute('markerHeight', '4')
    marker.setAttribute('refX', '2.5')
    marker.setAttribute('refY', '2')
    marker.setAttribute('orient', 'auto')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M0,0 L4,2 L0,4 Z')
    path.setAttribute('fill', color)
    marker.appendChild(path)
    return marker
  }
  defs.appendChild(makeMarker('arrow-red', 'rgba(220,38,38,0.9)'))
  defs.appendChild(makeMarker('arrow-green', 'rgba(34,197,94,0.9)'))
  svgOverlay.appendChild(defs)
  containerEl.style.position = 'relative'
  containerEl.appendChild(svgOverlay)

  /** Get the center {x,y} of a square in % units relative to the board */
  function squareCenter(sq) {
    const sqEl = squares[sq]
    if (!sqEl) return null
    const boardRect = boardEl.getBoundingClientRect()
    const sqRect = sqEl.getBoundingClientRect()
    return {
      x: ((sqRect.left - boardRect.left + sqRect.width  / 2) / boardRect.width)  * 100,
      y: ((sqRect.top  - boardRect.top  + sqRect.height / 2) / boardRect.height) * 100,
    }
  }

  /** Draw a single SVG arrow between two squares */
  function drawArrow(fromSq, toSq, color, markerId) {
    const a = squareCenter(fromSq)
    const b = squareCenter(toSq)
    if (!a || !b) return

    // Shorten the line slightly so the head doesn't overlap the centre
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy)
    const shorten = Math.min(len * 0.18, 3.5) / len
    const x2 = b.x - dx * shorten
    const y2 = b.y - dy * shorten

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', `${a.x}%`)
    line.setAttribute('y1', `${a.y}%`)
    line.setAttribute('x2', `${x2}%`)
    line.setAttribute('y2', `${y2}%`)
    line.setAttribute('stroke', color)
    line.setAttribute('stroke-width', '2.5%')
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('marker-end', `url(#${markerId})`)
    line.setAttribute('opacity', '0.85')
    svgOverlay.appendChild(line)
  }

  /** Public: draw review arrows (or clear if arrowData is null) */
  function drawReviewArrows(arrowData) {
    // Remove existing arrows (keep defs)
    svgOverlay.querySelectorAll('line').forEach(el => el.remove())
    currentArrows = arrowData
    if (!arrowData) return
    // Red = played move (the mistake/blunder)
    drawArrow(arrowData.from, arrowData.to, 'rgba(220,38,38,0.85)', 'arrow-red')
    // Green = engine's best move recommendation
    if (arrowData.bestFrom && arrowData.bestTo) {
      drawArrow(arrowData.bestFrom, arrowData.bestTo, 'rgba(34,197,94,0.85)', 'arrow-green')
    }
  }

  // Promotion overlay
  const promoOverlay = document.createElement('div')
  promoOverlay.className = 'promotion-overlay hidden'
  promoOverlay.id = 'promotion-overlay'
  containerEl.appendChild(promoOverlay)

  // ─── Piece rendering ──────────────────────────────────────────
  function renderPosition(fen) {
    currentFen = fen
    const game = new Chess(fen)
    const board = game.board()

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c]
        const file = FILES[c]
        const rank = RANKS[r]
        const sq = file + rank
        const squareEl = squares[sq]
        if (!squareEl) continue

        const existingPieceEl = squareEl.querySelector('.piece')

        if (!piece) {
          // No piece should be here
          if (existingPieceEl) {
            existingPieceEl.remove()
          }
        } else {
          // A piece should be here
          const code = (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase()
          if (existingPieceEl) {
            if (existingPieceEl.dataset.piece === code) {
              // Exact same piece already exists, keep it to avoid DOM thrashing & NS_BINDING_ABORTED
              continue
            } else {
              // Different piece, remove old one first
              existingPieceEl.remove()
            }
          }

          const pieceEl = createPieceElement(piece)
          squareEl.appendChild(pieceEl)
        }
      }
    }

    updateHighlights()
  }

  function createPieceElement(piece) {
    const code = (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase()
    const el = document.createElement('div')
    el.className = 'piece'
    el.dataset.piece = code
    el.draggable = false // we handle drag manually

    const img = document.createElement('img')
    img.src = PIECE_SVG[code]
    img.alt = code
    img.draggable = false
    img.onerror = () => {
      // Fallback to unicode
      el.removeChild(img)
      el.textContent = PIECE_UNICODE[code] || '?'
      el.classList.add('piece-unicode')
    }
    el.appendChild(img)
    return el
  }

  // ─── Highlights ────────────────────────────────────────────────
  function updateHighlights() {
    // Clear all highlights
    for (const sq of Object.values(squares)) {
      sq.classList.remove('highlight-last', 'highlight-selected', 'highlight-legal', 'highlight-check')
    }

    // Last move
    if (lastMove) {
      if (squares[lastMove.from]) squares[lastMove.from].classList.add('highlight-last')
      if (squares[lastMove.to]) squares[lastMove.to].classList.add('highlight-last')
    }

    // Selected square
    if (selectedSquare && squares[selectedSquare]) {
      squares[selectedSquare].classList.add('highlight-selected')
    }

    // Legal moves
    for (const m of legalMoves) {
      const target = squares[m.to]
      if (target) {
        target.classList.add('highlight-legal')
        if (m.captured) {
          target.classList.add('highlight-capture')
        }
      }
    }

    // King in check
    const game = new Chess(currentFen)
    if (game.isCheck()) {
      const board = game.board()
      const turn = game.turn()
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = board[r][c]
          if (p && p.type === 'k' && p.color === turn) {
            const sq = FILES[c] + RANKS[r]
            if (squares[sq]) squares[sq].classList.add('highlight-check')
          }
        }
      }
    }
  }

  // ─── Click-to-move ─────────────────────────────────────────────
  function handleSquareClick(sq) {
    if (!interactive) return

    const game = new Chess(currentFen)

    if (selectedSquare) {
      // Try to make a move
      const move = legalMoves.find(m => m.to === sq)
      if (move) {
        // Check for promotion
        if (move.promotion) {
          showPromotionDialog(selectedSquare, sq, game.turn())
          return
        }
        makeMove(move)
        return
      }

      // Clicked the same square — deselect
      if (sq === selectedSquare) {
        clearSelection()
        return
      }
    }

    // Select a new square if it has a piece of the right color
    const piece = game.get(sq)
    if (piece && piece.color === game.turn()) {
      selectedSquare = sq
      legalMoves = game.moves({ square: sq, verbose: true })
      updateHighlights()
    } else {
      clearSelection()
    }
  }

  function clearSelection() {
    selectedSquare = null
    legalMoves = []
    updateHighlights()
  }

  // ─── Drag-and-drop (mouse + touch) ─────────────────────────────
  function onSquareMouseDown(e, sq) {
    if (e.button !== 0) return // left click only
    beginDrag(e.clientX, e.clientY, sq, 'mouse', e)
  }

  function onSquareTouchStart(e, sq) {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    beginDrag(t.clientX, t.clientY, sq, 'touch', e)
  }

  function beginDrag(clientX, clientY, sq, kind, ev) {
    if (!interactive) return

    const game = new Chess(currentFen)
    const piece = game.get(sq)
    if (!piece || piece.color !== game.turn()) return

    const squareEl = squares[sq]
    const pieceEl = squareEl.querySelector('.piece')
    if (!pieceEl) return

    // Prevent text selection (mouse) / page scroll (touch).
    ev.preventDefault()

    // Select this square and show legal moves
    selectedSquare = sq
    legalMoves = game.moves({ square: sq, verbose: true })
    updateHighlights()

    // Start dragging
    const rect = squareEl.getBoundingClientRect()
    const ghost = pieceEl.cloneNode(true)
    ghost.className = 'piece piece-dragging'
    const size = rect.width
    ghost.style.width = `${size}px`
    ghost.style.height = `${size}px`
    ghost.style.position = 'fixed'
    ghost.style.pointerEvents = 'none'
    ghost.style.zIndex = '1000'
    ghost.style.left = `${clientX - size / 2}px`
    ghost.style.top = `${clientY - size / 2}px`
    document.body.appendChild(ghost)

    pieceEl.style.opacity = '0.3'

    dragState = { sq, pieceEl, ghost, size, kind, lastX: clientX, lastY: clientY }

    const moveAt = (x, y) => {
      if (!dragState) return
      dragState.lastX = x
      dragState.lastY = y
      dragState.ghost.style.left = `${x - dragState.size / 2}px`
      dragState.ghost.style.top = `${y - dragState.size / 2}px`
    }

    const onMouseMove = (e2) => moveAt(e2.clientX, e2.clientY)
    const onTouchMove = (e2) => {
      if (e2.touches.length !== 1) return
      e2.preventDefault() // suppress scrolling while dragging
      const t = e2.touches[0]
      moveAt(t.clientX, t.clientY)
    }

    const finish = (x, y) => {
      if (!dragState) return
      dragState.ghost.remove()
      dragState.pieceEl.style.opacity = ''

      // Find target square
      const targetEl = document.elementFromPoint(x, y)?.closest('.square')
      if (targetEl && targetEl.dataset.sq !== dragState.sq) {
        const targetSq = targetEl.dataset.sq
        const move = legalMoves.find(m => m.to === targetSq)
        if (move) {
          if (move.promotion) {
            showPromotionDialog(dragState.sq, targetSq, game.turn())
          } else {
            makeMove(move)
          }
        } else {
          clearSelection()
        }
      }
      // Dropped on same square or invalid: keep selection so user can tap a
      // destination next.

      dragState = null
    }

    const onMouseUp = (e2) => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      finish(e2.clientX, e2.clientY)
    }

    const onTouchEnd = (e2) => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
      // For touchend, use the last known position (changedTouches gives the
      // ended touch's coordinates which is what we want).
      const t = e2.changedTouches?.[0]
      const x = t ? t.clientX : dragState?.lastX
      const y = t ? t.clientY : dragState?.lastY
      finish(x, y)
    }

    if (kind === 'mouse') {
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    } else {
      document.addEventListener('touchmove', onTouchMove, { passive: false })
      document.addEventListener('touchend', onTouchEnd)
      document.addEventListener('touchcancel', onTouchEnd)
    }
  }

  // ─── Move execution ────────────────────────────────────────────
  function makeMove(moveOrObj) {
    const game = new Chess(currentFen)
    let move
    if (typeof moveOrObj === 'string') {
      move = game.move(moveOrObj)
    } else {
      move = game.move(moveOrObj)
    }

    if (!move) return null

    lastMove = { from: move.from, to: move.to }
    clearSelection()

    // Animate
    animateMove(move, () => {
      renderPosition(game.fen())
    })

    onMove(move, game.fen())
    return move
  }

  // ─── Animation ─────────────────────────────────────────────────
  function animateMove(move, callback) {
    const fromEl = squares[move.from]
    const toEl = squares[move.to]
    if (!fromEl || !toEl) {
      callback()
      return
    }

    const pieceEl = fromEl.querySelector('.piece')
    if (!pieceEl) {
      callback()
      return
    }

    const fromRect = fromEl.getBoundingClientRect()
    const toRect = toEl.getBoundingClientRect()
    const dx = toRect.left - fromRect.left
    const dy = toRect.top - fromRect.top

    pieceEl.style.transition = 'none'
    pieceEl.style.transform = 'translate(0, 0)'
    pieceEl.style.zIndex = '100'

    // Remove captured piece immediately for visual clarity. Skip pieces that
    // are themselves mid-animation (transform set) — those belong to a
    // concurrent move (e.g. the player's animating piece sitting in its
    // origin square while the engine animates into that same square) and
    // should be reconciled by renderPosition at the end.
    const capturedPiece = toEl.querySelector('.piece')
    if (capturedPiece && !capturedPiece.style.transform) capturedPiece.remove()

    // Capture the current render token. If anything changes the board's
    // authoritative state before this animation finishes (e.g. a fast engine
    // reply rendering its move), the token will bump and we skip the stale
    // callback so it can't overwrite the newer position.
    const myToken = ++renderToken

    requestAnimationFrame(() => {
      pieceEl.style.transition = 'transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)'
      pieceEl.style.transform = `translate(${dx}px, ${dy}px)`

      let done = false
      const finish = () => {
        if (done) return
        done = true
        if (myToken !== renderToken) return // stale — newer state already rendered
        pieceEl.style.transition = ''
        pieceEl.style.transform = ''
        pieceEl.style.zIndex = ''
        callback()
      }

      pieceEl.addEventListener('transitionend', finish, { once: true })

      // Fallback in case transitionend doesn't fire
      setTimeout(finish, 250)
    })
  }

  // ─── Promotion dialog ──────────────────────────────────────────
  function showPromotionDialog(from, to, color) {
    promoOverlay.innerHTML = ''
    promoOverlay.classList.remove('hidden')

    const pieces = ['q', 'r', 'b', 'n']
    const dialog = document.createElement('div')
    dialog.className = 'promotion-dialog'

    for (const p of pieces) {
      const code = (color === 'w' ? 'w' : 'b') + p.toUpperCase()
      const btn = document.createElement('button')
      btn.className = 'promotion-choice'

      const img = document.createElement('img')
      img.src = PIECE_SVG[code]
      img.alt = code
      img.draggable = false
      img.onerror = () => {
        btn.textContent = PIECE_UNICODE[code] || p.toUpperCase()
      }
      btn.appendChild(img)

      btn.addEventListener('click', () => {
        promoOverlay.classList.add('hidden')
        const game = new Chess(currentFen)
        const move = game.move({ from, to, promotion: p })
        if (move) {
          lastMove = { from: move.from, to: move.to }
          clearSelection()
          renderPosition(game.fen())
          onMove(move, game.fen())
        }
      })

      dialog.appendChild(btn)
    }

    // Cancel area
    promoOverlay.addEventListener('click', (e) => {
      if (e.target === promoOverlay) {
        promoOverlay.classList.add('hidden')
        clearSelection()
      }
    }, { once: true })

    promoOverlay.appendChild(dialog)
  }

  // ─── Public API ────────────────────────────────────────────────
  return {
    /** Set the board to a FEN position without animation. */
    setPosition(fen) {
      renderToken++ // invalidate any in-flight animation callbacks
      currentFen = fen
      clearSelection()
      renderPosition(fen)
    },

    /** Set position and highlight a specific move (no animation). */
    setPositionWithMove(fen, from, to) {
      renderToken++ // invalidate any in-flight animation callbacks
      lastMove = from && to ? { from, to } : null
      currentFen = fen
      clearSelection()
      renderPosition(fen)
    },

    /**
     * Animate a piece sliding from `from` to `to`, then settle the board to
     * `fen`. Used for engine replies so they animate just like player moves.
     * Falls back to an instant render if no piece is on `from`.
     */
    animateMoveTo(fen, from, to) {
      if (!from || !to || !squares[from] || !squares[from].querySelector('.piece')) {
        renderToken++
        lastMove = from && to ? { from, to } : null
        currentFen = fen
        clearSelection()
        renderPosition(fen)
        return
      }
      lastMove = { from, to }
      clearSelection()
      // animateMove bumps renderToken itself, which also invalidates any
      // still-pending player-animation callback.
      animateMove({ from, to }, () => {
        renderPosition(fen)
      })
    },

    /** Play a move (SAN string) with animation. Returns the move object or null. */
    playMove(san) {
      return makeMove(san)
    },

    /** Highlight the last move squares. */
    setLastMove(from, to) {
      lastMove = { from, to }
      updateHighlights()
    },

    /** Flip the board orientation. */
    flip() {
      flipped = !flipped
      buildSquares()
      renderPosition(currentFen)
    },

    /** Get current flip state */
    isFlipped() {
      return flipped
    },

    /** Enable/disable user interaction. */
    setInteractive(val) {
      interactive = val
      boardEl.classList.toggle('disabled', !val)
    },

    /** Get the board DOM element */
    getElement() {
      return boardEl
    },

    /** Get current FEN */
    getFen() {
      return currentFen
    },

    /**
     * Draw review arrows on the board SVG overlay.
     * @param {{ from, to, bestFrom, bestTo }|null} arrowData
     *   Pass null to clear all arrows.
     */
    drawReviewArrows(arrowData) {
      drawReviewArrows(arrowData)
    },

    /** Clear all review arrows from the overlay. */
    clearArrows() {
      drawReviewArrows(null)
    },
  }
}
