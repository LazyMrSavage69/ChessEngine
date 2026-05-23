cat > /mnt/user-data/outputs/PROMPT.md << 'ENDOFFILE'
# Master Prompt — Chess Engine WebApp (with Opening Book + Game Review)

---

## Role
You are an expert software engineer specializing in chess programming, browser-based game development, and high-performance JavaScript. You have deep knowledge of chess engine theory (alpha-beta pruning, iterative deepening, evaluation functions), opening theory (ECO codes, Polyglot book format), and game analysis (centipawn loss, move classification).

---

## Project
Build a complete, interactive, browser-based chess application where:
- The user plays against a custom JavaScript chess engine
- The engine responds to openings using a built-in opening book
- After the game, a full review panel classifies every move

Read `CONTEXT.md` for full feature scope and `claudeMind.md` for engine architecture, opening book format, review logic, code patterns, and known bugs before writing any code.

---

## Core Requirements

### 1. Interactive Chess Board
- 8×8 board with alternating squares
- SVG or Unicode chess pieces
- Click-to-move AND drag-to-move
- Legal move highlighting (dots or highlights on valid squares)
- Last move highlight (from + to squares)
- FLIP animation for piece movement (see claudeMind.md)
- Pawn promotion dialog
- Board flip option (play as Black)

### 2. Chess Engine (Web Worker)
Implement in this order:
1. Board via chess.js (FEN, move validation, game state)
2. Legal move generation (chess.js handles this)
3. Move ordering — MVV-LVA captures first
4. Minimax + Alpha-Beta pruning
5. Iterative deepening (depths 1–6)
6. Quiescence search (captures only at leaf nodes)
7. Transposition table (Zobrist hashing)
8. Evaluation: material values + piece-square tables (PST)

### 3. Opening Book
- JSON lookup table keyed by FEN (position part only — strip move clocks)
- Cover at minimum: Ruy Lopez, Sicilian Defense (Najdorf, Dragon), Queen's Gambit, King's Indian, French Defense, Caro-Kann, Scotch, London System, Italian Game
- Each entry: `{ name, eco, moves[] }` — pick randomly from moves[] for variety
- When a book move is played → show opening name + ECO code in a UI banner/toast
- Track the last known opening name; keep it visible in the game header
- Fall through to engine search when position is out of book

### 4. Material Count Panel
- Show captured piece icons, grouped by type
- Show material advantage score per side (e.g. "+3")
- Update live after every move

### 5. Game Controls
- New Game, Flip Board, Undo Move (full move: player + engine)
- Difficulty selector: Beginner / Easy / Medium / Hard / Expert
- Side selector: White / Black
- "Review Game" button (active after game ends or manually triggered)

### 6. Engine Info Panel (collapsible)
- Search depth, nodes evaluated, eval score (centipawns), best move
- Show "Book Move" when playing from opening book

### 7. Post-Game Review Panel
Triggered after game ends (or on "Review Game" click). Runs in Web Worker.

**Panel must include:**
- Opening name + ECO code at top
- Per-player accuracy percentage (Lichess formula: `100 * exp(-0.00375 * avgCpLoss)`)
- Full annotated move list, two-column (White | Black)
  - Each move shows: notation, classification icon, cp-loss if significant
  - Hovering/clicking a move jumps board to that position
- If a move was a Blunder or Mistake: show what the best move was
- Summary stats row: count of Best ✅ / Good 👍 / Inaccuracy ⚠️ / Mistake ❌ / Blunder 💀
- Progress bar while analysis runs (it takes time)
- "Step through" navigation: ← → arrows to walk through the game

**Move Classification (centipawn delta from best move):**
| Label | Delta | Icon | Color |
|-------|-------|------|-------|
| Best / Book | 0 (exact or book) | ✅ | green |
| Good | ≤ 30 cp | 👍 | light green |
| Inaccuracy | 31–100 cp | ⚠️ | orange |
| Mistake | 101–300 cp | ❌ | red |
| Blunder | > 300 cp | 💀 | purple |

---

## Technical Constraints
- **Self-contained**: No backend. Everything in the browser.
- **Non-blocking**: Engine search AND game review MUST run in Web Worker
- **chess.js**: Use for all move validation, FEN generation, game-over detection
- **Opening book**: JSON file imported at startup (not fetched at runtime)
- **No TypeScript required** (plain JS is fine; ES modules preferred)
- **Responsive**: Board scales to viewport; review panel is scrollable

---

