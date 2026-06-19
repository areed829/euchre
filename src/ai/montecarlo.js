// ai/montecarlo.js — Perfect-Information Monte Carlo (PIMC) evaluator.
//
// For a decision, we sample many plausible "worlds" (deal the unseen cards to
// the other seats consistent with what the actor knows), then for each candidate
// action we play the hand out with the heuristic policy and average the points.
// The same worlds are reused across actions (common random numbers) so the
// comparison between options is low-variance — important for honest coaching.

import { makeDeck, effectiveSuit } from '../cards.js';
import { teamOf } from '../rules.js';
import { aiAction } from './heuristic.js';
import { EuchreGame } from '../engine.js';

const FULL_DECK = makeDeck();
const key = (c) => c.rank + c.suit;
const clone = (x) => JSON.parse(JSON.stringify(x));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Cards the actor can see/account for: own hand + everything played. */
function seenCards(game, seat) {
  const seen = new Set();
  for (const c of game.hands[seat]) seen.add(key(c));
  for (const t of game.trickHistory) for (const p of t.plays) seen.add(key(p.card));
  for (const p of game.currentTrick.plays) seen.add(key(p.card));
  return seen;
}

/** Suits each seat has revealed they're void in (failed to follow). */
function inferVoids(game) {
  const voids = [new Set(), new Set(), new Set(), new Set()];
  const trump = game.trump;
  const scan = (plays) => {
    if (!plays.length) return;
    const led = effectiveSuit(plays[0].card, trump);
    for (let i = 1; i < plays.length; i++) {
      if (effectiveSuit(plays[i].card, trump) !== led) voids[plays[i].seat].add(led);
    }
  };
  for (const t of game.trickHistory) scan(t.plays);
  scan(game.currentTrick.plays);
  return voids;
}

/**
 * Produce one determinized `hands` array: the actor keeps their real hand; the
 * other seats (and any sat-out partner, whose cards are out of circulation) get
 * a random legal assignment of the unseen cards, respecting known voids.
 */
function sampleWorld(game, seat, voids, rng) {
  const trump = game.trump;
  const seen = seenCards(game, seat);

  // The up-card / turned-down card is known and not free to deal to others.
  const knownAside = game.phase === 'bidding1' ? game.upCard
    : (game.turnedDownCard || null);
  if (knownAside) seen.add(key(knownAside));

  // If trump was ordered up (round 1), the up-card went to the dealer. Bias it
  // into the dealer's hand if it hasn't been played and the actor isn't dealer.
  const pickedUp = trump && !game.turnedDownCard && game.phase !== 'bidding1' && game.phase !== 'bidding2';
  let forceToDealer = null;
  if (pickedUp && game.upCard && !seen.has(key(game.upCard)) && seat !== game.dealer) {
    forceToDealer = game.upCard;
    seen.add(key(game.upCard));
  }

  let pool = FULL_DECK.filter((c) => !seen.has(key(c))).map(clone);
  shuffleInPlace(pool, rng);

  const hands = [[], [], [], []];
  hands[seat] = clone(game.hands[seat]);
  const recipients = [0, 1, 2, 3].filter((s) => s !== seat);
  const need = {};
  for (const s of recipients) need[s] = game.hands[s].length;

  // `need[s]` is the TARGET total for each seat; the forced card counts toward
  // the dealer's target, so push it but do NOT decrement need.
  if (forceToDealer && need[game.dealer] > 0) {
    hands[game.dealer].push(forceToDealer);
  }

  // Deal most-constrained cards first (those few seats can legally hold).
  const eligibleSeats = (card) => recipients.filter(
    (s) => need[s] - hands[s].length > 0 && !voids[s].has(effectiveSuit(card, trump)));
  pool.sort((a, b) => eligibleSeats(a).length - eligibleSeats(b).length);

  const leftover = [];
  for (const card of pool) {
    let elig = eligibleSeats(card);
    if (elig.length === 0) {
      // Relax the void constraint rather than fail; seats still needing cards.
      elig = recipients.filter((s) => need[s] - hands[s].length > 0);
    }
    if (elig.length === 0) { leftover.push(card); continue; } // kitty/discard
    const s = elig[Math.floor(rng() * elig.length)];
    hands[s].push(card);
  }
  return hands;
}

function signedPoints(sim, team) {
  const r = sim.lastHandResult;
  if (!r || r.passedOut) return 0;
  return r.team === team ? r.points : -r.points;
}

function playout(sim, policy) {
  let guard = 0;
  while (++guard < 200) {
    const d = sim.currentDecision();
    if (!d) break;
    sim.applyAction(aiAction(sim, d, policy));
  }
  return sim;
}

/**
 * Evaluate every option of a decision. Returns options sorted by expected
 * points for the acting team (best first): [{ action, ev, n }].
 */
export function evaluateActions(game, decision, opts = {}) {
  const determinizations = opts.determinizations ?? 40;
  const policy = opts.policy ?? 'medium';
  const rng = opts.rng ?? mulberry32((opts.seed ?? 12345) >>> 0);
  const seat = decision.seat;
  const team = teamOf(seat);
  const voids = inferVoids(game);
  const base = game.exportState();

  const worlds = [];
  for (let i = 0; i < determinizations; i++) worlds.push(sampleWorld(game, seat, voids, rng));

  const tallies = decision.options.map((option) => ({ option, total: 0, n: 0 }));
  for (const world of worlds) {
    for (const t of tallies) {
      const sim = EuchreGame.fromState(base);
      sim.hands = clone(world);
      sim.applyAction(t.option);
      playout(sim, policy);
      t.total += signedPoints(sim, team);
      t.n += 1;
    }
  }

  return tallies
    .map((t) => ({ action: t.option, ev: t.total / t.n, n: t.n }))
    .sort((a, b) => b.ev - a.ev);
}

function sameAction(a, b) {
  return a.type === b.type && a.suit === b.suit && !!a.alone === !!b.alone &&
    (!a.card || (b.card && a.card.rank === b.card.rank && a.card.suit === b.card.suit));
}

/**
 * The action to play. We anchor to the heuristic and only deviate when Monte
 * Carlo shows another option is better by a clear margin — this keeps the
 * search from overriding a sound choice on noisy near-ties, so Hard plays at
 * least as well as the heuristic.
 */
export function bestAction(game, decision, opts = {}) {
  const evals = evaluateActions(game, decision, opts);
  const margin = opts.margin ?? 0.06;
  const heuristic = aiAction(game, decision, 'medium');
  const evH = evals.find((e) => sameAction(e.action, heuristic));
  const best = evals[0];
  if (!evH) return best.action;
  return best.ev > evH.ev + margin ? best.action : heuristic;
}

export { inferVoids, sampleWorld, sameAction };
