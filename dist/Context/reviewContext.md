// reviewContext.ts

export type MoveClassification =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface MoveReview {
  moveNumber: number;
  playedMove: string;
  bestMove: string;
  evaluationBefore: number;
  evaluationAfter: number;
  evaluationLoss: number;
  classification: MoveClassification;
  accuracy: number;
  depth: number;
  principalVariation: string[];
  explanation: string;
}

export interface GameReview {
  whitePlayer: string;
  blackPlayer: string;
  opening: string;
  result: string;
  whiteAccuracy: number;
  blackAccuracy: number;
  estimatedWhiteElo: number;
  estimatedBlackElo: number;
  moves: MoveReview[];
}

export const reviewContext = `
Chess.com reviews games using a chess engine similar to Stockfish.

The review system works by analyzing every position in the game
and comparing the player's move against the engine's best move.

--------------------------------------------------
1. ENGINE ANALYSIS
--------------------------------------------------

For every move:
- The engine evaluates the current position.
- It calculates:
  - the best move
  - alternative candidate moves
  - tactical sequences
  - positional evaluations

The evaluation is represented in pawn units:
- +1.0 = White is about one pawn better
- -1.0 = Black is about one pawn better
- +M3 = forced mate in 3

--------------------------------------------------
2. MOVE COMPARISON
--------------------------------------------------

The played move is compared to the engine's best move.

The review system measures:
- evaluation difference before and after the move
- tactical impact
- missed opportunities
- whether the move was forced
- whether multiple moves were equally strong

Example:
Position before move:
Evaluation = +0.8

After best engine move:
Evaluation = +1.2

After played move:
Evaluation = -1.5

This is considered a severe evaluation loss
and would likely be classified as a blunder.

--------------------------------------------------
3. MOVE CLASSIFICATIONS
--------------------------------------------------

Best:
- Engine top move.

Excellent:
- Nearly as strong as the best move.

Good:
- Playable move with small evaluation loss.

Inaccuracy:
- Slightly weak move.

Mistake:
- Significant evaluation drop.

Blunder:
- Major tactical or positional error.

Great Move:
- Strong difficult move,
  often best in a critical position.

Brilliant Move:
- Rare move involving:
  - sacrifices
  - only-move solutions
  - deep tactical ideas
  - unexpected engine-level concepts

A brilliant move is NOT simply the best move.

--------------------------------------------------
4. ACCURACY SCORE
--------------------------------------------------

Chess.com computes an accuracy percentage.

The system compares:
- move quality
- consistency
- centipawn loss
- engine agreement

Higher accuracy means the player consistently matched
strong engine recommendations.

Approximate interpretation:
- 95%+ = near engine-level game
- 85–94% = strong game
- 70–84% = decent game
- below 70% = many inaccuracies

--------------------------------------------------
5. CENTIPAWN LOSS
--------------------------------------------------

Evaluation changes are measured in centipawns.

100 centipawns = 1 pawn.

Example:
Best move = +0.7
Played move = +0.2

Centipawn loss = 50

Lower average centipawn loss indicates stronger play.

--------------------------------------------------
6. DEPTH
--------------------------------------------------

The engine searches future move trees.

Depth means:
- how many half-moves (plies) ahead
  the engine has analyzed.

Higher depth:
- stronger analysis
- more accurate tactical detection
- slower computation

Low depth may miss tactical ideas.

--------------------------------------------------
7. PRINCIPAL VARIATION (PV)
--------------------------------------------------

The engine stores its best calculated line,
called the principal variation.

Example:
1. e4 e5
2. Nf3 Nc6
3. Bb5 a6

This line represents the engine's preferred continuation.

--------------------------------------------------
8. ESTIMATED GAME RATING
--------------------------------------------------

Chess.com estimates the level of play for a single game.

This estimate is based on:
- accuracy
- tactical precision
- consistency
- error frequency

This is NOT the player's actual rating.

--------------------------------------------------
9. REVIEW PIPELINE
--------------------------------------------------

Typical review flow:

1. Parse PGN
2. Reconstruct board positions
3. Run engine evaluation
4. Compare played move vs best move
5. Compute centipawn loss
6. Assign move classification
7. Compute accuracy
8. Generate explanations
9. Build final annotated review

--------------------------------------------------
10. IMPORTANT DETAILS
--------------------------------------------------

The system does NOT require the player to match
the exact top engine move every time.

If multiple moves have similar evaluations,
the move can still receive:
- Excellent
- Good
- Great

The review system balances:
- objective engine evaluation
- tactical difficulty
- human practical play
- move uniqueness
`;