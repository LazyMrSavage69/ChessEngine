// Vertical evaluation bar: white at the bottom, black at the top.
// Reflects the engine's centipawn score from White's perspective.
// Falls back to material differential when no engine eval is available.

import { computeMaterial } from './material.js'

const MATE_SCORE_THRESHOLD = 90000 // anything above this is treated as a mate score

/**
 * Build and mount the eval bar DOM into `container`. Returns a controller with
 * methods to update or reset the bar.
 */
export function createEvalBar(container) {
  container.innerHTML = ''
  container.classList.add('eval-bar')

  const whiteFill = document.createElement('div')
  whiteFill.className = 'eval-bar-white'
  whiteFill.style.height = '50%'

  const label = document.createElement('div')
  label.className = 'eval-bar-label'
  label.textContent = '0.0'

  container.appendChild(whiteFill)
  container.appendChild(label)

  let flipped = false // when true, white sits at the top of the bar instead of the bottom
  let lastWhiteCp = 0

  function render(whiteCp, { mate = null } = {}) {
    lastWhiteCp = whiteCp

    // Convert centipawn score into a 0–100 % height for the white portion.
    // Uses a sigmoid-ish curve so small advantages move the bar noticeably
    // without huge advantages slamming it to the edge.
    let whitePct
    if (mate !== null) {
      whitePct = mate > 0 ? 98 : 2
    } else {
      const clamped = Math.max(-1500, Math.min(1500, whiteCp))
      whitePct = 50 + (clamped / 1500) * 48 // ±48% swing, never fully maxed
      whitePct = Math.max(2, Math.min(98, whitePct))
    }

    if (flipped) {
      // White at top: invert the height so the white portion sits at the top.
      whiteFill.style.bottom = 'auto'
      whiteFill.style.top = '0'
      whiteFill.style.height = `${whitePct}%`
    } else {
      whiteFill.style.top = 'auto'
      whiteFill.style.bottom = '0'
      whiteFill.style.height = `${whitePct}%`
    }

    // Label: which side is winning, formatted nicely.
    let text
    if (mate !== null) {
      text = mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`
    } else {
      const pawns = whiteCp / 100
      text = pawns >= 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1)
    }
    label.textContent = text

    // Label color + position: live on the winning side so it stays readable.
    const whiteIsWinning = (mate !== null ? mate > 0 : whiteCp >= 0)
    label.classList.toggle('on-white', whiteIsWinning)
    label.classList.toggle('on-black', !whiteIsWinning)
    // Vertically anchor near the winning side
    if ((whiteIsWinning && !flipped) || (!whiteIsWinning && flipped)) {
      label.style.bottom = '4px'
      label.style.top = 'auto'
    } else {
      label.style.top = '4px'
      label.style.bottom = 'auto'
    }
  }

  return {
    /**
     * Apply an engine score (in centipawns, from `sideToMove`'s perspective).
     * Converts to White's perspective for display.
     */
    setEngineScore(score, sideToMove) {
      if (score === undefined || score === null || Number.isNaN(score)) return
      const whiteCp = sideToMove === 'w' ? score : -score
      // Detect mate scores: search.js uses MATE_SCORE = 99999 with ply offset.
      if (Math.abs(score) > MATE_SCORE_THRESHOLD) {
        const movesToMate = Math.max(1, Math.ceil((99999 - Math.abs(score)) / 2))
        const mate = score > 0 ? movesToMate : -movesToMate
        // Mate is from side-to-move; convert to White-perspective sign.
        const whiteMate = sideToMove === 'w' ? mate : -mate
        render(whiteCp, { mate: whiteMate })
      } else {
        render(whiteCp)
      }
    },

    /**
     * Display the material balance only (used when no engine eval is available
     * yet, e.g. before the engine has searched anything).
     */
    setMaterialOnly(game) {
      const mat = computeMaterial(game)
      const whiteCp = (mat.whiteAdv - mat.blackAdv) * 100
      render(whiteCp)
    },

    /** Reset bar to dead-even. */
    reset() {
      render(0)
    },

    /** Sync orientation with the board's flip state. */
    setFlipped(val) {
      flipped = !!val
      render(lastWhiteCp)
    },
  }
}
