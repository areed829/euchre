// tools/coach-test.mjs — exercise the coach end-to-end on a played hand.
import { EuchreGame } from '../src/engine.js';
import { aiAction } from '../src/ai/heuristic.js';
import { evaluateActions } from '../src/ai/montecarlo.js';
import { reviewHand } from '../src/coach.js';

// Inject a synchronous-but-async evaluator (no worker in Node).
const evaluate = async (state, opts) => {
  const g = EuchreGame.fromState(state);
  const d = g.currentDecision();
  return { evals: evaluateActions(g, d, opts) };
};

let rngState = 99;
function rnd() { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; }

const game = new EuchreGame({ seed: 7, scoreTarget: 10 });
// Play just the first hand. Human (seat 0) plays semi-randomly to create mistakes.
while (game.handNumber === 1 && game.phase !== 'handOver') {
  const d = game.currentDecision();
  if (!d) break;
  let action;
  if (d.seat === 0) {
    action = rnd() < 0.5 ? d.options[Math.floor(rnd() * d.options.length)] : aiAction(game, d, 'medium');
  } else {
    action = aiAction(game, d, 'medium');
  }
  game.applyAction(action);
}

const review = await reviewHand(game, 1, evaluate, { determinizations: 50 });
if (!review) { console.error('No review produced'); process.exit(1); }

console.log(`=== Hand ${review.handNumber} review ===`);
console.log(`Trump ${review.trump}, result: ${review.result?.label}`);
console.log(`Graded ${review.summary.graded} decisions — accuracy ${review.summary.accuracy}% — total EV lost ${review.summary.totalLoss.toFixed(2)}`);
console.log(`Grades:`, review.summary.counts);
console.log('');
for (const r of review.decisions) {
  const flag = r.sameAsBest ? '✓' : '•';
  console.log(`[${r.gradeLabel.padEnd(8)}] ${flag} ${r.context}: you ${r.chosenText}` +
    (r.sameAsBest ? '' : `  → best: ${r.bestText}  (Δ ${r.loss.toFixed(2)})`));
  if (r.reason) console.log(`            ${r.reason}`);
}
console.log('\n✅ coach.reviewHand ran without errors');
