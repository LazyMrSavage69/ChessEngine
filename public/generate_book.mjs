// Generate openings.json with accurate FEN keys using chess.js.
// Each "line" is a sequence of SAN moves. The line's name identifies the
// position AFTER all moves in the line are played.
import { Chess } from 'chess.js'
import { writeFileSync } from 'fs'

const lines = [
  // ─── 1-move lines: name positions after move 1 ───
  { eco: 'B00', name: "King's Pawn Opening",   moves: ['e4'] },
  { eco: 'D00', name: "Queen's Pawn Opening",  moves: ['d4'] },
  { eco: 'A10', name: "English Opening",       moves: ['c4'] },
  { eco: 'A04', name: "Réti Opening",          moves: ['Nf3'] },

  // ─── Replies to 1.e4 ───
  { eco: 'C20', name: "Open Game",                moves: ['e4', 'e5'] },
  { eco: 'B20', name: "Sicilian Defense",         moves: ['e4', 'c5'] },
  { eco: 'C00', name: "French Defense",           moves: ['e4', 'e6'] },
  { eco: 'B10', name: "Caro-Kann Defense",        moves: ['e4', 'c6'] },
  { eco: 'B07', name: "Pirc Defense",             moves: ['e4', 'd6'] },
  { eco: 'B01', name: "Scandinavian Defense",     moves: ['e4', 'd5'] },
  { eco: 'B02', name: "Alekhine's Defense",       moves: ['e4', 'Nf6'] },

  // ─── Replies to 1.d4 ───
  { eco: 'D00', name: "Closed Game",              moves: ['d4', 'd5'] },
  { eco: 'A40', name: "Indian Defense",           moves: ['d4', 'Nf6'] },
  { eco: 'A80', name: "Dutch Defense",            moves: ['d4', 'f5'] },
  { eco: 'A40', name: "Modern Defense",           moves: ['d4', 'g6'] },

  // ─── Replies to 1.c4 ───
  { eco: 'A20', name: "English, King's Pawn",     moves: ['c4', 'e5'] },
  { eco: 'A30', name: "English, Symmetrical",     moves: ['c4', 'c5'] },
  { eco: 'A15', name: "English, Anglo-Indian",    moves: ['c4', 'Nf6'] },

  // ─── Replies to 1.Nf3 ───
  { eco: 'A04', name: "Réti, ...d5",              moves: ['Nf3', 'd5'] },
  { eco: 'A05', name: "Réti, ...Nf6",             moves: ['Nf3', 'Nf6'] },

  // ─── Open Game branches ───
  { eco: 'C40', name: "King's Knight Opening",    moves: ['e4', 'e5', 'Nf3'] },
  { eco: 'C25', name: "Vienna Game",              moves: ['e4', 'e5', 'Nc3'] },
  { eco: 'C30', name: "King's Gambit",            moves: ['e4', 'e5', 'f4'] },
  { eco: 'C40', name: "King's Knight Opening",    moves: ['e4', 'e5', 'Nf3', 'Nc6'] },
  { eco: 'C42', name: "Petroff Defense",          moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { eco: 'C40', name: "Latvian Gambit",           moves: ['e4', 'e5', 'Nf3', 'f5'] },

  // ─── Italian / Spanish ───
  { eco: 'C50', name: "Italian Game",             moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { eco: 'C60', name: "Ruy Lopez",                moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'C44', name: "Scotch Game",              moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'C46', name: "Three Knights Game",       moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3'] },
  { eco: 'C53', name: "Italian, Classical (Bc5)", moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
  { eco: 'C55', name: "Italian, Two Knights",     moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { eco: 'C65', name: "Ruy Lopez, Berlin Defense",moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'] },
  { eco: 'C60', name: "Ruy Lopez, Morphy Defense",moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'] },
  { eco: 'C68', name: "Ruy Lopez, Exchange",      moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6'] },
  { eco: 'C78', name: "Ruy Lopez, Closed",        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4'] },
  { eco: 'C45', name: "Scotch, Open",             moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4'] },

  // ─── Sicilian variations ───
  { eco: 'B27', name: "Sicilian, Open",           moves: ['e4', 'c5', 'Nf3'] },
  { eco: 'B23', name: "Sicilian, Closed",         moves: ['e4', 'c5', 'Nc3'] },
  { eco: 'B22', name: "Sicilian, Alapin",         moves: ['e4', 'c5', 'c3'] },
  { eco: 'B27', name: "Sicilian, Najdorf path",   moves: ['e4', 'c5', 'Nf3', 'd6'] },
  { eco: 'B30', name: "Sicilian, Open",           moves: ['e4', 'c5', 'Nf3', 'Nc6'] },
  { eco: 'B40', name: "Sicilian, Open",           moves: ['e4', 'c5', 'Nf3', 'e6'] },
  { eco: 'B50', name: "Sicilian, Najdorf path",   moves: ['e4', 'c5', 'Nf3', 'd6', 'd4'] },
  { eco: 'B50', name: "Sicilian, Open",           moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4'] },
  { eco: 'B50', name: "Sicilian, Open",           moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'] },
  { eco: 'B90', name: "Sicilian, Najdorf",        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { eco: 'B70', name: "Sicilian, Dragon",         moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'] },
  { eco: 'B80', name: "Sicilian, Scheveningen",   moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e6'] },

  // ─── French Defense variations ───
  { eco: 'C00', name: "French Defense",           moves: ['e4', 'e6', 'd4'] },
  { eco: 'C00', name: "French Defense",           moves: ['e4', 'e6', 'd4', 'd5'] },
  { eco: 'C02', name: "French, Advance",          moves: ['e4', 'e6', 'd4', 'd5', 'e5'] },
  { eco: 'C10', name: "French, Paulsen",          moves: ['e4', 'e6', 'd4', 'd5', 'Nc3'] },
  { eco: 'C01', name: "French, Exchange",         moves: ['e4', 'e6', 'd4', 'd5', 'exd5'] },

  // ─── Caro-Kann variations ───
  { eco: 'B10', name: "Caro-Kann Defense",        moves: ['e4', 'c6', 'd4'] },
  { eco: 'B10', name: "Caro-Kann Defense",        moves: ['e4', 'c6', 'd4', 'd5'] },
  { eco: 'B12', name: "Caro-Kann, Advance",       moves: ['e4', 'c6', 'd4', 'd5', 'e5'] },
  { eco: 'B15', name: "Caro-Kann, Main",          moves: ['e4', 'c6', 'd4', 'd5', 'Nc3'] },
  { eco: 'B13', name: "Caro-Kann, Exchange",      moves: ['e4', 'c6', 'd4', 'd5', 'exd5'] },

  // ─── Queen's Gambit family ───
  { eco: 'D06', name: "Queen's Gambit",           moves: ['d4', 'd5', 'c4'] },
  { eco: 'D02', name: "Queen's Pawn, Nf3",        moves: ['d4', 'd5', 'Nf3'] },
  { eco: 'D02', name: "London System path",       moves: ['d4', 'd5', 'Nf3', 'Nf6'] },
  { eco: 'D02', name: "London System",            moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4'] },
  { eco: 'D20', name: "Queen's Gambit Accepted",  moves: ['d4', 'd5', 'c4', 'dxc4'] },
  { eco: 'D30', name: "Queen's Gambit Declined",  moves: ['d4', 'd5', 'c4', 'e6'] },
  { eco: 'D10', name: "Slav Defense",             moves: ['d4', 'd5', 'c4', 'c6'] },

  // ─── Indian Defenses ───
  { eco: 'A45', name: "Indian Game",              moves: ['d4', 'Nf6', 'Nf3'] },
  { eco: 'A45', name: "Indian Game",              moves: ['d4', 'Nf6', 'c4'] },
  { eco: 'E00', name: "Indian Game (c4 e6)",      moves: ['d4', 'Nf6', 'c4', 'e6'] },
  { eco: 'E20', name: "Nimzo-Indian Defense",     moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'E12', name: "Queen's Indian Defense",   moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'] },
  { eco: 'E60', name: "King's Indian Defense",    moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'E60', name: "King's Indian Defense",    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3'] },
  { eco: 'E60', name: "King's Indian Defense",    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'] },
  { eco: 'E70', name: "King's Indian, Classical", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4'] },
  { eco: 'D80', name: "Grünfeld Defense",         moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
]

const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ')

// Per-position move weights (approximating master-game frequencies).
// Keys are computed by replaying these short lines with chess.js so they
// always match what chess.js produces at runtime (including ep normalization).
const weightedLines = [
  // [moves leading to position, { san: weight, ... }]
  [[],          { 'e4': 40, 'd4': 35, 'Nf3': 12, 'c4': 10, 'g3': 3 }],
  [['e4'],      { 'c5': 35, 'e5': 30, 'e6': 12, 'c6': 10, 'd6': 5, 'd5': 5, 'Nf6': 3 }],
  [['d4'],      { 'Nf6': 50, 'd5': 35, 'f5': 5, 'g6': 5, 'e6': 5 }],
  [['c4'],      { 'Nf6': 35, 'e5': 25, 'c5': 25, 'e6': 10, 'g6': 5 }],
  [['Nf3'],     { 'Nf6': 40, 'd5': 35, 'c5': 15, 'g6': 10 }],
  [['e4','e5'], { 'Nf3': 70, 'Nc3': 15, 'Bc4': 10, 'f4': 5 }],
  [['e4','e5','Nf3'],     { 'Nc6': 60, 'Nf6': 30, 'd6': 7, 'f5': 3 }],
  [['e4','e5','Nf3','Nc6'], { 'Bb5': 50, 'Bc4': 30, 'd4': 15, 'Nc3': 5 }],
  [['e4','e5','Nf3','Nc6','Bb5'],      { 'a6': 70, 'Nf6': 25, 'f5': 5 }],
  [['e4','e5','Nf3','Nc6','Bb5','a6'], { 'Ba4': 75, 'Bxc6': 25 }],
  [['e4','e5','Nf3','Nc6','Bc4'],      { 'Bc5': 50, 'Nf6': 40, 'Be7': 10 }],
  [['e4','c5'],           { 'Nf3': 70, 'Nc3': 15, 'c3': 10, 'd4': 5 }],
  [['e4','c5','Nf3'],     { 'd6': 40, 'Nc6': 30, 'e6': 25, 'g6': 5 }],
  [['e4','c5','Nf3','d6'],{ 'd4': 75, 'Bb5+': 15, 'c3': 10 }],
  [['d4','d5'],           { 'c4': 60, 'Nf3': 25, 'Bf4': 10, 'Nc3': 5 }],
  [['d4','d5','c4'],      { 'e6': 40, 'c6': 30, 'dxc4': 25, 'Nf6': 5 }],
  [['d4','Nf6'],          { 'c4': 60, 'Nf3': 25, 'Bg5': 10, 'Bf4': 5 }],
  [['d4','Nf6','c4'],     { 'e6': 40, 'g6': 35, 'c5': 15, 'd5': 10 }],
  [['d4','Nf6','c4','g6'],{ 'Nc3': 70, 'Nf3': 20, 'g3': 10 }],
  [['d4','Nf6','c4','g6','Nc3'], { 'Bg7': 60, 'd5': 35, 'd6': 5 }],
]

// Convert weightedLines into a FEN-keyed dictionary.
const responseWeights = {}
for (const [path, weights] of weightedLines) {
  const g = new Chess()
  for (const m of path) g.move(m)
  responseWeights[fenKey(g.fen())] = weights
}

// ─── Build the openings dictionary ───
// For each line:
//   - Walk through positions and accumulate candidate moves at each step.
//   - Attach the line's name ONLY to the position AFTER all its moves are played.
//   - When multiple lines name the same endpoint, the one with more moves wins
//     (most specific naming).
const openings = {}

for (const { eco, name, moves } of lines) {
  const game = new Chess()

  for (let i = 0; i < moves.length; i++) {
    const fen = fenKey(game.fen())
    const san = moves[i]

    if (!openings[fen]) openings[fen] = { name: null, eco: null, moves: [], _depth: 0 }
    if (!openings[fen].moves.find((m) => m.san === san)) {
      const weight = responseWeights[fen]?.[san] ?? 10
      openings[fen].moves.push({ san, weight })
    }

    const result = game.move(san)
    if (!result) {
      console.error(`Invalid move ${san} in line ${name} (after ${moves.slice(0, i).join(' ')})`)
      console.error(`Position: ${game.fen()}`)
      break
    }
  }

  // Name the endpoint position. More specific (longer) lines win ties.
  const endFen = fenKey(game.fen())
  if (!openings[endFen]) openings[endFen] = { name: null, eco: null, moves: [], _depth: 0 }
  if (openings[endFen].name === null || moves.length > openings[endFen]._depth) {
    openings[endFen].name = name
    openings[endFen].eco = eco
    openings[endFen]._depth = moves.length
  }
}

// Sort moves by weight descending; strip internal _depth.
for (const k of Object.keys(openings)) {
  openings[k].moves.sort((a, b) => b.weight - a.weight)
  delete openings[k]._depth
  // Drop positions with no candidate moves AND no name (shouldn't happen, defensive).
  if (openings[k].moves.length === 0 && !openings[k].name) {
    delete openings[k]
  }
}

console.log(`Generated ${Object.keys(openings).length} book positions`)

writeFileSync('opening/openings.json', JSON.stringify(openings, null, 2))
console.log('Wrote opening/openings.json')
