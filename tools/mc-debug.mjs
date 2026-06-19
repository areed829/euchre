import { EuchreGame } from '../src/engine.js';
import { aiAction } from '../src/ai/heuristic.js';
import { sampleWorld, inferVoids } from '../src/ai/montecarlo.js';

function rng() { return Math.random(); }

for (let g = 0; g < 50; g++) {
  const game = new EuchreGame({ seed: g + 1 });
  let guard = 0;
  while (!game.isGameOver() && guard++ < 100000) {
    const d = game.currentDecision();
    if (!d) { game.nextHand(); continue; }
    const voids = inferVoids(game);
    for (let w = 0; w < 4; w++) {
      const world = sampleWorld(game, d.seat, voids, rng);
      for (let s = 0; s < 4; s++) {
        if (world[s].length !== game.hands[s].length) {
          console.error('SIZE MISMATCH', {
            g, hand: game.handNumber, phase: game.phase, kind: d.kind,
            actor: d.seat, dealer: game.dealer, seat: s,
            got: world[s].length, want: game.hands[s].length,
            trump: game.trump, turnedDown: game.turnedDownCard, sittingOut: game.sittingOut,
            trickIndex: game.trickIndex, curTrick: game.currentTrick.plays.length,
          });
          process.exit(1);
        }
      }
      // also check no duplicate cards across world
      const seen = new Set();
      for (let s = 0; s < 4; s++) for (const c of world[s]) {
        const k = c.rank + c.suit;
        if (seen.has(k)) { console.error('DUPLICATE', k, { g, phase: game.phase, kind: d.kind }); process.exit(1); }
        seen.add(k);
      }
    }
    game.applyAction(aiAction(game, d, 'medium'));
  }
}
console.log('✅ sampleWorld produced correct hand sizes & no duplicates across 50 games');
