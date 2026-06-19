// ai/heuristic.js — rule-based euchre player used for easy/medium difficulty
// and as the fast rollout policy inside the Monte Carlo engine.

import {
  isTrump, isRightBower, isLeftBower, cardPower, effectiveSuit,
  trickValue, leftBowerSuit, SUITS,
} from '../cards.js';
import { partnerOf, teamOf } from '../rules.js';

// ---- Hand valuation for bidding ----------------------------------------

const TRUMP_VALUE = (card, trump) => {
  if (isRightBower(card, trump)) return 1.0;
  if (isLeftBower(card, trump)) return 0.85;
  switch (card.rank) {
    case 'A': return 0.75;
    case 'K': return 0.55;
    case 'Q': return 0.4;
    case '10': return 0.25;
    case '9': return 0.15;
    default: return 0.15;
  }
};

/**
 * Estimate the number of tricks `hand` can take with the given trump.
 * A rough but serviceable expected-tricks model.
 */
export function estimateTricks(hand, trump) {
  let est = 0;
  let trumpCount = 0;
  const suitCount = { S: 0, H: 0, D: 0, C: 0 };

  for (const card of hand) {
    if (isTrump(card, trump)) {
      est += TRUMP_VALUE(card, trump);
      trumpCount += 1;
    } else {
      suitCount[card.suit] += 1;
      if (card.rank === 'A') est += 0.55;      // off-ace, often a trick
      else if (card.rank === 'K') est += 0.15;
    }
  }

  // Trump length is power: extra trumps win by exhaustion even when low.
  if (trumpCount > 1) est += 0.22 * (trumpCount - 1);

  // Ruffing potential: short side suits + trump to ruff with.
  if (trumpCount >= 1) {
    for (const suit of SUITS) {
      if (suit === trump || suit === leftBowerSuit(trump)) continue;
      if (suitCount[suit] === 0) est += 0.4 * Math.min(trumpCount, 2);
    }
  }
  return est;
}

// ---- Bidding ------------------------------------------------------------

function evaluateRound1(hand, decision, game) {
  const seat = decision.seat;
  const trump = game.upCard.suit;
  let evalHand = hand;

  if (seat === game.dealer) {
    // Dealer would pick up the up-card; evaluate the best 5 of those 6.
    const six = [...hand, game.upCard];
    const worst = pickDiscard(six, trump);
    evalHand = six.filter((c) => c !== worst);
  }

  let est = estimateTricks(evalHand, trump);
  if (seat === partnerOf(game.dealer)) est += 0.3;          // partner gets a trump
  else if (seat !== game.dealer) est -= 0.5;                 // arming an opponent dealer
  return est;
}

function bestRound2Suit(hand, decision, game) {
  let best = null;
  for (const suit of SUITS) {
    if (suit === game.turnedDownCard.suit) continue;
    const est = estimateTricks(hand, suit);
    if (!best || est > best.est) best = { suit, est };
  }
  return best;
}

function bidAction(game, decision, difficulty) {
  const hand = game.hands[decision.seat];
  const callThresh = difficulty === 'easy' ? 2.75 : 2.35;
  const aloneThresh = 4.5;

  if (decision.kind === 'bid1') {
    const est = evaluateRound1(hand, decision, game);
    if (est >= aloneThresh && game.options.allowGoAlone)
      return { type: 'orderUp', suit: game.upCard.suit, alone: true };
    if (est >= callThresh)
      return { type: 'orderUp', suit: game.upCard.suit };
    return { type: 'pass' };
  }

  // bid2
  const best = bestRound2Suit(hand, decision, game);
  if (decision.meta.mustCall) {
    // Stick the dealer — must name the strongest available suit.
    if (best.est >= aloneThresh && game.options.allowGoAlone)
      return { type: 'call', suit: best.suit, alone: true };
    return { type: 'call', suit: best.suit };
  }
  if (best.est >= aloneThresh && game.options.allowGoAlone)
    return { type: 'call', suit: best.suit, alone: true };
  if (best.est >= callThresh)
    return { type: 'call', suit: best.suit };
  return { type: 'pass' };
}

// ---- Discard (dealer, after picking up) ---------------------------------

/** Choose the weakest card to discard, preferring to create a non-trump void. */
function pickDiscard(cards, trump) {
  const nonTrump = cards.filter((c) => !isTrump(c, trump));
  if (nonTrump.length === 0) {
    // All trump (rare) — pitch the lowest trump.
    return [...cards].sort((a, b) => cardPower(a, trump) - cardPower(b, trump))[0];
  }
  // Count off-suit holdings to find singletons we can void.
  const bySuit = {};
  for (const c of nonTrump) (bySuit[c.suit] ??= []).push(c);

  let candidates = nonTrump;
  // Prefer discarding from a singleton non-ace suit (creates a void to ruff).
  const singletons = nonTrump.filter((c) => bySuit[c.suit].length === 1 && c.rank !== 'A');
  if (singletons.length) candidates = singletons;
  else {
    // Otherwise avoid throwing aces if we can.
    const nonAces = nonTrump.filter((c) => c.rank !== 'A');
    if (nonAces.length) candidates = nonAces;
  }
  return [...candidates].sort((a, b) => cardPower(a, trump) - cardPower(b, trump))[0];
}

