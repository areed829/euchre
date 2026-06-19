// tools/selfplay.mjs — headless self-play harness to validate the engine + AI.
// Run: node tools/selfplay.mjs [numGames]

import { EuchreGame } from '../src/engine.js';
import { aiAction } from '../src/ai/heuristic.js';
import { legalPlays } from '../src/rules.js';
import { effectiveSuit, cardsEqual } from '../src/cards.js';

const numGames = parseInt(process.argv[2] || '500', 10);

let totalHands = 0;
let totalTricks = 0;
const makerTeamWins = { NS: 0, EW: 0 };
const callType = { orderUp: 0, call: 0, alone: 0, stickDealer: 0, passedOut: 0 };
const outcome = { euchres: 0, marches: 0, points: 0, scoredHands: 0 };
let errors = 0;

function assert(cond, msg, ctx) {
  if (!cond) {
    errors++;
    console.error('ASSERT FAIL:', msg, ctx ? JSON.stringify(ctx) : '');
    if (errors > 20) { console.error('Too many errors, aborting.'); process.exit(1); }
  }
}

for (let g = 0; g < numGames; g++) {
  const game = new EuchreGame({ seed: g + 1, scoreTarget: 10, stickTheDealer: true, allowGoAlone: true });
  let guard = 0;

  while (!game.isGameOver()) {
    guard++;
    assert(guard < 100000, 'loop guard tripped (game not terminating)', { g });
    if (guard >= 100000) break;

    const decision = game.currentDecision();
    if (!decision) {
      // hand over
      const r = game.lastHandResult;
      if (r.passedOut) callType.passedOut++;
      else {
        totalHands++;
        // tricks should sum to 5
        const sum = game.tricksWonByTeam.NS + game.tricksWonByTeam.EW;
        assert(sum === 5, 'tricks do not sum to 5', { g, sum, t: game.tricksWonByTeam });
        totalTricks += sum;
        if (r.team) makerTeamWins[r.team]++;
        outcome.scoredHands++;
        outcome.points += r.points;
        if (r.euchred) outcome.euchres++;
        if (r.march) outcome.marches++;
      }
      game.nextHand();
      continue;
    }

    // Validate the decision shape.
    assert(decision.options.length > 0, 'no legal options', { kind: decision.kind, seat: decision.seat });

    // For play decisions, verify follow-suit rule is honored by options.
    if (decision.kind === 'play') {
      const hand = game.hands[decision.seat];
      const led = game.currentTrick.plays[0]?.card ?? null;
      const expected = legalPlays(hand, led, game.trump);
      assert(decision.options.length === expected.length, 'legal options mismatch', {
        seat: decision.seat, got: decision.options.length, exp: expected.length,
      });
      // Every option must be in hand.
      for (const o of decision.options) {
        assert(hand.some((c) => cardsEqual(c, o.card)), 'played card not in hand', { card: o.card });
      }
      // If void in led suit not the case, all options share the led suit.
      if (led) {
        const ledSuit = effectiveSuit(led, game.trump);
        const hasLed = hand.some((c) => effectiveSuit(c, game.trump) === ledSuit);
        if (hasLed) {
          for (const o of decision.options) {
            assert(effectiveSuit(o.card, game.trump) === ledSuit, 'must follow suit violated', { card: o.card, ledSuit });
          }
        }
      }
    }

    if (decision.kind === 'bid1') {
      // record nothing yet
    }

    const action = aiAction(game, decision, g % 3 === 0 ? 'easy' : 'medium');
    // The chosen action must be among legal options (by structural match).
    const ok = decision.options.some((o) => JSON.stringify(o) === JSON.stringify(action) ||
      (o.type === action.type && o.suit === action.suit && !!o.alone === !!action.alone &&
        (!o.card || cardsEqual(o.card, action.card))));
    assert(ok, 'AI chose an illegal action', { kind: decision.kind, action, n: decision.options.length });

    // Track call types at the moment trump gets set.
    if ((decision.kind === 'bid1' && action.type === 'orderUp') ||
        (decision.kind === 'bid2' && action.type === 'call')) {
      if (action.alone) callType.alone++;
      else if (decision.kind === 'bid1') callType.orderUp++;
      else callType.call++;
      if (decision.kind === 'bid2' && decision.meta.mustCall) callType.stickDealer++;
    }

    game.applyAction(action);
  }

  // Game ended — exactly one team at/over target.
  const w = game.winningTeam();
  assert(w !== null, 'game ended without a winner', { g, scores: game.scores });
}

console.log('=== Self-play complete ===');
console.log(`Games:        ${numGames}`);
console.log(`Hands played: ${totalHands}  (avg ${(totalHands / numGames).toFixed(1)}/game)`);
console.log(`Passed out:   ${callType.passedOut}`);
console.log(`Avg tricks/hand: ${(totalTricks / totalHands).toFixed(2)} (should be 5.00)`);
console.log(`Calls — orderUp: ${callType.orderUp}, round2: ${callType.call}, alone: ${callType.alone}, stick-the-dealer forced: ${callType.stickDealer}`);
console.log(`Maker-team scored the hand: NS ${makerTeamWins.NS}, EW ${makerTeamWins.EW}`);
const stickPct = (callType.stickDealer / outcome.scoredHands * 100).toFixed(1);
const euchrePct = (outcome.euchres / outcome.scoredHands * 100).toFixed(1);
const marchPct = (outcome.marches / outcome.scoredHands * 100).toFixed(1);
console.log(`Stick-the-dealer forced: ${stickPct}% of hands  (target ~15-25%)`);
console.log(`Maker euchred: ${euchrePct}% of hands  (target ~10-20%)`);
console.log(`Marches (all 5): ${marchPct}% of hands`);
console.log(errors === 0 ? '✅ No rule violations detected.' : `❌ ${errors} assertion failures.`);
process.exit(errors === 0 ? 0 : 1);
