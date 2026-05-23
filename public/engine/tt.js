// Transposition table: cache search results keyed by Zobrist hash.

export const TT_FLAG_EXACT = 0
export const TT_FLAG_LOWER = 1
export const TT_FLAG_UPPER = 2

const TT_BITS = 20            // 2^20 = ~1M entries
const TT_SIZE = 1 << TT_BITS
const TT_MASK = TT_SIZE - 1

// Plain array of entry objects. We replace based on age/depth.
const tt = new Array(TT_SIZE)
let currentAge = 0

export function ttGet(hash) {
  const e = tt[hash & TT_MASK]
  if (!e || e.hash !== hash) return null
  return e
}

export function ttSet(hash, depth, score, flag, bestMove) {
  const idx = hash & TT_MASK
  const existing = tt[idx]
  // Replacement scheme: replace if empty, stale age, or this search is deeper/equal.
  if (!existing || existing.age !== currentAge || existing.depth <= depth) {
    tt[idx] = { hash, depth, score, flag, bestMove, age: currentAge }
  }
}

export function ttNewAge() {
  currentAge = (currentAge + 1) & 0xff
}

export function ttClear() {
  tt.fill(undefined)
  currentAge = 0
}
