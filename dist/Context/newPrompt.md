You are working on ChessEngine, a browser-based vanilla JavaScript chess engine.
The project structure is described below. Apply ALL of the following changes in full.
Do not skip any section. Add inline comments explaining non-obvious logic.
Supabase is already configured and connected — do NOT add any schema setup,
client initialization, or connection instructions. Use the existing supabase client directly.

---

## PROJECT STRUCTURE (current)

/
├── engine/
│   ├── evaluate.js       — evaluation function
│   ├── search.js         — alpha-beta / negamax search
│   ├── tt.js             — transposition table
│   ├── zobrist.js        — Zobrist hashing
│   ├── history.js        — history heuristic
│   ├── killers.js        — killer move heuristic
│   └── worker.js         — Web Worker wrapper
├── opening/
│   ├── book.js
│   └── openings.js
├── ui/
│   ├── evalBar.js
│   ├── material.js
│   └── reviewPanel.js
├── review/
│   ├── classify.js
│   └── reviewer.js
├── generate_book.mjs
├── scratch_test.js
├── index.html
├── main.js
├── board.js
└── style.css

---

## CHANGE 1 — FIX: Material points are inverted

File: `engine/evaluate.js`

The material score is currently assigned from the wrong perspective.
The engine is accumulating the human player's material as its own advantage, causing
it to play to benefit the opponent.

Fix:
- `evaluate()` must return a score from the side-to-move's perspective (negamax convention).
  Positive = side to move is winning. Negative = side to move is losing.
- For each piece, add its value to the score if it belongs to side-to-move,
  subtract if it belongs to the opponent.
