// engine.js — the euchre game state machine.
// UI-agnostic: it exposes the current decision and accepts actions. Every human
// and AI decision is recorded in decisionLog so the coach can review the hand.

import { makeDeck, parseCard, cardsEqual, leftBowerSuit } from './cards.js';
import {
  legalPlays, trickWinner, scoreHand,
  teamOf, partnerOf, nextSeat, removeCard,
  SEAT_NAMES, SEAT_SHORT, SEAT_TEAM,
} from './rules.js';

// Seeded PRNG (mulberry32) so hands/games are reproducible for replay.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clone = (x) => JSON.parse(JSON.stringify(x));

export class EuchreGame {
  constructor(options = {}) {
    this.options = {
      scoreTarget: 10,
      stickTheDealer: true,
      allowGoAlone: true,
      seed: (options.seed ?? Math.floor(Math.random() * 1e9)) | 0,
      ...options,
    };
    this.rng = mulberry32(this.options.seed);
    this._rngNoise = mulberry32((this.options.seed ^ 0x9e3779b9) >>> 0); // separate stream for AI noise
    this.scores = { NS: 0, EW: 0 };
    this.dealer = options.firstDealer ?? Math.floor(this.rng() * 4);
    this.handNumber = 0;
    this.history = [];        // finished-hand summaries
    this.decisionLog = [];    // every decision this game (for coaching)
    this.startHand();
  }

  // ---- Hand setup -------------------------------------------------------

  startHand() {
    this.handNumber += 1;
    const deck = shuffle(makeDeck(), this.rng);
    this.hands = [[], [], [], []];
    // Deal 5 each.
    let k = 0;
    for (let r = 0; r < 5; r++) {
      for (let s = 0; s < 4; s++) this.hands[s].push(deck[k++]);
    }
    this.kitty = deck.slice(k);          // 4 cards
    this.upCard = this.kitty[0];
    this.originalHands = clone(this.hands);

    this.phase = 'bidding1';
    this.bidder = nextSeat(this.dealer); // left of dealer bids first
    this.trump = null;
    this.maker = null;
    this.alone = false;
    this.sittingOut = null;
    this.turnedDownCard = null;
    this.passCount = 0;

    this.currentTrick = { plays: [] };
    this.leadSeat = null;
    this.trickIndex = 0;
    this.trickHistory = [];
    this.tricksWonByTeam = { NS: 0, EW: 0 };
    this.tricksWonBySeat = [0, 0, 0, 0];
    this.lastHandResult = null;
    this.passedOut = false;
  }

  // ---- Public introspection --------------------------------------------

  isGameOver() {
    return this.scores.NS >= this.options.scoreTarget || this.scores.EW >= this.options.scoreTarget;
  }

  winningTeam() {
    if (this.scores.NS >= this.options.scoreTarget) return 'NS';
    if (this.scores.EW >= this.options.scoreTarget) return 'EW';
    return null;
  }

  /** The seats that are actually playing this hand (excludes a sat-out partner). */
  seatsInPlay() {
    return [0, 1, 2, 3].filter((s) => s !== this.sittingOut);
  }

  /** Order of seats acting in the current trick, starting from the leader. */
  trickOrder() {
    const order = [];
    let s = this.leadSeat;
    const n = this.sittingOut === null ? 4 : 3;
    while (order.length < n) {
      if (s !== this.sittingOut) order.push(s);
      s = nextSeat(s);
    }
    return order;
  }

  /**
   * The decision currently required, or null if the engine needs no input
   * (hand/game over). Shape: { seat, kind, options, meta }.
   */
  currentDecision() {
    switch (this.phase) {
      case 'bidding1': {
        const opts = [{ type: 'pass' }, { type: 'orderUp', suit: this.upCard.suit }];
        if (this.options.allowGoAlone) opts.push({ type: 'orderUp', suit: this.upCard.suit, alone: true });
        return { seat: this.bidder, kind: 'bid1', options: opts, meta: { upCard: this.upCard } };
      }
      case 'bidding2': {
        const opts = [];
        const forbidden = this.turnedDownCard.suit;
        const mustCall = this.options.stickTheDealer && this.bidder === this.dealer;
        if (!mustCall) opts.push({ type: 'pass' });
        for (const suit of ['S', 'H', 'D', 'C']) {
          if (suit === forbidden) continue;
          opts.push({ type: 'call', suit });
          if (this.options.allowGoAlone) opts.push({ type: 'call', suit, alone: true });
        }
        return { seat: this.bidder, kind: 'bid2', options: opts, meta: { forbidden, mustCall } };
      }
      case 'discard': {
        return { seat: this.dealer, kind: 'discard', options: this.hands[this.dealer].map((c) => ({ type: 'discard', card: c })) };
      }
      case 'play': {
        const order = this.trickOrder();
        const seat = order[this.currentTrick.plays.length];
        const led = this.currentTrick.plays[0]?.card ?? null;
        const legal = legalPlays(this.hands[seat], led, this.trump);
        return { seat, kind: 'play', options: legal.map((c) => ({ type: 'play', card: c })), meta: { led } };
      }
      default:
        return null;
    }
  }

  // ---- Applying actions -------------------------------------------------

