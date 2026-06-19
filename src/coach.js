// coach.js — post-game analysis. Replays a hand from its stored deal and grades
// every decision the human made: the Monte Carlo expected value of their choice
// vs the best option, the point cost of the difference, and a plain-language
// reason. The evaluator only ever sees the human's information set (it
// determinizes the other hands), so its "best play" is a fair reference.

import { EuchreGame } from './engine.js';
import {
  SUIT_NAMES, SUIT_SYMBOLS, cardLabel, effectiveSuit, isTrump,
  isRightBower, isLeftBower, trickValue,
} from './cards.js';
import { teamOf, partnerOf, SEAT_SHORT } from './rules.js';
import { sameAction } from './ai/montecarlo.js';

export const HUMAN = 0;

// ---- Grading ------------------------------------------------------------

const GRADES = [
  { key: 'good', label: 'Good', max: 0.12 },
  { key: 'minor', label: 'Minor', max: 0.4 },
  { key: 'mistake', label: 'Mistake', max: 0.9 },
  { key: 'blunder', label: 'Blunder', max: Infinity },
];

function gradeFor(loss) {
  for (const g of GRADES) if (loss <= g.max) return g;
  return GRADES[GRADES.length - 1];
}

// ---- Human-readable action descriptions ---------------------------------

const suit = (s) => `${SUIT_SYMBOLS[s]} ${SUIT_NAMES[s]}`;

export function describeAction(a) {
  switch (a.type) {
    case 'pass': return 'pass';
    case 'orderUp': return `order up ${suit(a.suit)}${a.alone ? ' (alone)' : ''}`;
    case 'call': return `call ${suit(a.suit)}${a.alone ? ' (alone)' : ''}`;
    case 'discard': return `discard ${cardLabel(a.card)}`;
    case 'play': return `play ${cardLabel(a.card)}`;
    default: return JSON.stringify(a);
  }
}

function contextLabel(sim, kind) {
  switch (kind) {
    case 'bid1': return 'Bidding (round 1)';
    case 'bid2': return 'Bidding (round 2)';
    case 'discard': return 'Discard (dealer)';
    case 'play': return `Trick ${sim.trickIndex + 1}`;
    default: return kind;
  }
}

// ---- Reason generation (feature-based, conservative) --------------------

function trumpFeatures(hand, trump) {
  let count = 0, right = false, left = false, offAces = 0;
  for (const c of hand) {
    if (isTrump(c, trump)) {
      count++;
      if (isRightBower(c, trump)) right = true;
      if (isLeftBower(c, trump)) left = true;
    } else if (c.rank === 'A') offAces++;
  }
  return { count, right, left, offAces };
}

function describeTrump(hand, trump) {
  const f = trumpFeatures(hand, trump);
  const bits = [];
  if (f.right && f.left) bits.push('both bowers');
  else if (f.right) bits.push('the right bower');
  else if (f.left) bits.push('the left bower');
  bits.push(`${f.count} trump`);
  if (f.offAces) bits.push(`${f.offAces} off-ace${f.offAces > 1 ? 's' : ''}`);
  return bits.join(', ');
}

function bidReason(sim, chosen, best) {
  const hand = sim.hands[HUMAN];
  if (chosen.type === 'pass' && best.type !== 'pass') {
    return `You held ${describeTrump(hand, best.suit)} — strong enough to ${best.type === 'orderUp' ? 'order up' : 'call'} ${SUIT_NAMES[best.suit]}.`;
  }
  if (chosen.type !== 'pass' && best.type === 'pass') {
    return `With ${describeTrump(hand, chosen.suit)}, this call is thin and tends to get euchred — passing was safer.`;
  }
  if (chosen.alone && !best.alone) {
    return 'Going alone risked a bonus you were unlikely to make; the standard call kept the points safer.';
  }
  if (!chosen.alone && best.alone) {
    return `You had the cards to go alone (${describeTrump(hand, best.suit)}) and play for the 4-point march.`;
  }
  if (best.suit && chosen.suit && best.suit !== chosen.suit) {
    return `${SUIT_NAMES[best.suit]} is the stronger trump for this hand (${describeTrump(hand, best.suit)}).`;
  }
  return null;
}

function currentWinner(plays, trump) {
  if (!plays.length) return null;
  const led = effectiveSuit(plays[0].card, trump);
  let best = plays[0], bestVal = trickValue(plays[0].card, trump, led);
  for (let i = 1; i < plays.length; i++) {
    const v = trickValue(plays[i].card, trump, led);
    if (v > bestVal) { bestVal = v; best = plays[i]; }
  }
  return best;
}

