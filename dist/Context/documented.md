# ChessEngine — Engineer Preview

This document provides a concise software-engineer-oriented overview of the ChessEngine project, including goals, architecture, key modules, how to run the project locally, development notes, and suggested next steps.

## Elevator pitch

ChessEngine is a compact, browser-based chess engine and UI built with vanilla JavaScript. It contains the core engine components (evaluation, search, transposition table, hashing) in the `engine/` folder, an opening book in `opening/`, and lightweight UI utilities under `ui/`. The project is designed for experimentation, review workflows, and quick iteration on search/evaluation heuristics.

## Goals

- Provide a self-contained chess engine that runs in the browser (no native binaries). 
- Keep the codebase small and readable to support research and education on search and evaluation techniques.
- Support evaluation, search tuning, and opening book playback.

## High-level architecture

- Browser UI (root-level `index.html`, `main.js`, `board.js`, `style.css`) renders the board and interacts with the engine.
- Engine (folder `engine/`) exposes evaluation, search, and supporting data structures. It can be run on the main thread or spawned as a worker (`engine/worker.js`).
- Opening book (`opening/`) is used to provide book moves or sample positions.
- Review utilities (`review/`) provide classification and reviewer tooling for analyzing games or positions.

## Key files and responsibilities

- `index.html` — entrypoint / demo UI.
- `main.js` — bootstraps the app, wires UI to engine and book.
- `board.js` — board representation and possibly move generation / parsing utilities used by the UI and engine.
- `engine/evaluate.js` — evaluation function: material, piece-square tables, positional heuristics.
- `engine/search.js` — core search logic. Typical techniques expected: iterative deepening, alpha–beta/negamax, quiescence, move ordering.
- `engine/tt.js` — transposition table implementation (hash -> search results cache).
- `engine/zobrist.js` — Zobrist hashing for board state keys.
- `engine/history.js` — history heuristic to bias move ordering.
- `engine/killers.js` — killer-move heuristic (fast move ordering improvement for alpha–beta).
- `engine/worker.js` — wrapper for running the engine in a Web Worker.
- `opening/book.js`, `opening/openings.js` — opening book data and helper functions.
- `ui/` — `evalBar.js`, `material.js`, `reviewPanel.js` — UI components for displaying evaluation, material balance, and review panels.
- `review/` — `classify.js`, `reviewer.js` — tooling for labeling positions and automated reviewing.
- `generate_book.mjs` — tooling to generate or preprocess book data.
- `scratch_test.js` — playground / quick tests.
- `IMPLEMENTATION_STATUS.md` — current TODOs and feature status.

## How to run (developer-friendly)

Quick static preview (works cross-platform):

- Option A — open directly: open `index.html` in a browser for basic demos (some browsers restrict local worker imports when opened via file://).
- Option B — local static server (recommended):

  - Using Node (if you have http-server installed or npx):

    npx http-server -c-1 .

  - Or using Python:

    python -m http.server 8000

Then open http://localhost:8080 (or the port shown) and interact with the demo.

## Developer notes & patterns

- Move generation and board representation are central; changing them affects evaluation, hashing, TT, and search.
- Zobrist keys in `engine/zobrist.js` ensure fast, unique table lookups — any change to piece or side encodings requires regenerating keys consistently.
- Transposition table entries should store: depth, score, best move, and node type (exact, lower, upper) to support alpha–beta bounds correctly.
- The engine is designed to be run in a worker — prefer that for long searches to avoid blocking the UI.

## Testing and debugging

- Use `scratch_test.js` to run small, ad-hoc tests and to validate move generation and evaluation.
- Add unit tests for critical modules (Zobrist hashing collisions, TT read/write, search completing to fixed depth) when expanding the project.

## Known limitations (typical for this code layout)

- Likely missing perft test harness — add `perft` to validate move-generation correctness to a fixed depth.
- No formal test suite (unit/integration) included by default.
- Some heuristics (quiescence, null-move pruning, aspiration windows) may not be implemented or may be partial — inspect `engine/search.js` to confirm and extend.

## Contribution & extension ideas

- Add a `tests/` folder with perft positions and automated tests run by a small Node test runner.
- Add benchmark harness to measure nodes/sec for different depths and compare heuristics.
- Implement persistent opening book format and a small UI to inspect book lines.
- Expose a minimal CLI harness (Node script) so engine can be used headless for automated matches.

## Quick checklist for new contributors

- [ ] Run `index.html` locally to verify UI loads.
- [ ] Run `scratch_test.js` to exercise core functions.
- [ ] Add a perft test and verify move-generation correctness.
- [ ] Add README sections with development and testing commands (if not already present).

## Contact and context

See `README.md` for user-level documentation and `IMPLEMENTATION_STATUS.md` for feature and progress tracking. Use comments in each `engine/*.js` file to find implementation details and hotspots for optimization.

---

This `documented.md` is intended as a concise engineer-facing orientation document to help contributors quickly understand the architecture, where to look for core algorithms, and what to run locally. Update this file as implementation details change.
