// review/classify.js — PURE classification module.
//
// IMPORTANT (per architecture rules):
//   • This file MUST NOT call the engine or send Worker messages.
//   • All scores / move lists / sacrifice flags are computed by the Worker
//     (engine/worker.js) and passed in. classifyMove() just decides the badge.
//
// Two layers live in this file:
//   1. classifyMove() — the new Stockfish-style annotation API consumed by the
//      Worker's `classify` handler. Returns a short string ('!!', '!', '?', …).
//   2. The legacy `classify(delta, isBest)` + `CLASSIFICATIONS` map used by
//      review/reviewer.js and ui/reviewPanel.js to render badges. These are
//      unchanged so the post-game review UI keeps working.
//
// Both layers are pure functions — no side effects.

// ─── (1) NEW: live-move classification (Worker → main thread) ───

/**
 * Classify a played move based on centipawn loss + tactical context.
 *
 * All scores are FROM THE MOVING SIDE'S PERSPECTIVE (positive = moving side
 * winning). The Worker is responsible for negating engine outputs before
 * passing them in.
 *
 * @param {number}  bestScore    – full-depth eval of the best legal reply (moving side POV).
 * @param {number}  playedScore  – full-depth eval AFTER the played move, negated
 *                                 back to the moving side's POV (i.e. -engineScoreAfter).
 * @param {object}  playedMove   – { from, to, promotion }.
 * @param {object?} obviousMove  – top move from a depth-1 search.
 * @param {object[]} topMoves    – top 3 moves at full depth: [{ from, to }, …].
 * @param {boolean} isSacrifice  – computed in the Worker (undefended dest, or
 *                                 captures lower-value piece with higher).
 * @returns {string} one of '!!', '!', '', '?!', '?', '??'.
 */
export function classifyMove(bestScore, playedScore, playedMove, obviousMove, topMoves, isSacrifice) {
  // cploss is always >= 0: how many centipawns worse than best the played move was.
  // We clamp at 0 so a played move that happens to evaluate slightly higher than
  // the engine's "best" (e.g. due to depth differences) doesn't go negative.
  const cploss = Math.max(0, bestScore - playedScore)

  const isObvious = obviousMove &&
    obviousMove.from === playedMove.from &&
    obviousMove.to   === playedMove.to

  const isInTop3 = Array.isArray(topMoves) && topMoves.some(m =>
    m.from === playedMove.from && m.to === playedMove.to
  )

  // Brilliant: near-zero loss, is a sacrifice, and leaves moving side clearly winning.
  if (cploss < 10 && isSacrifice && playedScore > 100) return '!!'

  // Great: low loss, the move is NOT the obvious recapture/threat-defense, but
  // is still in the engine's top 3 (engine-approved non-obvious move).
  if (cploss < 20 && !isObvious && isInTop3) return '!'

  // Standard classification by centipawn loss.
  if (cploss <= 50)  return ''      // Good (no annotation)
  if (cploss <= 100) return '?!'    // Inaccuracy
  if (cploss <= 200) return '?'     // Mistake
  return '??'                       // Blunder
}

// ─── (2) LEGACY: classification map + helpers used by review panel ───

// Each classification carries everything the UI needs to render a badge:
//   key   – stable identifier
//   label – human-readable name
//   short – text shown inside the badge ("!!", "?!", "★", …)
//   color – primary brand color (used in legacy callers; CSS uses the cls)
//   cls   – CSS class suffix (.cls-<cls>) for the badge element
export const CLASSIFICATIONS = {
  BRILLIANT:  { key: 'BRILLIANT',  label: 'Brilliant',  short: '!!', color: '#1ba1c1', cls: 'brilliant'  },
  GREAT:      { key: 'GREAT',      label: 'Great Move', short: '!',  color: '#5b8bbf', cls: 'great'      },
  BEST:       { key: 'BEST',       label: 'Best',       short: '★',  color: '#81b64c', cls: 'best'       },
  EXCELLENT:  { key: 'EXCELLENT',  label: 'Excellent',  short: '✓',  color: '#95c168', cls: 'excellent'  },
  GOOD:       { key: 'GOOD',       label: 'Good',       short: '✓',  color: '#b2c98a', cls: 'good'       },
  BOOK:       { key: 'BOOK',       label: 'Book',       short: '📖', color: '#a88859', cls: 'book'       },
  INACCURACY: { key: 'INACCURACY', label: 'Inaccuracy', short: '?!', color: '#f7c452', cls: 'inaccuracy' },
  MISTAKE:    { key: 'MISTAKE',    label: 'Mistake',    short: '?',  color: '#ffa459', cls: 'mistake'    },
  BLUNDER:    { key: 'BLUNDER',    label: 'Blunder',    short: '??', color: '#fa412d', cls: 'blunder'    },
}

