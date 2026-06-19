// tools/mc-eval.mjs — measure Monte Carlo strength vs the heuristic.
// One team plays Monte Carlo, the other plays the medium heuristic.
// Run: node tools/mc-eval.mjs [games] [determinizations]

import { EuchreGame, teamOf } from '../src/engine.js';
import { aiAction } from '../src/ai/heuristic.js';
import { bestAction } from '../src/ai/montecarlo.js';

const games = parseInt(process.argv[2] || '120', 10);
const det = parseInt(process.argv[3] || '24', 10);

function playGame(seed, mcTeam) {
  const game = new EuchreGame({ seed, scoreTarget: 10, stickTheDealer: true, allowGoAlone: true });
  let guard = 0;
  while (!game.isGameOver() && guard++ < 100000) {
    const d = game.currentDecision();
    if (!d) { game.nextHand(); continue; }
    const action = teamOf(d.seat) === mcTeam
      ? bestAction(game, d, { determinizations: det, seed: (seed * 131 + game.handNumber * 7 + d.seat) >>> 0 })
      : aiAction(game, d, 'medium');
    game.applyAction(action);
  }
  return game.winningTeam();
}

const t0 = Date.now();
let mcWins = 0;
for (let i = 0; i < games; i++) {
  // Alternate which side is Monte Carlo to cancel any positional bias.
  const mcTeam = i % 2 === 0 ? 'NS' : 'EW';
  const winner = playGame(1000 + i, mcTeam);
  if (winner === mcTeam) mcWins++;
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const pct = (mcWins / games * 100).toFixed(1);
console.log(`Monte Carlo (det=${det}) vs heuristic — ${games} games in ${secs}s`);
console.log(`Monte Carlo won ${mcWins}/${games} games = ${pct}%  (>50% means it's stronger)`);
