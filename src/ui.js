// ui.js — all DOM rendering and human-input wiring.

import {
  SUIT_SYMBOLS, SUIT_COLOR, SUIT_NAMES, cardLabel, cardsEqual, isTrump,
} from './cards.js';
import { SEAT_SHORT, SEAT_NAMES, teamOf, partnerOf } from './rules.js';

const $ = (id) => document.getElementById(id);

// ---- Card elements ------------------------------------------------------

export function cardEl(card, { small = false } = {}) {
  const el = document.createElement('div');
  el.className = `card ${SUIT_COLOR[card.suit] === 'red' ? 'red' : ''} ${small ? 'small' : ''}`;
  const sym = SUIT_SYMBOLS[card.suit];
  el.innerHTML = `
    <div class="corner top">${card.rank}<br>${sym}</div>
    <div class="pip">${sym}</div>
    <div class="corner bottom">${card.rank}<br>${sym}</div>`;
  return el;
}

function backRow(n, vertical = false) {
  const wrap = document.createElement('div');
  wrap.className = `mini-hand ${vertical ? 'vertical' : ''}`;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('div');
    b.className = 'cardback';
    wrap.appendChild(b);
  }
  return wrap;
}

// ---- Seats --------------------------------------------------------------

const SEAT_DOM = { 0: 'seat-south', 1: 'seat-west', 2: 'seat-north', 3: 'seat-east' };

function renderSeats(game, decision) {
  for (const seat of [0, 1, 2, 3]) {
    const node = $(SEAT_DOM[seat]);
    node.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'seat-label';
    if (decision && decision.seat === seat) label.classList.add('active');
    if (game.maker === seat) label.classList.add('maker');
    if (seat === game.dealer) label.classList.add('is-dealer');

    const name = document.createElement('span');
    name.textContent = SEAT_SHORT[seat];
    label.appendChild(name);

    if (game.maker === seat) {
      const m = document.createElement('span');
      m.className = 'chip';
      m.textContent = 'caller';
      label.appendChild(m);
    }
    if (seat === game.dealer) {
      const d = document.createElement('span');
      d.className = 'dealer-btn';
      d.textContent = 'D';
      d.title = seat === 0 ? 'You are the dealer' : 'Dealer';
      label.appendChild(d);
    }
    node.appendChild(label);

    if (seat === game.sittingOut) {
      const out = document.createElement('div');
      out.className = 'sitting-out';
      out.textContent = '(sitting out)';
      node.appendChild(out);
      continue;
    }

    // Card backs for the other players; your own hand is shown below the table.
    if (seat !== 0) {
      const vertical = seat === 1 || seat === 3;
      node.appendChild(backRow(game.hands[seat].length, vertical));
    }

    if (game.phase === 'play' || game.phase === 'handOver') {
      const tricks = document.createElement('div');
      tricks.className = 'seat-tricks';
      tricks.textContent = `tricks: ${game.tricksWonBySeat[seat]}`;
      node.appendChild(tricks);
    }
  }
}

// ---- Trick area / center ------------------------------------------------

function renderCenter(game, decision, opts) {
  const trumpEl = $('trump-indicator');
  const trickEl = $('trick-area');
  const msgEl = $('center-msg');
  trickEl.innerHTML = '';
  msgEl.textContent = '';

  if (game.trump) {
    trumpEl.innerHTML = `Trump: <span class="suit-${game.trump}">${SUIT_SYMBOLS[game.trump]} ${SUIT_NAMES[game.trump]}</span>` +
      (game.maker !== null ? ` — called by ${SEAT_SHORT[game.maker]}${game.alone ? ' (alone)' : ''}` : '');
  } else {
    trumpEl.textContent = '';
  }

  // Bidding: show the up-card.
  if (game.phase === 'bidding1' && game.upCard) {
    const c = cardEl(game.upCard);
    c.style.position = 'absolute';
    c.style.top = '50%'; c.style.left = '50%';
    c.style.transform = 'translate(-50%,-50%)';
    trickEl.appendChild(c);
    msgEl.textContent = 'Up-card for bidding';
    return;
  }
  if (game.phase === 'bidding2') {
    msgEl.textContent = `${SUIT_SYMBOLS[game.turnedDownCard.suit]} turned down — name a different suit`;
    return;
  }

  // Play: show current (or just-completed) trick.
  const trick = opts.completedTrick || { plays: game.currentTrick.plays };
  const winner = opts.completedTrick ? opts.completedTrick.winner : null;
  for (const p of trick.plays) {
    const wrap = document.createElement('div');
    wrap.className = `trick-card pos-${p.seat}` + (p.seat === winner ? ' winner' : '');
    wrap.appendChild(cardEl(p.card, { small: true }));
    trickEl.appendChild(wrap);
  }
  if (opts.completedTrick) {
    msgEl.textContent = `${SEAT_SHORT[winner]} won the trick`;
  }
}

// ---- Your hand ----------------------------------------------------------

