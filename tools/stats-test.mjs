// tools/stats-test.mjs — play a few games with a semi-random human, review every
// hand, fold into stats, and print the summary. Exercises coach tags + stats.
import { EuchreGame } from '../src/engine.js';
import { aiAction } from '../src/ai/heuristic.js';
import { evaluateActions } from '../src/ai/montecarlo.js';
import { reviewHand } from '../src/coach.js';
import { recordHand, finalizeGame, getSummary, resetStats } from '../src/stats.js';

const evaluate = async (state, opts) => {
  const g = EuchreGame.fromState(state);
  return { evals: evaluateActions(g, g.currentDecision(), opts) };
};

let r = 12345;
const rnd = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

resetStats();
const NUM_GAMES = 4;

for (let gi = 0; gi < NUM_GAMES; gi++) {
  const gameId = 1000 + gi;            // deterministic id (no Date in this harness)
  const game = new EuchreGame({ seed: gi + 1, scoreTarget: 10 });
  const reviewedHands = new Set();

  while (!game.isGameOver()) {
    const d = game.currentDecision();
    if (!d) {
      // hand finished — review it
      const hn = game.handNumber;
      if (!reviewedHands.has(hn)) {
        const review = await reviewHand(game, hn, evaluate, { determinizations: 30 });
        if (review) recordHand(review, gameId);
        reviewedHands.add(hn);
      }
      game.nextHand();
      continue;
    }
    const action = d.seat === 0
      ? (rnd() < 0.4 ? d.options[Math.floor(rnd() * d.options.length)] : aiAction(game, d, 'medium'))
      : aiAction(game, d, 'medium');
    game.applyAction(action);
  }
  // review the final hand too (loop exits before the handOver branch)
  const hn = game.handNumber;
  if (!reviewedHands.has(hn)) {
    const review = await reviewHand(game, hn, evaluate, { determinizations: 30 });
    if (review) recordHand(review, gameId);
  }
  finalizeGame(gameId, game.winningTeam() === 'NS');
}

const s = getSummary();
console.log('=== Stats summary ===');
console.log(`Hands ${s.hands} · decisions graded ${s.graded} · overall best-play accuracy ${s.accuracy}%`);
console.log(`Avg EV lost/decision ${s.avgLoss.toFixed(3)} · record ${s.record.wins}/${s.record.finished} games won`);
console.log('Grades:', s.counts);
console.log('\nBy category:');
for (const c of s.categories) console.log(`  ${c.name.padEnd(10)} ${String(c.accuracy).padStart(3)}%  (${c.graded} graded, avg loss ${c.avgLoss.toFixed(2)})`);
console.log('\nTop leaks:');
for (const l of s.leaks.slice(0, 6)) console.log(`  ${String(l.count).padStart(2)}×  ${l.label}`);
console.log('\nPer-game accuracy trend:', s.games.map((g) => `${g.accuracy}%${g.won ? '(W)' : '(L)'}`).join('  '));
console.log('\n✅ stats pipeline ran without errors');