  /** Record a decision snapshot for coaching, then return it. */
  logDecision(decision, action) {
    const seat = decision.seat;
    const entry = {
      handNumber: this.handNumber,
      seat,
      seatName: SEAT_NAMES[seat],
      kind: decision.kind,
      phase: this.phase,
      dealer: this.dealer,
      upCard: this.upCard ? clone(this.upCard) : null,
      turnedDownCard: this.turnedDownCard ? clone(this.turnedDownCard) : null,
      trump: this.trump,
      maker: this.maker,
      alone: this.alone,
      leadSeat: this.leadSeat,
      trickIndex: this.trickIndex,
      currentTrick: clone(this.currentTrick.plays),
      handAtDecision: clone(this.hands[seat]),
      allHands: clone(this.hands),     // full info — used only for replay/Monte Carlo
      legalOptions: clone(decision.options),
      chosenAction: clone(action),
      scoresBefore: clone(this.scores),
      eval: null,                       // filled in later by the coach
    };
    this.decisionLog.push(entry);
    return entry;
  }

  applyAction(action) {
    const decision = this.currentDecision();
    if (!decision) throw new Error('No decision pending');
    this.logDecision(decision, action);

    switch (decision.kind) {
      case 'bid1': return this._applyBid1(decision.seat, action);
      case 'bid2': return this._applyBid2(decision.seat, action);
      case 'discard': return this._applyDiscard(decision.seat, action);
      case 'play': return this._applyPlay(decision.seat, action);
      default: throw new Error('Unknown decision kind');
    }
  }

  _applyBid1(seat, action) {
    if (action.type === 'pass') {
      this.passCount += 1;
      if (seat === this.dealer) {
        // All four passed round 1 — turn the card down.
        this.turnedDownCard = this.upCard;
        this.upCard = null;
        this.passCount = 0;
        this.phase = 'bidding2';
        this.bidder = nextSeat(this.dealer);
      } else {
        this.bidder = nextSeat(this.bidder);
      }
      return;
    }
    // Order up.
    this.trump = action.suit;
    this.maker = seat;
    this.alone = !!action.alone;
    if (this.alone) this.sittingOut = partnerOf(seat);
    // Dealer picks up the up-card, then discards.
    this.hands[this.dealer].push(this.upCard);
    this.phase = 'discard';
  }

  _applyBid2(seat, action) {
    if (action.type === 'pass') {
      if (seat === this.dealer) {
        // Everyone passed twice and stick-the-dealer is off — pass out the hand.
        this._passOut();
        return;
      }
      this.bidder = nextSeat(this.bidder);
      return;
    }
    this.trump = action.suit;
    this.maker = seat;
    this.alone = !!action.alone;
    if (this.alone) this.sittingOut = partnerOf(seat);
    this._beginPlay();
  }

  _applyDiscard(seat, action) {
    removeCard(this.hands[seat], action.card);
    this._beginPlay();
  }

  _beginPlay() {
    this.phase = 'play';
    this.leadSeat = nextSeat(this.dealer);
    // Skip a sitting-out leader.
    if (this.leadSeat === this.sittingOut) this.leadSeat = nextSeat(this.leadSeat);
    this.currentTrick = { plays: [] };
    this.trickIndex = 0;
  }

  _applyPlay(seat, action) {
    removeCard(this.hands[seat], action.card);
    this.currentTrick.plays.push({ seat, card: action.card });

    const expected = this.sittingOut === null ? 4 : 3;
    if (this.currentTrick.plays.length === expected) {
      const winner = trickWinner(this.currentTrick.plays, this.trump);
      this.tricksWonBySeat[winner] += 1;
      this.tricksWonByTeam[teamOf(winner)] += 1;
      this.trickHistory.push({ plays: clone(this.currentTrick.plays), winner });
      this.leadSeat = winner;
      this.trickIndex += 1;
      this.currentTrick = { plays: [] };
      if (this.trickIndex === 5) this._scoreHand();
    }
  }

  _passOut() {
    this.passedOut = true;
    this.phase = 'handOver';
    this.lastHandResult = { passedOut: true, label: 'All passed — hand thrown in', points: 0, team: null };
    this.history.push(this._handSummary());
  }

  _scoreHand() {
    const makerTeam = teamOf(this.maker);
    const result = scoreHand(makerTeam, this.tricksWonByTeam, this.alone);
    this.scores[result.team] += result.points;
    this.lastHandResult = { ...result, passedOut: false };
    this.phase = 'handOver';
    this.history.push(this._handSummary());
  }

  _handSummary() {
    return {
      handNumber: this.handNumber,
      dealer: this.dealer,
      trump: this.trump,
      maker: this.maker,
      alone: this.alone,
      tricks: clone(this.tricksWonByTeam),
      result: clone(this.lastHandResult),
      scoresAfter: clone(this.scores),
    };
  }

  /** Advance to the next hand (rotate dealer). Call after phase === 'handOver'. */
  nextHand() {
    this.dealer = nextSeat(this.dealer);
    this.startHand();
  }
}

export { SEAT_NAMES, SEAT_SHORT, SEAT_TEAM, teamOf, partnerOf, nextSeat };