// Older callers expect classify(delta, isBest) to return { label, icon, color }.
// We keep that shape by aliasing `icon` → `short` so nothing else breaks.
function withLegacyShape(c) {
  return { ...c, icon: c.short }
}

/**
 * Coarse classification by centipawn delta. Used when no tactical override
 * (Brilliant / Great / Book) applies.
 * @param {number} delta – cp lost vs best (≥ 0)
 * @param {boolean} isBest – true when the played move matched the engine's pick
 */
export function classify(delta, isBest) {
  if (isBest || delta <= 0)  return withLegacyShape(CLASSIFICATIONS.BEST)
  if (delta <= 15)           return withLegacyShape(CLASSIFICATIONS.EXCELLENT)
  if (delta <= 50)           return withLegacyShape(CLASSIFICATIONS.GOOD)
  if (delta <= 120)          return withLegacyShape(CLASSIFICATIONS.INACCURACY)
  if (delta <= 300)          return withLegacyShape(CLASSIFICATIONS.MISTAKE)
  return                            withLegacyShape(CLASSIFICATIONS.BLUNDER)
}

/** Convenience helpers for the reviewer to apply tactical overrides. */
export const brilliant  = () => withLegacyShape(CLASSIFICATIONS.BRILLIANT)
export const great      = () => withLegacyShape(CLASSIFICATIONS.GREAT)
export const book       = () => withLegacyShape(CLASSIFICATIONS.BOOK)

/**
 * Lichess-style accuracy over a set of annotations.
 * @param {{ delta: number }[]} annotations
 * @returns {number} – 0–100
 */
export function accuracy(annotations) {
  if (!annotations || annotations.length === 0) return 100
  const cpLosses = annotations.map(a => Math.max(0, a.delta))
  const avg = cpLosses.reduce((s, v) => s + v, 0) / cpLosses.length
  return Math.round(100 * Math.exp(-0.00375 * avg))
}

/**
 * Build the badge DOM element for a classification. Returns a span with the
 * appropriate `.cls-badge .cls-<x>` class and accessible title.
 */
export function createClassBadge(classification) {
  const el = document.createElement('span')
  const cls = classification?.cls || 'good'
  const label = classification?.label || ''
  const short = classification?.short || classification?.icon || ''
  el.className = `cls-badge cls-${cls}`
  el.textContent = short
  el.title = label
  el.setAttribute('aria-label', label)
  return el
}

/**
 * Map a short annotation token from classifyMove() ('!!', '?!', …) to the
 * legacy CLASSIFICATIONS entry so the same UI badge code can render it.
 */
export function annotationToClassification(token) {
  switch (token) {
    case '!!': return withLegacyShape(CLASSIFICATIONS.BRILLIANT)
    case '!':  return withLegacyShape(CLASSIFICATIONS.GREAT)
    case '?!': return withLegacyShape(CLASSIFICATIONS.INACCURACY)
    case '?':  return withLegacyShape(CLASSIFICATIONS.MISTAKE)
    case '??': return withLegacyShape(CLASSIFICATIONS.BLUNDER)
    default:   return withLegacyShape(CLASSIFICATIONS.GOOD)
  }
}
