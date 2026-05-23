// History heuristic: track which quiet moves have caused cutoffs in the past
// (indexed by piece + destination square) and bias move ordering toward them.

const history = Object.create(null)

function key(move) {
  // chess.js move objects have .piece (lowercase) and .to (e.g. "e4")
  return move.piece + move.to
}

export function updateHistory(move, depth) {
  const k = key(move)
  history[k] = (history[k] || 0) + depth * depth
}

export function getHistory(move) {
  return history[key(move)] || 0
}

export function clearHistory() {
  for (const k of Object.keys(history)) delete history[k]
}
