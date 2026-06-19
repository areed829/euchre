// cards.js — card model and euchre trump logic.
// A card is an object { suit, rank }. Suits: S H D C. Ranks: 9 10 J Q K A.
// We also use a compact string id like "JS" (Jack of Spades) / "10H".

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];

export const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_COLOR = { S: 'black', H: 'red', D: 'red', C: 'black' };

// Plain rank order for non-trump comparisons (A high). J sits between 10 and Q.
const PLAIN_ORDER = { '9': 0, '10': 1, 'J': 2, 'Q': 3, 'K': 4, 'A': 5 };

/** Build a fresh, unshuffled 24-card euchre deck. */
export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ suit, rank });
  }
  return deck;
}

export function cardId(card) {
  return card.rank + card.suit;
}

export function parseCard(id) {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return { suit, rank };
}

export function cardLabel(card) {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

export function cardsEqual(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Two suits share a color (S/C black, H/D red). */
export function sameColor(a, b) {
  return SUIT_COLOR[a] === SUIT_COLOR[b];
}

/** The suit of the left bower for a given trump suit (the other same-color suit). */
export function leftBowerSuit(trump) {
  switch (trump) {
    case 'S': return 'C';
    case 'C': return 'S';
    case 'H': return 'D';
    case 'D': return 'H';
    default: return null;
  }
}

export function isRightBower(card, trump) {
  return card.rank === 'J' && card.suit === trump;
}

export function isLeftBower(card, trump) {
  return card.rank === 'J' && card.suit === leftBowerSuit(trump);
}

/**
 * The "effective" suit of a card given trump. The left bower counts as trump,
 * not its printed suit. Everything else keeps its printed suit.
 */
export function effectiveSuit(card, trump) {
  if (trump && isLeftBower(card, trump)) return trump;
  return card.suit;
}

export function isTrump(card, trump) {
  return effectiveSuit(card, trump) === trump;
}

/**
 * A single comparable value for resolving a trick.
 * Higher wins. Trumps always beat the led suit, which always beats off-suit.
 *   ledSuit is the EFFECTIVE suit that was led.
 */
export function trickValue(card, trump, ledSuit) {
  const eff = effectiveSuit(card, trump);
  if (eff === trump) {
    // Trump ladder: right bower > left bower > A K Q 10 9
    if (isRightBower(card, trump)) return 100 + 7;
    if (isLeftBower(card, trump)) return 100 + 6;
    const trumpRank = { 'A': 5, 'K': 4, 'Q': 3, '10': 2, '9': 1 };
    return 100 + (trumpRank[card.rank] ?? 0);
  }
  if (eff === ledSuit) return PLAIN_ORDER[card.rank];
  return -1; // off-suit, cannot win
}

/**
 * Absolute strength of a card within the trump context, ignoring what was led.
 * Useful for AI valuation / sorting a hand. Higher = stronger.
 */
export function cardPower(card, trump) {
  if (!trump) return PLAIN_ORDER[card.rank];
  if (isRightBower(card, trump)) return 17;
  if (isLeftBower(card, trump)) return 16;
  if (isTrump(card, trump)) {
    const trumpRank = { 'A': 15, 'K': 14, 'Q': 13, '10': 12, '9': 11 };
    return trumpRank[card.rank] ?? 10;
  }
  return PLAIN_ORDER[card.rank]; // 0..5 for off-suit
}

/** Sort a hand for display: trump first (strongest left), then suits grouped. */
export function sortHand(hand, trump) {
  const order = { S: 0, H: 1, D: 2, C: 3 };
  return [...hand].sort((a, b) => {
    const at = isTrump(a, trump), bt = isTrump(b, trump);
    if (at !== bt) return at ? -1 : 1;
    if (at && bt) return cardPower(b, trump) - cardPower(a, trump);
    const ae = effectiveSuit(a, trump), be = effectiveSuit(b, trump);
    if (ae !== be) return order[ae] - order[be];
    return PLAIN_ORDER[b.rank] - PLAIN_ORDER[a.rank];
  });
}
