// Review panel: renders post-game analysis results AND the "My Games" tab
// that lists previously-saved games and lets the user replay them.
//
// chess.js v1.x is imported via the same CDN URL used everywhere else; the
// SAN-regex replay in `openReplay()` needs a fresh game to walk the parsed tokens.

import { accuracy, createClassBadge, CLASSIFICATIONS } from '../review/classify.js'
import { decompressFromBase64 } from '/games/saveGame.js'
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm'

/**
 * Build and display the review panel.
 * @param {HTMLElement} container – element to render into
 * @param {{ moveSan, bestMove, delta, classification, fen, player }[]} annotations
 * @param {string|null} openingName
 * @param {string|null} eco
 * @param {(index: number) => void} onMoveClick – callback when user clicks a move
 */
export function renderReviewPanel(container, annotations, openingName, eco, onMoveClick) {
  container.innerHTML = ''
  container.classList.add('review-panel')

  // Separate annotations by player
  const whiteAnnotations = annotations.filter(a => a.player === 'w')
  const blackAnnotations = annotations.filter(a => a.player === 'b')

  const whiteAcc = accuracy(whiteAnnotations)
  const blackAcc = accuracy(blackAnnotations)

  // Header
  const header = document.createElement('div')
  header.className = 'review-header'
  header.innerHTML = `
    <h3>Game Review</h3>
    ${openingName ? `<div class="review-opening">${openingName}${eco ? ` <span class="eco-badge">${eco}</span>` : ''}</div>` : ''}
    <div class="review-accuracy">
      <div class="accuracy-bar">
        <div class="accuracy-label">White</div>
        <div class="accuracy-track">
          <div class="accuracy-fill" style="width:${whiteAcc}%; background: linear-gradient(90deg, #e74c3c, #f39c12, #2ecc71)"></div>
        </div>
        <div class="accuracy-value">${whiteAcc}%</div>
      </div>
      <div class="accuracy-bar">
        <div class="accuracy-label">Black</div>
        <div class="accuracy-track">
          <div class="accuracy-fill" style="width:${blackAcc}%; background: linear-gradient(90deg, #e74c3c, #f39c12, #2ecc71)"></div>
        </div>
        <div class="accuracy-value">${blackAcc}%</div>
      </div>
    </div>
  `
  container.appendChild(header)

  // Summary stats — count every classification we know about.
  const counts = {}
  for (const a of annotations) {
    const key = a.classification?.key || a.classification?.label || 'BEST'
    counts[key] = (counts[key] || 0) + 1
  }

  // Display order, only show buckets with at least one move.
  const summaryOrder = [
    'BRILLIANT', 'GREAT', 'BEST', 'EXCELLENT', 'GOOD', 'BOOK',
    'INACCURACY', 'MISTAKE', 'BLUNDER',
  ]
  const summary = document.createElement('div')
  summary.className = 'review-summary'
  for (const key of summaryOrder) {
    const n = counts[key] || 0
    if (n === 0) continue
    const cls = CLASSIFICATIONS[key]
    const chip = document.createElement('span')
    chip.className = `stat-chip stat-chip-${cls.cls}`
    chip.title = cls.label
    chip.appendChild(createClassBadge(cls))
    const num = document.createElement('span')
    num.className = 'stat-chip-count'
    num.textContent = n
    chip.appendChild(num)
    summary.appendChild(chip)
  }
  container.appendChild(summary)

  // Move list table
  const table = document.createElement('div')
  table.className = 'review-moves'

  // Group into pairs (white, black)
  const moveRows = []
  let moveNum = 1
  for (let i = 0; i < annotations.length; i += 2) {
    const whiteMove = annotations[i]
    const blackMove = i + 1 < annotations.length ? annotations[i + 1] : null
    moveRows.push({ num: moveNum++, white: whiteMove, whiteIdx: i, black: blackMove, blackIdx: i + 1 })
  }

  for (const row of moveRows) {
    const rowEl = document.createElement('div')
    rowEl.className = 'review-move-row'

    const numEl = document.createElement('span')
    numEl.className = 'move-number'
    numEl.textContent = `${row.num}.`
    rowEl.appendChild(numEl)

    // White move
    const wEl = createMoveCell(row.white, row.whiteIdx, onMoveClick)
    rowEl.appendChild(wEl)

    // Black move
    if (row.black) {
      const bEl = createMoveCell(row.black, row.blackIdx, onMoveClick)
      rowEl.appendChild(bEl)
    } else {
      const empty = document.createElement('span')
      empty.className = 'review-move-cell'
      rowEl.appendChild(empty)
    }

    table.appendChild(rowEl)
  }

  container.appendChild(table)

  // Navigation controls
  const nav = document.createElement('div')
  nav.className = 'review-nav'
  nav.innerHTML = `
    <button id="review-start" class="review-nav-btn" title="Start">⏮</button>
    <button id="review-prev" class="review-nav-btn" title="Previous">◀</button>
    <button id="review-next" class="review-nav-btn" title="Next">▶</button>
    <button id="review-end" class="review-nav-btn" title="End">⏭</button>
  `
  container.appendChild(nav)

  // Navigation state
  let currentIdx = -1
  const allCells = container.querySelectorAll('.review-move-cell[data-idx]')

  function highlightMove(idx) {
    allCells.forEach(c => c.classList.remove('active'))
    if (idx >= 0 && idx < annotations.length) {
      const cell = container.querySelector(`.review-move-cell[data-idx="${idx}"]`)
      if (cell) {
        cell.classList.add('active')
        cell.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
      currentIdx = idx
      if (onMoveClick) onMoveClick(idx, annotations[idx]?.arrow ?? null)
    }
  }

  nav.querySelector('#review-start').onclick = () => highlightMove(0)
  nav.querySelector('#review-prev').onclick = () => highlightMove(Math.max(0, currentIdx - 1))
  nav.querySelector('#review-next').onclick = () => highlightMove(Math.min(annotations.length - 1, currentIdx + 1))
  nav.querySelector('#review-end').onclick = () => highlightMove(annotations.length - 1)

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!container.closest('.sidebar')) return
    if (e.key === 'ArrowLeft') highlightMove(Math.max(0, currentIdx - 1))
    if (e.key === 'ArrowRight') highlightMove(Math.min(annotations.length - 1, currentIdx + 1))
  })
}

