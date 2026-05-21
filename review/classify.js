// Move classification (chess.com-style tiers) based on centipawn delta from
// the engine's best move plus tactical heuristics for Brilliant / Great / Book.
// Also provides a Lichess-style accuracy calculation.

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
  if (delta <= 10)           return withLegacyShape(CLASSIFICATIONS.EXCELLENT)
  if (delta <= 40)           return withLegacyShape(CLASSIFICATIONS.GOOD)
  if (delta <= 100)          return withLegacyShape(CLASSIFICATIONS.INACCURACY)
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
