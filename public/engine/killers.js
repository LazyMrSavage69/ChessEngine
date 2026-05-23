// Killer-move heuristic: remember moves that recently caused beta-cutoffs
// at each ply, then prefer them in move ordering. Two slots per ply.

const MAX_PLY = 64
const killers = Array.from({ length: MAX_PLY }, () => [null, null])

export function storeKiller(ply, moveSan) {
  if (ply < 0 || ply >= MAX_PLY) return
  const slot = killers[ply]
  if (slot[0] !== moveSan) {
    slot[1] = slot[0]
    slot[0] = moveSan
  }
}

export function getKillers(ply) {
  if (ply < 0 || ply >= MAX_PLY) return [null, null]
  return killers[ply]
}

export function clearKillers() {
  for (const slot of killers) {
    slot[0] = null
    slot[1] = null
  }
}
