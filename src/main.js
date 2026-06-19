// main.js — orchestrates the game loop, human input, and AI turns.

import { EuchreGame } from './engine.js';
import { aiAction, estimateTricks } from './ai/heuristic.js';
import { mcMove, mcEvaluate } from './ai/mc-client.js';
import {
  render, logLine, clearLog, showModal, hideModal, renderReview, renderStats,
} from './ui.js';
import { reviewHand, describeAction } from './coach.js';
import { recordHand, finalizeGame, getSummary, resetStats } from './stats.js';
import { SUIT_SYMBOLS, SUIT_NAMES, cardLabel } from './cards.js';
import { SEAT_SHORT } from './rules.js';

const HUMAN = 0;
let game;
let difficulty = 'medium';
let resolveHuman = null;
let currentDecision = null;
let currentHint = null;
let gameId = 0;
const sessionReviews = [];          // coaching reviews this game
const reviewCache = new Map();      // handNumber -> Promise<review>, computed once

// Review a hand once; on completion, record it to session + persistent stats.
function getHandReview(handNumber) {
  if (!reviewCache.has(handNumber)) {
    const gid = gameId;
    const p = reviewHand(game, handNumber, mcEvaluate, { determinizations: 60 })
      .then((r) => {
        if (r) { sessionReviews.push(r); recordHand(r, gid); }
        return r;
      })
      .catch((err) => { console.warn('Review failed:', err); return null; });
    reviewCache.set(handNumber, p);
  }
  return reviewCache.get(handNumber);
}

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

// ---- AI move selection --------------------------------------------------

async function aiDecide(decision) {
  if (difficulty === 'hard') {
    try {
      // The Monte Carlo computation itself provides the "thinking" pause.
      const [action] = await Promise.all([
        mcMove(game.exportState(), { determinizations: 40 }),
        delay(250),
      ]);
      if (action) return action;
    } catch (err) {
      console.warn('Monte Carlo failed, falling back to heuristic:', err);
    }
    return aiAction(game, decision, 'medium');
  }
  await delay(AI_DELAY);
  return aiAction(game, decision, difficulty);
}

// ---- Hint (Monte Carlo, EV-ranked) --------------------------------------

let hintBusy = false;

