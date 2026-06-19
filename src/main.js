// main.js — orchestrates the game loop, human input, and AI turns.

import { EuchreGame } from './engine.js';
import { aiAction, estimateTricks } from './ai/heuristic.js';
import {
  render, logLine, clearLog, showModal, hideModal,
} from './ui.js';
import { SUIT_SYMBOLS, SUIT_NAMES, cardLabel } from './cards.js';
import { SEAT_SHORT } from './rules.js';

const HUMAN = 0;
let game;
let difficulty = 'medium';
let resolveHuman = null;
let currentDecision = null;
let currentHint = null;

const AI_DELAY = 600;
const TRICK_PAUSE = 1150;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Logging helpers ----------------------------------------------------

function suit(s) { return `<span class="suit-${s}">${SUIT_SYMBOLS[s]}</span>`; }

function logAction(decision, action) {
  const who = `<span class="who">${SEAT_SHORT[decision.seat]}</span>`;
  switch (decision.kind) {
    case 'bid1':
      if (action.type === 'pass') return logLine(`${who} passed`, 'sys');
      return logLine(`${who} ordered up ${suit(action.suit)}${action.alone ? ' — going alone!' : ''}`);
    case 'bid2':
      if (action.type === 'pass') return logLine(`${who} passed`, 'sys');
      return logLine(`${who} called ${suit(action.suit)} ${SUIT_NAMES[action.suit]}${action.alone ? ' — going alone!' : ''}`);
    case 'discard':
      if (decision.seat === HUMAN) return logLine(`${who} discarded ${cardLabel(action.card)}`, 'sys');
      return logLine(`${who} (dealer) discarded`, 'sys');
    case 'play':
      return logLine(`${who} played ${cardLabel(action.card)}`);
  }
}

function logHandStart() {
  logLine(`— Hand ${game.handNumber} · dealer ${SEAT_SHORT[game.dealer]} —`, 'sys');
}

// ---- Rendering helpers --------------------------------------------------

function humanOnAction(action) {
  if (!resolveHuman) return;
  const r = resolveHuman;
  resolveHuman = null;
  currentHint = null;
  r(action);
}

function draw(opts = {}) {
  render(game, { onAction: humanOnAction, difficulty, hint: currentHint, ...opts });
}

function waitForHuman() {
  return new Promise((res) => { resolveHuman = res; });
}

// ---- Apply an action and animate trick completion -----------------------

async function applyAndAdvance(decision, action) {
  const tricksBefore = game.trickHistory.length;
  game.applyAction(action);
  draw();
  if (game.trickHistory.length > tricksBefore) {
    const trick = game.trickHistory[game.trickHistory.length - 1];
    draw({ completedTrick: trick });
    logLine(`<span class="who">${SEAT_SHORT[trick.winner]}</span> won the trick`, '');
    await delay(TRICK_PAUSE);
  }
}

// ---- Hint (Phase 1: heuristic suggestion) -------------------------------

function doHint() {
  if (!resolveHuman || !currentDecision || currentDecision.seat !== HUMAN) {
    logLine('Hint is available on your turn.', 'sys');
    return;
  }
  const d = currentDecision;
  const rec = aiAction(game, d, 'medium');

  if (d.kind === 'bid1' || d.kind === 'bid2') {
    const hand = game.hands[HUMAN];
    if (rec.type === 'pass') {
      const candidate = d.kind === 'bid1' ? game.upCard.suit : null;
      const est = candidate ? estimateTricks(hand, candidate) : null;
      logLine(`💡 Suggestion: <strong>Pass</strong>${est !== null ? ` — only ~${est.toFixed(1)} tricks in ${SUIT_NAMES[candidate]}.` : ' — no suit looks strong enough.'}`, 'sys');
    } else {
      const est = estimateTricks(hand, rec.suit);
      logLine(`💡 Suggestion: <strong>${rec.type === 'orderUp' ? 'Order up' : 'Call'} ${SUIT_NAMES[rec.suit]}</strong>${rec.alone ? ' alone' : ''} — about ${est.toFixed(1)} expected tricks.`, 'sys');
    }
    return;
  }
  if (d.kind === 'play' || d.kind === 'discard') {
    currentHint = { card: rec.card };
    draw({ enabled: true });
    logLine(`💡 Suggestion: ${d.kind === 'discard' ? 'discard' : 'play'} <strong>${cardLabel(rec.card)}</strong>.`, 'sys');
  }
}