function discardAction(game, decision) {
  const card = pickDiscard(game.hands[game.dealer], game.trump);
  return { type: 'discard', card };
}

// ---- Card play ----------------------------------------------------------

function trickLeaderInfo(plays, trump) {
  if (plays.length === 0) return null;
  const ledSuit = effectiveSuit(plays[0].card, trump);
  let best = plays[0];
  let bestVal = trickValue(plays[0].card, trump, ledSuit);
  for (let i = 1; i < plays.length; i++) {
    const v = trickValue(plays[i].card, trump, ledSuit);
    if (v > bestVal) { bestVal = v; best = plays[i]; }
  }
  return { seat: best.seat, value: bestVal, card: best.card, ledSuit };
}

function lowest(cards, trump) {
  return [...cards].sort((a, b) => cardPower(a, trump) - cardPower(b, trump))[0];
}
function highest(cards, trump) {
  return [...cards].sort((a, b) => cardPower(b, trump) - cardPower(a, trump))[0];
}

function playAction(game, decision, difficulty) {
  const seat = decision.seat;
  const trump = game.trump;
  const legal = decision.options.map((o) => o.card);
  const plays = game.currentTrick.plays;

  // Occasional noise for the easy bot keeps it beatable and human-like.
  if (difficulty === 'easy' && game._rngNoise && game._rngNoise() < 0.18) {
    return { type: 'play', card: legal[Math.floor(game._rngNoise() * legal.length)] };
  }

  if (plays.length === 0) return { type: 'play', card: leadCard(game, seat, legal, trump) };

  const ledSuit = effectiveSuit(plays[0].card, trump);
  const leader = trickLeaderInfo(plays, trump);
  const partnerWinning = teamOf(leader.seat) === teamOf(seat);
  const isLast = plays.length === (game.sittingOut === null ? 3 : 2);

  const canFollow = legal.some((c) => effectiveSuit(c, trump) === ledSuit);

  // Cards that would currently win the trick.
  const winners = legal.filter((c) => trickValue(c, trump, ledSuit) > leader.value);

  if (partnerWinning) {
    // Partner is ahead. Don't overtake; sluff the lowest card (off-suit first).
    if (isLast || leader.value >= 100 + 6) return { type: 'play', card: lowest(legal, trump) };
    // If partner's winning card is weak and opponents remain, consider securing it,
    // but the simple, solid move is to play low.
    return { type: 'play', card: lowest(legal, trump) };
  }

  // Opponent currently winning.
  if (winners.length > 0) {
    // Win as cheaply as possible.
    return { type: 'play', card: lowest(winners, trump) };
  }
  // Can't win — duck with the lowest card, keeping useful cards.
  return { type: 'play', card: lowest(legal, trump) };

  // (canFollow is implied by legalPlays already restricting options.)
}

function leadCard(game, seat, legal, trump) {
  const makerTeam = teamOf(game.maker);
  const onMakerTeam = teamOf(seat) === makerTeam;
  const trumps = legal.filter((c) => isTrump(c, trump));
  const offAces = legal.filter((c) => !isTrump(c, trump) && c.rank === 'A');

  // Maker's side with strong trump: lead trump to pull opponents' trump.
  if (onMakerTeam && trumps.length >= 2) {
    const hasRight = trumps.some((c) => isRightBower(c, trump));
    if (hasRight) return highest(trumps, trump);     // lead the right bower
    return highest(trumps, trump);
  }
  // Cash an off-ace before it can be trumped.
  if (offAces.length) return offAces[0];
  // Otherwise lead a low non-trump (preserve trump).
  const nonTrump = legal.filter((c) => !isTrump(c, trump));
  if (nonTrump.length) return lowest(nonTrump, trump);
  return lowest(legal, trump);
}

// ---- Entry point --------------------------------------------------------

export function aiAction(game, decision, difficulty = 'medium') {
  switch (decision.kind) {
    case 'bid1':
    case 'bid2':
      return bidAction(game, decision, difficulty);
    case 'discard':
      return discardAction(game, decision);
    case 'play':
      return playAction(game, decision, difficulty);
    default:
      // Fallback: first legal option.
      return decision.options[0];
  }
}

export { pickDiscard };
