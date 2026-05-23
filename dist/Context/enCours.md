# Implementation Progress — newPrompt.md

All 6 changes implemented + verified. This file is the running summary; pick it up if you need to extend or debug.

## Status overview

- [x] CHANGE 1 — Fix material points (engine/evaluate.js)
- [x] CHANGE 2 — Pure classifyMove() + worker classify handler
- [x] CHANGE 3 — Login system (auth/auth.js, auth/admin.js, admin.html)
- [x] CHANGE 4 — Snapshot-based Undo/Redo
- [x] CHANGE 5 — Save completed games (gzip → Base64 → Supabase)
- [x] CHANGE 6 — Deployment readiness (CDN-loaded chess.js & supabase, build.js, vercel.json)
- [x] CHANGE 7 — Threefold repetition + clearer draw banners (added on user request)

## Files added

- `auth/auth.js` — login + one-time code gate (validates code BEFORE auth)
- `auth/admin.js` — admin code generator (role-gated by `profiles.role='admin'`)
- `admin.html` — admin page (loads supabase CDN + auth/admin.js)
- `games/saveGame.js` — buildGameMD + compressToBase64 + decompressFromBase64 + saveGame
- `config.js` — env-var placeholders (`__SUPABASE_URL__`, `__SUPABASE_ANON_KEY__`)
- `build.js` — Vercel build: copies project into `dist/` and patches config.js
- `vercel.json` — rewrites `/admin` → admin.html, `/(.*)` → index.html (SPA fallback)
- `.env.example`
- `supabaseClient.js` — single shared Supabase client (reads from config.js)

## Files modified

- `engine/evaluate.js` — clarified negamax convention; mobility now benefits side-to-move
- `engine/search.js` — CDN import; added `searchTopMoves()` + `searchObviousMove()`
- `engine/worker.js` — CDN import; added `classify` message handler with sacrifice detection
- `review/classify.js` — added pure `classifyMove()` + `annotationToClassification()`; legacy classify() kept for review panel
- `review/reviewer.js` — CDN import; accepts `.san` (preferred) or `.moveSan` (legacy)
- `ui/reviewPanel.js` — added `renderMyGamesTab()` with SAN-regex replay viewer
- `main.js` — auth gate, snapshot undo/redo, classify dispatch, saveGame on game-over, tab switching
- `board.js` — drop bare chess.js import (uses global `Chess`); added `restoreFEN(fen)`
- `index.html` — chess.js + Supabase via CDN; login screen; redo button; tabs (Review / My Games); logout
- `style.css` — appended ~370 lines: login, admin, tabs, undo/redo disabled state, games list, replay viewer
- `package.json` — `dev` / `build` / `preview` scripts via `http-server`; removed npm chess.js dep

## Key design decisions

- **chess.js loading**: Main-thread files (main.js, board.js, ui/reviewPanel.js) use the global `Chess` set by the CDN `<script>` tag in index.html. Engine/Worker files (worker.js, search.js, reviewer.js) can't see `window`, so they use a full-URL ES-module import: `https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm`. Either approach is bundler-free; bare imports are gone.
- **Supabase client**: Loaded via CDN script tag → `window.supabase` namespace. `supabaseClient.js` calls `window.supabase.createClient(URL, KEY)` exactly once and re-exports the instance. All other files import `{ supabase } from '/supabaseClient.js'` — never re-initialize.
- **Access-code-first login**: `auth/auth.js` queries `access_codes` for a matching unused row BEFORE calling `signInWithPassword` / `signUp`. This avoids creating orphan auth users for invalid codes.
- **Undo/Redo**: Snapshot array of FEN strings, `currentIndex` cursor. New move from a rewound state truncates redo history (linear timeline). After undo, the engine does NOT auto-move.
- **Live classification**: After every player move, main.js posts `{ type:'classify', fenBefore, fenAfter, playedMove }` to the worker. The worker computes top-3 + obvious + sacrifice, calls `classifyMove()` (pure), and posts `{ type:'classified', annotation }` back. Main thread renders an inline badge next to the SAN in the move list.
- **gameHistory schema**: Each entry is `{ fen, san, player }` (renamed from `moveSan` → `san`). `reviewer.js` accepts both names so older callers don't break.
- **Sacrifice detection** (worker.js): `(attacker > victim)` OR `(destination has no friendly defender after the move)`. False positives are tolerated because `classifyMove()` additionally requires near-zero cp loss + winning eval before stamping `!!`.
- **Threefold repetition** (CHANGE 7): chess.js's `isThreefoldRepetition()` only works when all moves are applied to one Chess instance via `.move()`. main.js does `game = new Chess(fen)` after every player move and `game.load(fen)` after undo/redo, both of which wipe chess.js's internal history → `isThreefoldRepetition()` always returned false in practice (verified). Fix: snapshot-based `repetitionKey(fen)` (FEN minus halfmove/fullmove) + `repetitionCountAt(idx)` walking the `snapshots[]` array. `checkGameOver()` checks our counter first, with chess.js's own check as a fallback. Game-over banners now distinguish: stalemate / threefold / insufficient material / 50-move rule (each labelled "égalité"). Stalemate + en passant already worked natively in chess.js — verified in `_verify_draws.mjs`.

## Verifications run

- `node --check` on every JS file → all parse
- Negamax sign test: KQ vs K, white to move = +937; black to move = -889 ✅
- `classifyMove()` truth table: 6/6 cases pass ✅
- gzip → base64 → unzip round-trip on a sample MD: matches ✅
- SAN regex replay (incl. `O-O-O`, `cxd4`, `Nbd7`): 22/22 tokens replayed ✅
- `node build.js` with env vars → emits `dist/` with patched `dist/config.js` ✅
- Snapshot threefold counter: 8 knight shuffles → position counted 3× → draw triggered ✅
- Stalemate (KQ vs K, BTM, no legal moves): `isStalemate()` = true ✅
- En passant: e4 a6 e5 d5 → exd6 e.p. removes the d5 pawn ✅

## Required Supabase schema (NOT auto-created)

The prompt explicitly forbids adding schema/SQL, but for documentation:

```sql
-- access_codes
create table access_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code  text not null,
  used  boolean not null default false,
  created_at timestamptz not null default now()
);

-- profiles  (one row per auth.user, with a role flag)
create table profiles (
  id   uuid primary key references auth.users on delete cascade,
  role text default 'user'
);

-- games  (compressed move history per user)
create table games (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade,
  moves_gz   text not null,        -- base64(gzip(MD))
  result     text,
  move_count integer,
  played_at  timestamptz not null default now()
);
```

Plus RLS policies that:
- allow anon to SELECT a row from `access_codes` matching `(email,code,used=false)`
- allow authenticated UPDATE on `access_codes` to set `used=true` for own row
- allow `profiles.role='admin'` users full access to `access_codes`
- allow each user to read own `profiles.role`
- allow each user to read/insert their own `games` row

## Known follow-ups

- `generate_book.mjs` still has `import { Chess } from 'chess.js'` (line 4). It's an offline build-time tool (regenerates `opening/openings.json`), runs under Node only. If the user wants to regenerate the opening book they must `npm install chess.js` (no longer in package.json). I left it alone since it doesn't affect the runtime app.
- `IMPLEMENTATION_STATUS.md` and `claudeMind.md` reference older architecture (e.g. bare `chess.js` import in worker, no auth, etc.). They're docs-only and out of scope for this prompt — leave them or update later.