async function doHint() {
  if (!resolveHuman || !currentDecision || currentDecision.seat !== HUMAN) {
    logLine('Hint is available on your turn.', 'sys');
    return;
  }
  if (hintBusy) return;
  hintBusy = true;
  const d = currentDecision;
  logLine('💡 <span class="spinner" style="width:11px;height:11px;border-width:2px"></span> analyzing…', 'sys');

  let evals = null;
  try {
    ({ evals } = await mcEvaluate(game.exportState(), { determinizations: 60 }));
  } catch (err) {
    console.warn('Hint MC failed, using heuristic:', err);
  }
  hintBusy = false;

  // The player may have already acted while we were thinking.
  if (!resolveHuman || currentDecision !== d) return;

  if (!evals) return heuristicHint(d);

  const best = evals[0];
  const runner = evals[1];
  const gap = runner ? best.ev - runner.ev : null;
  const conf = gap !== null ? (gap > 0.4 ? 'clearly best' : gap > 0.1 ? 'best' : 'narrowly best') : 'best';

  if (d.kind === 'play' || d.kind === 'discard') {
    currentHint = { card: best.action.card };
    draw({ enabled: true });
    logLine(`💡 <strong>${describeAction(best.action)}</strong> — ${conf} (EV ${best.ev.toFixed(2)}).`, 'sys');
  } else {
    logLine(`💡 <strong>${capitalize(describeAction(best.action))}</strong> — ${conf} (EV ${best.ev.toFixed(2)}).`, 'sys');
  }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Fallback if the Monte Carlo worker is unavailable.
function heuristicHint(d) {
  const rec = aiAction(game, d, 'medium');
  if (d.kind === 'bid1' || d.kind === 'bid2') {
    const hand = game.hands[HUMAN];
    if (rec.type === 'pass') logLine('💡 Suggestion: <strong>Pass</strong> — no suit looks strong enough.', 'sys');
    else logLine(`💡 Suggestion: <strong>${rec.type === 'orderUp' ? 'Order up' : 'Call'} ${SUIT_NAMES[rec.suit]}</strong>${rec.alone ? ' alone' : ''} (~${estimateTricks(hand, rec.suit).toFixed(1)} tricks).`, 'sys');
  } else if (rec.card) {
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
  const handNumber = game.handNumber;
  // Kick off the review in the background so stats record even without a click.
  if (!r.passedOut) getHandReview(handNumber);
  return new Promise((res) => {
    const cont = () => { hideModal(); res(); };
    const actions = [{ label: 'Continue', onClick: cont }];
    if (!r.passedOut) {
      actions.unshift({ label: 'Review hand', cls: 'ghost', onClick: () => reviewThenContinue(handNumber, res) });
    }
    showModal(
      `<h2>Hand ${handNumber}</h2><p>${handResultText()}</p>
       <p>Score — You + Partner <strong>${game.scores.NS}</strong> · Opponents <strong>${game.scores.EW}</strong></p>`,
      actions,
    );
  });
}

async function reviewThenContinue(handNumber, resolve) {
  showModal('<div class="review"><h2><span class="spinner"></span>Analyzing your hand…</h2><p style="color:var(--muted)">Running Monte Carlo on each of your decisions.</p></div>', [], { wide: true });
  const review = await getHandReview(handNumber);   // reuses the background computation
  showModal(renderReview(review), [
    { label: 'Continue', onClick: () => { hideModal(); resolve(); } },
  ], { wide: true });
}

function showStats() {
  showModal(renderStats(getSummary()), [
    { label: 'Reset stats', cls: 'ghost', onClick: () => {
      resetStats();
      showModal(renderStats(getSummary()), [{ label: 'Close', onClick: hideModal }], { wide: true });
    } },
    { label: 'Close', onClick: hideModal },
  ], { wide: true });
}

function handleGameOver() {
  const win = game.winningTeam();
  const won = win === 'NS';
  finalizeGame(gameId, won);
  logLine(won ? 'You win the game! 🎉' : 'Opponents win the game.', won ? 'good' : 'bad');
  const reviewed = sessionReviews.filter(Boolean);
  let coachLine = '';
  if (reviewed.length) {
    const graded = reviewed.reduce((s, r) => s + r.summary.graded, 0);
    const good = reviewed.reduce((s, r) => s + r.summary.counts.good, 0);
    const acc = graded ? Math.round(100 * good / graded) : 100;
    coachLine = `<p style="margin-top:12px">Across the hands you reviewed: <strong>${acc}%</strong> best-play decisions (${graded} graded).</p>`;
  } else {
    coachLine = `<p style="margin-top:12px;color:var(--muted)">Tip: use “Review hand” after each hand to see what you could’ve played better.</p>`;
  }
  showModal(
    `<h2>${won ? 'You win! 🎉' : 'Opponents win'}</h2>
     <p>Final score — You + Partner <strong>${game.scores.NS}</strong> · Opponents <strong>${game.scores.EW}</strong></p>
     ${coachLine}`,
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
      const action = await aiDecide(decision);
      logAction(decision, action);
      await applyAndAdvance(decision, action);
    }
  }
}

// ---- Lifecycle ----------------------------------------------------------

function startNewGame() {
  game = new EuchreGame({ scoreTarget: 10, stickTheDealer: true, allowGoAlone: true });
  currentHint = null;
  gameId = Date.now();
  sessionReviews.length = 0;
  reviewCache.clear();
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
  document.getElementById('stats-btn').addEventListener('click', showStats);
  startNewGame();
}

init();