// ---- Hand / game over ---------------------------------------------------

function handResultText() {
  const r = game.lastHandResult;
  if (r.passedOut) return 'Everyone passed — the hand is thrown in.';
  const teamName = r.team === 'NS' ? 'You + Partner' : 'Opponents';
  return `${r.label} — <strong>${teamName}</strong> +${r.points}`;
}

function handleHandOver() {
  const r = game.lastHandResult;
  const cls = r.passedOut ? 'sys' : (r.team === 'NS' ? 'good' : 'bad');
  logLine(handResultText(), cls);
  draw();
  return new Promise((res) => {
    showModal(
      `<h2>Hand ${game.handNumber}</h2><p>${handResultText()}</p>
       <p>Score — You + Partner <strong>${game.scores.NS}</strong> · Opponents <strong>${game.scores.EW}</strong></p>`,
      [{ label: 'Continue', onClick: () => { hideModal(); res(); } }],
    );
  });
}

function handleGameOver() {
  const win = game.winningTeam();
  const won = win === 'NS';
  logLine(won ? 'You win the game! 🎉' : 'Opponents win the game.', won ? 'good' : 'bad');
  showModal(
    `<h2>${won ? 'You win! 🎉' : 'Opponents win'}</h2>
     <p>Final score — You + Partner <strong>${game.scores.NS}</strong> · Opponents <strong>${game.scores.EW}</strong></p>
     <p style="margin-top:12px;color:var(--muted)">Coaching review & stats are coming in the next build.</p>`,
    [{ label: 'New Game', onClick: () => { hideModal(); startNewGame(); } }],
  );
}

// ---- Main loop ----------------------------------------------------------

async function gameLoop() {
  while (true) {
    const decision = game.currentDecision();
    currentDecision = decision;

    if (!decision) {
      await handleHandOver();
      if (game.isGameOver()) { handleGameOver(); return; }
      game.nextHand();
      logHandStart();
      draw();
      continue;
    }

    if (decision.seat === HUMAN) {
      draw({ enabled: true });
      const action = await waitForHuman();
      logAction(decision, action);
      await applyAndAdvance(decision, action);
    } else {
      draw({ enabled: false });
      await delay(AI_DELAY);
      const action = aiAction(game, decision, difficulty);
      logAction(decision, action);
      await applyAndAdvance(decision, action);
    }
  }
}

// ---- Lifecycle ----------------------------------------------------------

function startNewGame() {
  game = new EuchreGame({ scoreTarget: 10, stickTheDealer: true, allowGoAlone: true });
  currentHint = null;
  clearLog();
  logLine('New game — first to 10 points.', 'sys');
  logHandStart();
  draw();
  gameLoop();
}

function init() {
  document.getElementById('difficulty').addEventListener('change', (e) => {
    difficulty = e.target.value;
    logLine(`Difficulty set to ${e.target.value}.`, 'sys');
  });
  document.getElementById('new-game').addEventListener('click', () => {
    showModal('<h2>Start a new game?</h2><p>The current game will be abandoned.</p>', [
      { label: 'Cancel', cls: 'ghost', onClick: hideModal },
      { label: 'New Game', onClick: () => { hideModal(); startNewGame(); } },
    ]);
  });
  document.getElementById('hint-btn').addEventListener('click', doHint);
  startNewGame();
}

init();