function createMoveCell(annotation, idx, onMoveClick) {
  const el = document.createElement('span')
  el.className = `review-move-cell review-move-${annotation.classification?.cls || 'good'}`
  el.dataset.idx = idx

  const san = document.createElement('span')
  san.className = 'review-san'
  san.textContent = annotation.moveSan

  // Replace the old emoji icon with a proper chess.com-style badge.
  const badge = createClassBadge(annotation.classification)

  el.appendChild(san)
  el.appendChild(badge)

  // Show delta for non-best moves
  if (annotation.delta > 30) {
    const delta = document.createElement('span')
    delta.className = 'review-delta'
    delta.textContent = `-${annotation.delta}`
    delta.style.color = annotation.classification.color
    el.appendChild(delta)
  }

  // Tooltip for best move on mistakes/blunders
  if (annotation.delta > 100 && annotation.bestMove) {
    const best = document.createElement('div')
    best.className = 'review-best-hint'
    best.textContent = `Best: ${annotation.bestMove.san}`
    el.appendChild(best)
  }

  el.addEventListener('click', () => {
    // Highlight this cell
    const parent = el.closest('.review-panel')
    if (parent) {
      parent.querySelectorAll('.review-move-cell').forEach(c => c.classList.remove('active'))
      el.classList.add('active')
    }
    if (onMoveClick) onMoveClick(idx, annotation.arrow ?? null)
  })

  return el
}

/**
 * Show a progress bar during analysis.
 */
export function renderReviewProgress(container, index, total) {
  let bar = container.querySelector('.review-progress')
  if (!bar) {
    container.innerHTML = ''
    bar = document.createElement('div')
    bar.className = 'review-progress'
    bar.innerHTML = `
      <div class="review-progress-label">Analyzing game...</div>
      <div class="review-progress-track">
        <div class="review-progress-fill"></div>
      </div>
      <div class="review-progress-text">0/${total}</div>
    `
    container.appendChild(bar)
  }

  const pct = Math.round(((index + 1) / total) * 100)
  bar.querySelector('.review-progress-fill').style.width = `${pct}%`
  bar.querySelector('.review-progress-text').textContent = `${index + 1}/${total}`
}

// ─── My Games tab ─────────────────────────────────────────────────
// Regex matching standard SAN tokens — castling, captures, promotions, file/
// rank disambiguation, check/mate markers. We MUST use a regex match here
// (not split on /\d+\.\s/) to avoid the fragmentation bug where a token like
// "e4." would be silently dropped when adjacent to a move number boundary.
const SAN_TOKEN_RE = /O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?/g

