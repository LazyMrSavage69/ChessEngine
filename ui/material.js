// Material count panel: shows captured pieces and material advantage.

const PIECE_ORDER = ['q', 'r', 'b', 'n', 'p']
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const PIECE_UNICODE = {
  wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
}

// Starting material
const START_MATERIAL = { p: 8, n: 2, b: 2, r: 2, q: 1 }

/**
 * Calculate captured pieces and material advantage from a chess.js game.
 * @param {object} game – chess.js instance
 * @returns {{ whiteCaptured: string[], blackCaptured: string[], whiteAdv: number, blackAdv: number }}
 */
export function computeMaterial(game) {
  const board = game.board()
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (sq && sq.type !== 'k') {
        count[sq.color][sq.type]++
      }
    }
  }

  // Captured pieces: what's missing from starting position
  const whiteCaptured = [] // pieces white has captured (black's missing pieces)
  const blackCaptured = [] // pieces black has captured (white's missing pieces)

  let whitePoints = 0, blackPoints = 0

  for (const piece of PIECE_ORDER) {
    const wMissing = START_MATERIAL[piece] - count.w[piece]
    const bMissing = START_MATERIAL[piece] - count.b[piece]

    for (let i = 0; i < Math.max(0, bMissing); i++) {
      blackCaptured.push(PIECE_UNICODE['w' + piece])
      blackPoints += PIECE_VALUES[piece]
    }
    for (let i = 0; i < Math.max(0, wMissing); i++) {
      whiteCaptured.push(PIECE_UNICODE['b' + piece])
      whitePoints += PIECE_VALUES[piece]
    }
  }

  const diff = whitePoints - blackPoints

  return {
    whiteCaptured,  // pieces captured by white (shown near white)
    blackCaptured,  // pieces captured by black (shown near black)
    whiteAdv: diff > 0 ? diff : 0,
    blackAdv: diff < 0 ? -diff : 0,
  }
}

/**
 * Render material into the player info elements.
 */
export function renderMaterial(game, whiteCapEl, blackCapEl) {
  const mat = computeMaterial(game)

  whiteCapEl.innerHTML = ''
  blackCapEl.innerHTML = ''

  // White's captures (black pieces white took)
  const wPieces = document.createElement('span')
  wPieces.className = 'captured-pieces'
  wPieces.textContent = mat.whiteCaptured.join('')
  whiteCapEl.appendChild(wPieces)
  if (mat.whiteAdv > 0) {
    const adv = document.createElement('span')
    adv.className = 'material-advantage'
    adv.textContent = `+${mat.whiteAdv}`
    whiteCapEl.appendChild(adv)
  }

  // Black's captures (white pieces black took)
  const bPieces = document.createElement('span')
  bPieces.className = 'captured-pieces'
  bPieces.textContent = mat.blackCaptured.join('')
  blackCapEl.appendChild(bPieces)
  if (mat.blackAdv > 0) {
    const adv = document.createElement('span')
    adv.className = 'material-advantage'
    adv.textContent = `+${mat.blackAdv}`
    blackCapEl.appendChild(adv)
  }
}