## Web Worker Message Protocol
```
Main → Worker:
  { type: 'search',  fen, depth }
  { type: 'review',  history }       // history = [{ fen, move, player }]
  { type: 'cancel' }

Worker → Main:
  { type: 'bestmove',        move }
  { type: 'book_move',       move, name, eco }
  { type: 'info',            depth, score, nodes, move }
  { type: 'review_done',     annotations }
  { type: 'review_progress', index, total }
```

---

## Output Format
Produce the complete application as runnable files:

1. `index.html` — entry point
2. `style.css` — board + UI + review panel styling
3. `main.js` — app orchestration
4. `board.js` — board rendering + animations
5. `engine/worker.js` — Web Worker (search + review)
6. `engine/search.js` — alpha-beta + iterative deepening
7. `engine/evaluate.js` — evaluation + PSTs
8. `engine/tt.js` — transposition table
9. `opening/book.js` — book lookup logic
10. `opening/openings.json` — opening database
11. `review/reviewer.js` — post-game analysis
12. `review/classify.js` — move classification + accuracy
13. `ui/material.js` — material count
14. `ui/reviewPanel.js` — review panel rendering

If producing a single-file artifact, embed all JS + CSS inline.

---

## Build Order (follow this sequence)

```
Phase 1 — Playable Board
  ✓ Render board + pieces (chess.js)
  ✓ Click/drag to move with legal move highlighting
  ✓ Game over detection + status display

Phase 2 — Opening Book
  ✓ openings.json with 10+ openings
  ✓ book.js lookup by FEN key
  ✓ Opening name banner in UI
  ✓ Book move played instantly (no search)

Phase 3 — Engine Search
  ✓ Web Worker setup
  ✓ Random → Minimax → Alpha-Beta
  ✓ Iterative deepening + quiescence
  ✓ Transposition table
  ✓ MVV-LVA move ordering
  ✓ PST evaluation

Phase 4 — Post-Game Review
  ✓ Record full game history (FEN + move per ply)
  ✓ Review Worker: re-search each position at depth 4
  ✓ classify.js: delta → label + icon
  ✓ accuracy() calculation
  ✓ reviewPanel.js: annotated move list, stats, step-through
  ✓ Progress bar during analysis

Phase 5 — Polish
  ✓ Material count panel
  ✓ Difficulty + side controls
  ✓ Undo move (full move)
  ✓ Flip board
  ✓ FLIP piece animation
  ✓ Engine info panel
```

---

## Opening Book JSON Schema
```json
{
  "<FEN position, first 4 space-delimited tokens>": {
    "name": "Sicilian Defense, Najdorf Variation",
    "eco": "B96",
    "moves": ["Bg5", "Be3", "f4"]
  }
}
```
Strip the last two FEN fields (halfmove clock + fullmove number) before lookup:
```javascript
const key = fen.split(' ').slice(0, 4).join(' ')
```

---

## Evaluation Reference
```javascript
const PIECE_VALUES = { p:100, n:320, b:330, r:500, q:900, k:20000 }

// Pawn PST (white perspective, rank 8 at index 0)
const PAWN_PST = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0
]
```

---

## Accuracy Formula
```javascript
// Lichess-style accuracy (per player, over their own moves only)
function accuracy(annotations) {
  const cpLosses = annotations.map(a => Math.max(0, a.delta))
  const avg = cpLosses.reduce((s, v) => s + v, 0) / cpLosses.length
  return Math.round(100 * Math.exp(-0.00375 * avg))
}
```

---

## Design Aesthetic
- **Theme**: Dark, refined, tournament-hall aesthetic — deep navy/charcoal backgrounds
- **Board**: Classic wooden look (e.g. `#f0d9b5` / `#b58863`) OR clean monochrome
- **Pieces**: Open-source SVG set (Cburnett or Alpha style)
- **Review panel**: Monospace font for move notation; color-coded icons
- **Animations**: Smooth piece slides (200–300ms); subtle square highlights
- **Typography**: Elegant serif or refined sans; never Arial or system fonts
- **No clutter**: Board is center stage; panels are secondary

---

## When Stuck
- `claudeMind.md` — engine pseudocode, book format, review logic, common bugs
- `CONTEXT.md` — feature scope, data flow, file structure
- Chess Programming Wiki: https://www.chessprogramming.org
- chess.js docs: https://github.com/jhlywa/chess.js
- ECO codes reference: https://www.365chess.com/eco.php
ENDOFFILE
echo "PROMPT.md done"