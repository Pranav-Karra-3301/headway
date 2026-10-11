// Owner: Task P. Typed, mutually consistent sample data for the HUD, Play results and Lab (plan "Task P").
// Everything is read-only sample data: structuredClone before editing.
//   RUN_G0 / RUN_CHAMPION / RUN_HUMAN   stadium_exit seed 50000 results (PLAY_RESULTS = the store's play.results shape)
//   GENERATIONS g0…g4, ROUNDS R1…R5 (R3 rejected), ROUND = R5 (valid, valid, invalid), CHAMPION = g4
//   BASELINE / REFERENCE                 train + val SplitScores for the Lab chart's g0 and ref lines
//   EVOLVE_EVENTS                        one full round (ROUND) as streamed by POST /api/evolve
export { HUMAN_INTENTS, HUMAN_REPLAY, LEADERBOARD, PLAY_RESULTS, PLAY_SEED, RUN_CHAMPION, RUN_G0, RUN_HUMAN, RUN_RESULTS } from './runResult';
export { BASELINE, CHAMPION, GENERATIONS, REFERENCE, ROUND, ROUNDS } from './generations';
export { EVOLVE_EVENTS } from './evolveEvents';