function playReason(sim, chosenCard, bestCard) {
  const trump = sim.trump;
  const plays = sim.currentTrick.plays;

  // Leading.
  if (plays.length === 0) {
    const chosenTrump = isTrump(chosenCard, trump);
    const bestTrump = isTrump(bestCard, trump);
    if (bestTrump && !chosenTrump) {
      return 'Leading trump pulls the opponents’ bowers and clears the way for your side’s winners.';
    }
    if (!bestTrump && bestCard.rank === 'A' && !isTrump(bestCard, trump) && !(chosenCard.rank === 'A' && !chosenTrump)) {
      return `Cash your off-ace (${cardLabel(bestCard)}) before it can be trumped.`;
    }
    if (chosenTrump && !bestTrump) {
      return 'Leading trump here just burns your own; keep it and lead a side suit.';
    }
    return null;
  }

  // Following.
  const winner = currentWinner(plays, trump);
  const partnerWinning = winner && teamOf(winner.seat) === teamOf(HUMAN);
  const led = effectiveSuit(plays[0].card, trump);
  const chosenWins = trickValue(chosenCard, trump, led) > trickValue(winner.card, trump, led);
  const bestWins = trickValue(bestCard, trump, led) > trickValue(winner.card, trump, led);

  if (partnerWinning && chosenWins && isTrump(chosenCard, trump)) {
    return `Your partner already had the trick won — no need to spend ${cardLabel(chosenCard)}. Save it and throw off.`;
  }
  if (!partnerWinning && bestWins && !chosenWins) {
    return `${cardLabel(bestCard)} takes the trick; ${cardLabel(chosenCard)} lets the opponents win it.`;
  }
  if (!partnerWinning && !bestWins && !chosenWins) {
    return `This trick is lost either way — ${cardLabel(bestCard)} throws off your least useful card and keeps your winners.`;
  }
  if (partnerWinning && !chosenWins && isTrump(chosenCard, trump) && !isTrump(bestCard, trump)) {
    return 'No need to trump your own partner’s winner — discard a side card instead.';
  }
  return null;
}

function reasonFor(sim, kind, chosen, best) {
  if (sameAction(chosen, best)) return 'Best play — nicely done.';
  if (kind === 'bid1' || kind === 'bid2') return bidReason(sim, chosen, best);
  if (kind === 'play') return playReason(sim, chosen.card, best.card);
  if (kind === 'discard') return `Keeping your trump and off-aces, ${cardLabel(best.card)} was the card to let go.`;
  return null;
}

// ---- Hand review --------------------------------------------------------

/**
 * Replay a finished hand and grade every human decision.
 *   evaluate: async (exportedState, opts) => { evals: [{action, ev}], ... }
 * Returns { handNumber, decisions: [...], summary }.
 */
export async function reviewHand(game, handNumber, evaluate, opts = {}) {
  const determinizations = opts.determinizations ?? 60;
  const summaryRec = game.history.find((h) => h.handNumber === handNumber);
  if (!summaryRec || !summaryRec.deal) return null;
  const decisions = game.decisionLog.filter((d) => d.handNumber === handNumber);

  const sim = new EuchreGame({ ...game.options, seed: 1 });
  sim._silent = true;
  sim.startSpecificHand(summaryRec.deal);

  const reviews = [];
  for (const logged of decisions) {
    const decision = sim.currentDecision();
    if (!decision) break;
    const isHuman = decision.seat === HUMAN;
    const forced = decision.options.length <= 1;

    if (isHuman && !forced) {
      const { evals } = await evaluate(sim.exportState(), { determinizations });
      const best = evals[0];
      const chosenEval = evals.find((e) => sameAction(e.action, logged.chosenAction)) || { ev: best.ev };
      const loss = Math.max(0, best.ev - chosenEval.ev);
      const grade = gradeFor(loss);
      reviews.push({
        kind: decision.kind,
        context: contextLabel(sim, decision.kind),
        chosen: logged.chosenAction,
        chosenText: describeAction(logged.chosenAction),
        best: best.action,
        bestText: describeAction(best.action),
        evChosen: chosenEval.ev,
        evBest: best.ev,
        loss,
        grade: grade.key,
        gradeLabel: grade.label,
        reason: reasonFor(sim, decision.kind, logged.chosenAction, best.action),
        sameAsBest: sameAction(logged.chosenAction, best.action),
      });
    }
    sim.applyAction(logged.chosenAction);
  }

  // Summary.
  const counts = { good: 0, minor: 0, mistake: 0, blunder: 0 };
  let worst = null;
  for (const r of reviews) {
    counts[r.grade]++;
    if (!worst || r.loss > worst.loss) worst = r;
  }
  const totalLoss = reviews.reduce((s, r) => s + r.loss, 0);
  const graded = reviews.length;
  const accuracy = graded ? Math.round(100 * (counts.good / graded)) : 100;

  return {
    handNumber,
    result: summaryRec.result,
    trump: summaryRec.trump,
    maker: summaryRec.maker,
    decisions: reviews,
    summary: { counts, worst, totalLoss, graded, accuracy },
  };
}
