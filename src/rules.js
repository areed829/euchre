// rules.js — pure euchre rule functions: legal plays, trick winner, scoring.

import {
  effectiveSuit, isTrump, trickValue, cardsEqual,
} from './cards.js';

/**
 * Which cards in `hand` may legally be played, given the card that led the
 * trick (or null if leading). Must follow the effective led suit if able.
 */
export function legalPlays(hand, ledCard, trump) {
  if (!ledCard) return [...hand];
  const ledSuit = effectiveSuit(ledCard, trump);
  const canFollow = hand.filter((c) => effectiveSuit(c, trump) === ledSuit);
  return canFollow.length > 0 ? canFollow : [...hand];
}

/**
 * Resolve a completed trick. `plays` is [{ seat, card }, ...] in play order,
 * first entry led. Returns the seat that won.
 */
export function trickWinner(plays, trump) {
  const ledSuit = effectiveSuit(plays[0].card, trump);
  let best = plays[0];
  let bestVal = trickValue(plays[0].card, trump, ledSuit);
  for (let i = 1; i < plays.length; i++) {
    const v = trickValue(plays[i].card, trump, ledSuit);
    if (v > bestVal) {
      bestVal = v;
      best = plays[i];
    }
  }
  return best.seat;
}

/**
 * Score a finished hand.
 *   makerTeam: 'NS' | 'EW'
 *   tricks: { NS: n, EW: n }  (sum to 5)
 *   alone: boolean (maker played alone)
 * Returns { team, points, label } where team is who scored.
 */
export function scoreHand(makerTeam, tricks, alone) {
  const defenders = makerTeam === 'NS' ? 'EW' : 'NS';
  const makerTricks = tricks[makerTeam];

  if (makerTricks < 3) {
    // Euchred — defenders score 2.
    return { team: defenders, points: 2, label: 'Euchre! Defenders take 2', euchred: true, march: false };
  }
  if (makerTricks === 5) {
    if (alone) return { team: makerTeam, points: 4, label: 'Lone march! 4 points', euchred: false, march: true };
    return { team: makerTeam, points: 2, label: 'March! 2 points', euchred: false, march: true };
  }
  // 3 or 4 tricks.
  return { team: makerTeam, points: 1, label: `${makerTricks} tricks — 1 point`, euchred: false, march: false };
}

/** Team that a seat belongs to. Seats: 0=South(you),1=West,2=North,3=East. */
export const SEAT_TEAM = ['NS', 'EW', 'NS', 'EW'];
export const SEAT_NAMES = ['South (You)', 'West', 'North (Partner)', 'East'];
export const SEAT_SHORT = ['You', 'West', 'Partner', 'East'];

export function teamOf(seat) {
  return SEAT_TEAM[seat];
}

export function partnerOf(seat) {
  return (seat + 2) % 4;
}

export function nextSeat(seat) {
  return (seat + 1) % 4;
}

/** Does `hand` contain a card equal to `card`? */
export function handHas(hand, card) {
  return hand.some((c) => cardsEqual(c, card));
}

export function removeCard(hand, card) {
  const i = hand.findIndex((c) => cardsEqual(c, card));
  if (i >= 0) hand.splice(i, 1);
  return hand;
}
