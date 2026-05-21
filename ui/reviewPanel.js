// Review panel: renders post-game analysis results.

import { accuracy, createClassBadge, CLASSIFICATIONS } from '../review/classify.js'

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