- Piece-square table (PST) lookups must be mirrored correctly per color:
  - For White: index the PST as-is (rank 0 = rank 1 from White's view).
  - For Black: mirror the rank index (rank = 7 - rank) before looking up the PST.
- After fixing, verify the sign by checking: an empty board with one extra White queen
  should return a large positive value when it is White's turn,
  and a large negative value when it is Black's turn.
- Add a comment above evaluate() explaining the negamax sign convention.

---

## CHANGE 2 — IMPROVE: Great/Brilliant move detection (Stockfish-style)

File: `review/classify.js`

**Architecture note**: `classify.js` must NOT call the engine directly. The engine runs
inside a Web Worker and communicates via postMessage. Instead, `classifyMove()` receives
pre-computed scores and move lists as arguments — the Worker computes everything and passes
results here for classification only.

Replace any existing heuristic with the following centipawn-loss + context method.

Implement and export:

```javascript
/**
 * Classifies a played move based on centipawn loss and context.
 *
 * All scores are from the moving side's perspective (positive = moving side winning).
 * The Worker is responsible for computing these scores before calling this function.
 *
 * @param {number} bestScore      - Score of the best available move from full-depth search
 *                                  (from the moving side's perspective, before the move)
 * @param {number} playedScore    - Score after the played move, negated back to moving side's
 *                                  perspective (i.e. -engineScore after the move)
 * @param {object} playedMove     - { from, to, promotion } — the move that was made
 * @param {object} obviousMove    - The top move from a depth-1 search (the "obvious" reply)
 * @param {object[]} topMoves     - Top 3 moves from full-depth search: [{ from, to }, ...]
 * @param {boolean} isSacrifice   - Whether the move lands on an undefended square or captures
 *                                  a lower-value piece with a higher-value piece (computed in Worker)
 * @returns {string} '!!', '!', '', '?!', '?', '??'
 */
export function classifyMove(bestScore, playedScore, playedMove, obviousMove, topMoves, isSacrifice) {
  // cploss is always >= 0: how many centipawns worse than best the played move was
  const cploss = bestScore - playedScore;

  const isObvious = obviousMove &&
    obviousMove.from === playedMove.from &&
    obviousMove.to   === playedMove.to;

  const isInTop3 = topMoves.some(m =>
    m.from === playedMove.from && m.to === playedMove.to
  );

  // Brilliant: near-zero loss, is a sacrifice, and gives clear advantage
  if (cploss < 10 && isSacrifice && playedScore > 100) return '!!';

  // Great: low loss, non-obvious, but still in engine's top 3
  if (cploss < 20 && !isObvious && isInTop3) return '!';

  // Standard classification by centipawn loss
  if (cploss <= 50)  return '';    // Good (no annotation)
  if (cploss <= 100) return '?!';  // Inaccuracy
  if (cploss <= 200) return '?';   // Mistake
  return '??';                      // Blunder
}
```

**Worker responsibilities** (update `engine/worker.js` to support classification):

When the worker receives a `{ type: 'classify', fenBefore, fenAfter, playedMove }` message:

1. Run full-depth search on `fenBefore` → get `bestScore` and `topMoves` (top 3).
2. Run depth-1 search on `fenBefore` → get `obviousMove`.
3. Run full-depth search on `fenAfter` → negate result → `playedScore`.
4. Compute `isSacrifice`:
   - True if the moved piece's value > the captured piece's value (captures lower with higher), OR
   - True if the destination square has no defending pieces (undefended square).
   - Use your existing piece value table for this check.
5. Call `classifyMove(bestScore, playedScore, playedMove, obviousMove, topMoves, isSacrifice)`.
6. Post result back: `{ type: 'classified', annotation, moveSan }`.

After each live game move, the main thread posts a classify message to the Worker and,
on receiving the result, displays the annotation badge next to the move in the move list.

---

## CHANGE 3 — ADD: Login system with one-time access codes

### Folder: `auth/`

Create two files: `auth/auth.js` and `auth/admin.js`.

---

### `auth/auth.js` — User-facing login

**Security-first flow** — the access code is validated BEFORE any auth account is touched:

**Login form fields**: email + password + access code (three fields).

```
Flow on submit:
1. Query access_codes table FIRST (before any auth):
     SELECT * FROM access_codes
     WHERE email = $email AND code = $inputCode AND used = false
     LIMIT 1
   - If no matching row → show "Invalid or already-used access code." Stop. Do not call signIn/signUp.

2. Only if a valid code row is found:
   a. Attempt supabase.auth.signInWithPassword({ email, password }).
   b. If that fails with "Invalid login credentials":
        → attempt supabase.auth.signUp({ email, password }).
        → If signUp also fails → show error, stop.
   c. On successful auth:
        → UPDATE access_codes SET used = true WHERE id = $code_id
        → Store session (Supabase handles this automatically).
        → Hide login form, show chess board.

3. On page load, check supabase.auth.getSession():
   - If valid session exists → also verify the user has at least one used=true code for their email.
     If yes → skip login, go directly to board.
     If no  → sign out and show login form (handles edge cases like manual DB edits).
   - If no session → show login form.

4. Add a "Logout" button: calls supabase.auth.signOut() then reloads the page.
```

**Why this order matters**: Creating a Supabase auth record is irreversible from the client.
By checking the code first, we avoid creating orphaned auth users for people who never had a valid code.

---

### `auth/admin.js` — Admin code generator

This is a separate protected page (`admin.html`).

**Admin protection on page load:**
```javascript
// On load, verify the logged-in user has the admin role before rendering anything.
const { data: { user } } = await supabase.auth.getUser();
if (!user) { window.location.href = '/index.html'; return; }

const { data: profile } = await supabase
  .from('profiles')
  .select('role')
  .eq('id', user.id)
  .single();

if (!profile || profile.role !== 'admin') {
  document.body.innerHTML = '<p>Access denied.</p>';
  return;
}
// Only render admin UI after this check passes.
```

**Admin UI flow:**
1. Show a form: email input + "Generate Code" button.
2. On submit:
   - Generate a code: `crypto.randomUUID()`.
   - Insert into access_codes: `{ email, code, used: false }`.
   - Display the generated code in a read-only text input with a "Copy" button
     (uses `navigator.clipboard.writeText(code)`).
   - Show confirmation: "Code generated for [email]. Share it once — it expires on first use."
3. Below the form, show a table of all access_codes rows (email, code, used, created_at)
   ordered by created_at descending. Refresh the table after each new code is generated.

---

## CHANGE 4 — FIX: Undo and Redo buttons

Files: `main.js`, `board.js`, UI buttons in `index.html`

The current undo/redo is broken. Replace it entirely with a snapshot-based system.

Implementation:

```javascript
const snapshots = [];   // array of FEN strings, one per half-move
let currentIndex = -1;  // points to the active position in snapshots

function saveSnapshot(fen) {
  // Discard any redo history when a new move is made
  snapshots.splice(currentIndex + 1);
  snapshots.push(fen);
  currentIndex = snapshots.length - 1;
  updateUndoRedoButtons();
}

function undo() {
  if (currentIndex <= 0) return;
  currentIndex--;
  restoreFEN(snapshots[currentIndex]);
  updateUndoRedoButtons();
  // IMPORTANT: Do NOT trigger engine move after undo — player decides what to do next.
}

function redo() {
  if (currentIndex >= snapshots.length - 1) return;
  currentIndex++;
  restoreFEN(snapshots[currentIndex]);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  document.getElementById('btn-undo').disabled = currentIndex <= 0;
  document.getElementById('btn-redo').disabled = currentIndex >= snapshots.length - 1;
}
```

- `restoreFEN(fen)` in `board.js` must fully reset: board state, turn, castling rights,
  en passant square, half-move clock, full-move number. Use `chess.load(fen)`.
- Call `saveSnapshot(chess.fen())` after every completed move (human or engine).
- Save the initial starting position as `snapshots[0]` at game start (before any move).
- After restoring a FEN, re-render the board and update the turn indicator correctly.
- Style the buttons: clearly greyed out + `cursor: not-allowed` when disabled,
  visually active with a hover state when available.

---

## CHANGE 5 — ADD: Save completed games (MD → gzip → Base64 → Supabase)

### When to trigger

When a game ends (checkmate, stalemate, resignation, or draw agreed):
call `saveGame(moveHistory, result)`.

---

### Step 1 — Build MD string in memory

```javascript
function buildGameMD(moveHistory, result) {
  const date = new Date().toISOString().split('T')[0];
  const lines = [`# Game — ${date}`, `**Result:** ${result}`, ''];

  let moveLine = '';
  moveHistory.forEach((move, i) => {
    if (i % 2 === 0) moveLine += `${Math.floor(i / 2) + 1}. `;
    moveLine += `${move.san} `;
    // Wrap lines at 80 chars for readability
    if (moveLine.length > 80) {
      lines.push(moveLine.trim());
      moveLine = '';
    }
  });
  if (moveLine.trim()) lines.push(moveLine.trim());

  return lines.join('\n');
}
```

Each move object in moveHistory must have a `.san` field (Standard Algebraic Notation,
e.g. "Nf3", "O-O", "exd5"). Verify that `chess.js` move objects include this field —
they do by default when using `chess.move()`. Ensure no move is stored without it.

---

### Step 2 — Compress with native CompressionStream (no libraries)

```javascript
async function compressToBase64(str) {
  const encoder = new TextEncoder();
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(encoder.encode(str));
  writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Convert binary to Base64 using btoa — safe for storage in TEXT/VARCHAR columns
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}
```

---

### Step 3 — Decompress for review

```javascript
async function decompressFromBase64(base64gz) {
  const binary = atob(base64gz);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  // Returns the original MD string
  return await new Response(stream.readable).text();
}
```

---

### Step 4 — Save to Supabase

```javascript
async function saveGame(moveHistory, result) {
  const rawMD = buildGameMD(moveHistory, result);
  const moves_gz = await compressToBase64(rawMD);
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from('games').insert({
    user_id: user.id,
    moves_gz,           // gzip-compressed, Base64-encoded MD string
    result,             // e.g. '1-0', '0-1', '1/2-1/2'
    move_count: moveHistory.length
  });

  if (error) console.error('Failed to save game:', error.message);
}
```

---

### Step 5 — Review panel ("My Games" tab)

In `ui/reviewPanel.js`, add a "My Games" tab alongside the existing review panel:

- On tab open: fetch all games for the current user:
  ```javascript
  supabase.from('games')
    .select('*')
    .eq('user_id', currentUserId)
    .order('played_at', { ascending: false })
  ```
- Display as a list: date, result, move count. Each row is clickable.
- On row click:
  1. Decompress `moves_gz` with `decompressFromBase64()`.
  2. Parse the MD string to extract SAN tokens — use a regex match,
     NOT a string split, to avoid fragmentation on move numbers:
     ```javascript
     // Matches standard SAN tokens including castling, promotions, check/mate markers.
     // This avoids the fragmentation bug caused by splitting on /\d+\.\s/.
     const tokens = mdString.match(
       /O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?/g
     ) || [];
     ```
  3. Replay the parsed move tokens on a fresh `chess.js` instance to reconstruct
     the full game, then display on the board with forward/back navigation.

---

## CHANGE 6 — Deployment readiness (Vercel + local http-server)

### Chess.js loading

**Do NOT use bare npm imports** (`import { Chess } from 'chess.js'`).
Bare imports require a bundler (Vite/Webpack) to resolve `node_modules`.
Since this project targets both `http-server` (no bundler) and Vercel (static),
load `chess.js` via CDN script tag in `index.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/chess.js@1.0.0/dist/chess.min.js"></script>
```

Then use the global `Chess` constructor: `const chess = new Chess();`

Remove any `import { Chess } from 'chess.js'` statements from all JS files.

---

### `vercel.json` (root)

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

### `.env.example` (root)

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

---

### `config.js` (root)

Inject environment variables at build time by having `build.js` replace placeholder
strings inside `config.js` (not `index.html`):

```javascript
// config.js — placeholders are replaced by build.js at deploy time.
// In development: edit these values directly or use .env.local conventions.
const SUPABASE_URL     = '__SUPABASE_URL__';
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';