function renderHand(game, decision, ctx) {
  const handEl = $('my-hand');
  handEl.innerHTML = '';
  const hand = game.hands[0];
  const interactive = ctx.enabled && decision && decision.seat === 0 &&
    (decision.kind === 'play' || decision.kind === 'discard');
  const legalCards = interactive ? decision.options.map((o) => o.card) : [];

  for (const card of hand) {
    const el = cardEl(card);
    const isLegal = legalCards.some((c) => cardsEqual(c, card));
    if (interactive) {
      if (isLegal) {
        el.classList.add('playable');
        el.addEventListener('click', () => ctx.onAction({ type: decision.kind, card }));
      } else {
        el.classList.add('disabled');
      }
    }
    if (ctx.hint && cardsEqual(ctx.hint.card, card)) el.classList.add('hint');
    handEl.appendChild(el);
  }
}

// ---- Action bar ---------------------------------------------------------

function suitSpan(suit) {
  return `<span class="suit-${suit}">${SUIT_SYMBOLS[suit]}</span>`;
}

function renderActionBar(game, decision, ctx) {
  const bar = $('action-bar');
  bar.innerHTML = '';

  if (!decision) return;

  if (decision.seat !== 0) {
    const p = document.createElement('span');
    p.className = 'prompt';
    p.textContent = `Waiting for ${SEAT_SHORT[decision.seat]}…`;
    bar.appendChild(p);
    return;
  }
  if (!ctx.enabled) return;

  const addBtn = (label, action, cls = '') => {
    const b = document.createElement('button');
    b.className = `btn bid-btn ${cls}`;
    b.innerHTML = label;
    b.addEventListener('click', () => ctx.onAction(action));
    bar.appendChild(b);
  };

  if (decision.kind === 'bid1') {
    const suit = game.upCard.suit;
    const prompt = document.createElement('span');
    prompt.className = 'prompt';
    prompt.innerHTML = `Order up ${suitSpan(suit)} ${SUIT_NAMES[suit]}?`;
    bar.appendChild(prompt);
    addBtn(`Order Up ${suitSpan(suit)}`, { type: 'orderUp', suit }, 'primary');
    if (game.options.allowGoAlone) addBtn(`Alone ${suitSpan(suit)}`, { type: 'orderUp', suit, alone: true });
    addBtn('Pass', { type: 'pass' }, 'ghost');
    return;
  }

  if (decision.kind === 'bid2') {
    const prompt = document.createElement('span');
    prompt.className = 'prompt';
    prompt.textContent = 'Name trump:';
    bar.appendChild(prompt);
    for (const opt of decision.options) {
      if (opt.type === 'pass') { addBtn('Pass', opt, 'ghost'); continue; }
      const label = opt.alone ? `Alone ${suitSpan(opt.suit)}` : `Call ${suitSpan(opt.suit)}`;
      addBtn(label, opt, opt.alone ? '' : 'primary');
    }
    return;
  }

  if (decision.kind === 'discard') {
    const p = document.createElement('span');
    p.className = 'prompt';
    p.textContent = 'You picked up — click a card to discard.';
    bar.appendChild(p);
    return;
  }
  if (decision.kind === 'play') {
    const p = document.createElement('span');
    p.className = 'prompt';
    p.textContent = 'Your turn — click a card to play.';
    bar.appendChild(p);
  }
}

// ---- Scores & log -------------------------------------------------------

function renderScores(game) {
  $('score-ns').textContent = game.scores.NS;
  $('score-ew').textContent = game.scores.EW;
  $('score-target').textContent = game.options.scoreTarget;
}

export function logLine(html, cls = '') {
  const ul = $('log');
  const li = document.createElement('li');
  if (cls) li.className = cls;
  li.innerHTML = html;
  ul.appendChild(li);
  while (ul.children.length > 200) ul.removeChild(ul.firstChild);
  ul.scrollTop = ul.scrollHeight;
}

export function clearLog() { $('log').innerHTML = ''; }

// ---- Modal --------------------------------------------------------------

export function showModal(html, actions = [], { wide = false } = {}) {
  const modal = $('modal');
  modal.classList.toggle('wide', wide);
  modal.innerHTML = html;
  const row = document.createElement('div');
  row.className = 'modal-actions';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn ${a.cls || 'primary'}`;
    b.textContent = a.label;
    b.addEventListener('click', a.onClick);
    row.appendChild(b);
  }
  if (actions.length) modal.appendChild(row);
  $('modal-backdrop').hidden = false;
}

/** Render a coaching review (from coach.reviewHand) into modal HTML. */
export function renderReview(review) {
  if (!review) {
    return `<div class="review"><h2>Review unavailable</h2><p>Couldn't analyze this hand.</p></div>`;
  }
  const s = review.summary;
  const c = s.counts;
  const items = review.decisions.map((r) => {
    const showBest = r.grade !== 'good';
    const delta = showBest ? `<span class="rev-delta">−${r.loss.toFixed(2)}</span>` : '';
    const head = `<div class="rev-head"><span class="badge ${r.grade}">${r.gradeLabel}</span>` +
      `<span class="rev-ctx">${r.context}</span>${delta}</div>`;
    const body = showBest
      ? `<div class="rev-body">You ${r.chosenText} · <b>Best: ${r.bestText}</b></div>`
      : `<div class="rev-body">You ${r.chosenText} <span class="pill">${r.sameAsBest ? 'best play' : 'fine'}</span></div>`;
    const reason = (showBest && r.reason) ? `<div class="rev-reason">${r.reason}</div>` : '';
    return `<li class="g-${r.grade}">${head}${body}${reason}</li>`;
  }).join('');
  const plural = (n) => (n === 1 ? '' : 's');
  return `<div class="review">
    <h2>Hand ${review.handNumber} review</h2>
    <div class="review-sub">Trump ${SUIT_SYMBOLS[review.trump] || '—'} · ${review.result?.label || ''} · your accuracy ${s.accuracy}%</div>
    <div class="review-summary">
      <span class="pill" style="color:var(--good)">${c.good} good</span>
      <span class="pill" style="color:#f2c94c">${c.minor} minor</span>
      <span class="pill" style="color:#ff922b">${c.mistake} mistake${plural(c.mistake)}</span>
      <span class="pill" style="color:var(--bad)">${c.blunder} blunder${plural(c.blunder)}</span>
    </div>
    <ul class="review-list">${items || '<li>No gradable decisions this hand.</li>'}</ul>
  </div>`;
}
export function hideModal() { $('modal-backdrop').hidden = true; }