/**
 * Render the "My Games" tab content.
 *
 * @param {HTMLElement} container          – the tab's content panel
 * @param {object} supabase                – the shared client (passed in to
 *                                            avoid a circular import)
 * @param {(fen: string) => void} onShowFen – callback when the user navigates
 *                                            to a position in a replayed game
 */
export async function renderMyGamesTab(container, supabase, onShowFen) {
  container.innerHTML = '<p class="muted">Loading…</p>'

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    container.innerHTML = '<p class="muted">Sign in to see your saved games.</p>'
    return
  }

  const { data: games, error } = await supabase
    .from('games')
    .select('*')
    .eq('user_id', user.id)
    .order('played_at', { ascending: false })

  if (error) {
    container.innerHTML = `<p class="error">Failed to load games: ${escapeHtml(error.message)}</p>`
    return
  }
  if (!games || games.length === 0) {
    container.innerHTML = '<p class="muted">No saved games yet — finish a game to archive it here.</p>'
    return
  }

  container.innerHTML = ''

  const list = document.createElement('div')
  list.className = 'games-list'
  for (const g of games) {
    const row = document.createElement('button')
    row.className = 'game-row'
    const date = g.played_at ? new Date(g.played_at).toLocaleString() : '—'
    row.innerHTML = `
      <div class="game-row-main">
        <span class="game-result">${escapeHtml(g.result || '?')}</span>
        <span class="game-date">${escapeHtml(date)}</span>
      </div>
      <div class="game-row-meta">${g.move_count ?? 0} moves</div>
    `
    row.addEventListener('click', () => openReplay(g, container, onShowFen))
    list.appendChild(row)
  }
  container.appendChild(list)
}

/**
 * Decompress a saved game and render an inline replay viewer with prev/next
 * navigation. The viewer rebuilds the game via SAN regex tokens (NOT a string
 * split on move numbers — that fragmentation bug would drop tokens).
 */
async function openReplay(gameRow, container, onShowFen) {
  const md = await decompressFromBase64(gameRow.moves_gz)
  // Strip the header lines so we don't accidentally match SAN-looking words
  // inside the title. Everything before the first blank line is metadata.
  const body = md.split(/\n\s*\n/).slice(1).join('\n') || md
  const tokens = body.match(SAN_TOKEN_RE) || []

  // Replay all moves on a fresh chess.js instance, capturing one FEN per ply.
  // chess.js v1.x dropped the `{ sloppy: true }` option — strict SAN only,
  // which is what we emit in buildGameMD anyway, so plain `.move(t)` is fine.
  const game = new Chess()
  const fens = [game.fen()]
  for (const t of tokens) {
    try {
      const m = game.move(t)
      if (!m) break
      fens.push(game.fen())
    } catch {
      break // bad token — stop replay rather than throw
    }
  }

  // Build the viewer UI underneath the games list.
  let viewer = container.querySelector('.replay-viewer')
  if (viewer) viewer.remove()
  viewer = document.createElement('div')
  viewer.className = 'replay-viewer'
  viewer.innerHTML = `
    <div class="replay-header">
      <strong>Game replay</strong>
      <span class="replay-meta">${escapeHtml(gameRow.result || '?')} · ${tokens.length} moves</span>
      <button class="btn btn-icon" data-act="close" title="Close">✕</button>
    </div>
    <div class="replay-md"><pre>${escapeHtml(md)}</pre></div>
    <div class="replay-nav">
      <button class="replay-nav-btn" data-act="start">⏮</button>
      <button class="replay-nav-btn" data-act="prev">◀</button>
      <span class="replay-pos">0 / ${fens.length - 1}</span>
      <button class="replay-nav-btn" data-act="next">▶</button>
      <button class="replay-nav-btn" data-act="end">⏭</button>
    </div>
  `
  container.appendChild(viewer)

  let pos = 0
  const posEl = viewer.querySelector('.replay-pos')
  const goto = (i) => {
    pos = Math.max(0, Math.min(fens.length - 1, i))
    posEl.textContent = `${pos} / ${fens.length - 1}`
    onShowFen?.(fens[pos])
  }
  viewer.querySelector('[data-act="start"]').onclick = () => goto(0)
  viewer.querySelector('[data-act="prev"]').onclick  = () => goto(pos - 1)
  viewer.querySelector('[data-act="next"]').onclick  = () => goto(pos + 1)
  viewer.querySelector('[data-act="end"]').onclick   = () => goto(fens.length - 1)
  viewer.querySelector('[data-act="close"]').onclick = () => viewer.remove()

  goto(0)
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