export { SUPABASE_URL, SUPABASE_ANON_KEY };
```

---

### `build.js` (root) — replaces placeholders in config.js for Vercel

```javascript
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs';

// Replace env var placeholders in config.js
let config = readFileSync('config.js', 'utf8');
config = config
  .replace("'__SUPABASE_URL__'",      `'${process.env.SUPABASE_URL || ''}'`)
  .replace("'__SUPABASE_ANON_KEY__'", `'${process.env.SUPABASE_ANON_KEY || ''}'`);

// Copy everything to dist/, then overwrite config.js with the injected version
mkdirSync('dist', { recursive: true });
cpSync('.', 'dist', { recursive: true, filter: src => !src.includes('dist') && !src.includes('node_modules') });
writeFileSync('dist/config.js', config);

console.log('Build complete → dist/');
```

---

### `package.json` (root)

```json
{
  "name": "chess-engine",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev":     "npx http-server -c-1 .",
    "build":   "node build.js",
    "preview": "npx http-server -c-1 dist"
  }
}
```

---

### Additional requirements

- All file paths must be root-relative (`/engine/search.js`, not `./engine/search.js`).
- Web Worker must be instantiated as:
  ```javascript
  new Worker(new URL('/engine/worker.js', import.meta.url), { type: 'module' })
  ```
- Supabase JS client loaded via CDN in `index.html` (no npm required):
  ```html
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  ```
- Import `config.js` in a single init script and create one global `supabase` client.
  All other files use that shared client — never re-initialize.
- All Supabase calls must use the anon key + RLS policies. Never use the service key on the client.

---

## FINAL FILE STRUCTURE AFTER ALL CHANGES

```
/
├── auth/
│   ├── auth.js              ← NEW: user login + code validation (code checked first)
│   └── admin.js             ← NEW: admin code generator (role-protected)
├── engine/
│   ├── evaluate.js          ← FIXED: negamax sign convention
│   ├── search.js            ← UPDATED: exposes top 3 moves + depth-1 obvious move
│   ├── tt.js
│   ├── zobrist.js
│   ├── history.js
│   ├── killers.js
│   └── worker.js            ← UPDATED: handles 'classify' messages, computes isSacrifice
├── opening/
│   ├── book.js
│   └── openings.js
├── review/
│   ├── classify.js          ← REPLACED: pure classifyMove() — no engine calls
│   └── reviewer.js          ← UPDATED: uses decompress + SAN regex parser
├── ui/
│   ├── evalBar.js
│   ├── material.js
│   └── reviewPanel.js       ← UPDATED: My Games tab with decompress + replay
├── config.js                ← NEW: env var placeholders (replaced by build.js)
├── build.js                 ← NEW: Vercel build script
├── vercel.json              ← NEW
├── .env.example             ← NEW
├── package.json             ← NEW/UPDATED
├── admin.html               ← NEW: admin interface (role-gated)
├── index.html               ← UPDATED: chess.js + Supabase via CDN, auth gate
├── main.js                  ← UPDATED: snapshot undo/redo, saveGame(), classify dispatch
├── board.js                 ← UPDATED: restoreFEN(), SAN in move objects
└── style.css
```

---

## CONSTRAINTS

- Vanilla JavaScript only. No frameworks, no bundler required.
- No external compression libraries. Use native `CompressionStream` / `DecompressionStream` API only.
- No PGN format. Store moves as plain numbered move text inside a Markdown string.
- `chess.js` and Supabase JS client loaded via CDN `<script>` tags in `index.html`. No npm imports for either.
- Supabase is already connected — use the existing client instance everywhere.
  Do not re-initialize, do not add schema SQL, do not add connection boilerplate.
- The project must work after `npx http-server` locally and after `vercel deploy`.
- All Supabase calls must use the anon key + RLS policies. Never expose the service key client-side.
- After undo, the engine must NOT automatically play a move.
- One access code = one account activation. Once `used = true`, it cannot be reused.
- Access code must be validated BEFORE any Supabase auth call (signIn or signUp).
- `classify.js` must be a pure function module — no Worker messages, no engine calls inside it.
- Admin page must verify the `profiles.role = 'admin'` check server-side via Supabase RLS
  before rendering any admin UI.
- SAN move tokens must be extracted using regex matching, not string splitting.