// ---- Stats panel --------------------------------------------------------

function accColor(v) {
  if (v >= 80) return 'var(--good)';
  if (v >= 60) return '#f2c94c';
  return '#ff922b';
}

function trendChart(games) {
  const pts = games.filter((g) => g.graded > 0);
  if (pts.length < 2) return `<div class="rev-reason">Finish a couple of games to see your trend.</div>`;
  const w = 600, h = 130, pad = 26;
  const n = pts.length;
  const x = (i) => pad + (i * (w - 2 * pad)) / (n - 1);
  const y = (v) => h - pad - (v / 100) * (h - 2 * pad);
  const line = pts.map((g, i) => `${x(i).toFixed(1)},${y(g.accuracy).toFixed(1)}`).join(' ');
  const grid = [0, 50, 100].map((v) =>
    `<line x1="${pad}" y1="${y(v)}" x2="${w - pad}" y2="${y(v)}" stroke="#2a323a"/>` +
    `<text x="4" y="${y(v) + 4}" fill="#7a8693" font-size="10">${v}</text>`).join('');
  const dots = pts.map((g, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(g.accuracy).toFixed(1)}" r="4" fill="${g.won === false ? 'var(--bad)' : g.won === true ? 'var(--good)' : 'var(--accent)'}"><title>Game ${i + 1}: ${g.accuracy}%${g.won === true ? ' (won)' : g.won === false ? ' (lost)' : ''}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="trend-svg">${grid}` +
    `<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}</svg>`;
}

export function renderStats(s) {
  if (!s.graded) {
    return `<div class="review"><h2>Your stats</h2>
      <p style="color:var(--muted)">No decisions graded yet. Every hand you play is reviewed automatically — play a few and your accuracy, weak spots, and trend over time will show up here.</p></div>`;
  }
  const cats = s.categories.map((c) => `
    <div class="cat-row">
      <span class="cat-name">${c.name}</span>
      <div class="cat-bar"><div class="cat-fill" style="width:${c.accuracy}%;background:${accColor(c.accuracy)}"></div></div>
      <span class="cat-val">${c.accuracy}%</span>
      <span class="cat-n">${c.graded}</span>
    </div>`).join('');
  const leaks = s.leaks.slice(0, 6).map((l) =>
    `<li><span class="leak-count">${l.count}×</span> ${l.label}</li>`).join('') || '<li class="rev-reason">No recurring leaks — nice.</li>';
  const rec = s.record.finished ? `${s.record.wins}/${s.record.finished} games won` : 'no games finished yet';

  return `<div class="review stats">
    <h2>Your stats</h2>
    <div class="review-sub">${s.hands} hands · ${s.graded} decisions graded · ${rec}</div>
    <div class="stat-big">
      <div><div class="stat-num" style="color:${accColor(s.accuracy)}">${s.accuracy}%</div><div class="stat-lbl">best-play accuracy</div></div>
      <div><div class="stat-num">${s.avgLoss.toFixed(2)}</div><div class="stat-lbl">avg pts lost / decision</div></div>
      <div><div class="stat-num">${s.counts.mistake + s.counts.blunder}</div><div class="stat-lbl">mistakes + blunders</div></div>
    </div>
    <h3 class="stat-h">Accuracy by decision type</h3>
    <div class="cat-list">${cats}</div>
    <h3 class="stat-h">Your improvement (per-game accuracy)</h3>
    ${trendChart(s.games)}
    <h3 class="stat-h">Most common leaks</h3>
    <ul class="leak-list">${leaks}</ul>
  </div>`;
}

// ---- Master render ------------------------------------------------------

export function render(game, ctx = {}) {
  const decision = ctx.decisionOverride !== undefined ? ctx.decisionOverride : game.currentDecision();
  renderScores(game);
  renderSeats(game, decision);
  renderCenter(game, decision, ctx);
  renderHand(game, decision, ctx);
  renderActionBar(game, decision, ctx);
}
