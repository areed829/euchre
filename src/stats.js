// stats.js — persistent skill tracking. Aggregates coaching grades across games
// into category accuracy, recurring "leaks", and a per-game trend, stored in
// localStorage (with an in-memory fallback for non-browser/test use).

const KEY = 'euchre-stats-v1';
const memory = {};

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* access blocked */ }
  return null;
}

function fresh() {
  return {
    version: 1,
    totals: { hands: 0, graded: 0, good: 0, minor: 0, mistake: 0, blunder: 0, lossSum: 0 },
    categories: {},          // name -> { graded, good, lossSum }
    leaks: {},               // tag -> { count, label }
    games: [],               // { gameId, ts, graded, good, lossSum, won }
  };
}

export function load() {
  const s = storage();
  const raw = s ? s.getItem(KEY) : memory[KEY];
  if (!raw) return fresh();
  try {
    const data = JSON.parse(raw);
    return data && data.version === 1 ? data : fresh();
  } catch {
    return fresh();
  }
}

function persist(data) {
  const s = storage();
  const raw = JSON.stringify(data);
  if (s) s.setItem(KEY, raw); else memory[KEY] = raw;
}

function categoryOf(kind, isLead) {
  if (kind === 'bid1' || kind === 'bid2') return 'Bidding';
  if (kind === 'discard') return 'Discard';
  if (kind === 'play') return isLead ? 'Leading' : 'Following';
  return 'Other';
}

/** Fold one reviewed hand into the persistent stats. Order-independent. */
export function recordHand(review, gameId) {
  if (!review || !review.decisions.length) return;
  const data = load();
  data.totals.hands += 1;

  let g = data.games.find((x) => x.gameId === gameId);
  if (!g) {
    g = { gameId, ts: gameId, graded: 0, good: 0, lossSum: 0, won: null };
    data.games.push(g);
    if (data.games.length > 80) data.games.shift();
  }

  for (const d of review.decisions) {
    data.totals.graded += 1;
    data.totals[d.grade] = (data.totals[d.grade] || 0) + 1;
    data.totals.lossSum += d.loss;

    const cat = categoryOf(d.kind, d.isLead);
    const c = (data.categories[cat] ||= { graded: 0, good: 0, lossSum: 0 });
    c.graded += 1;
    if (d.grade === 'good') c.good += 1;
    c.lossSum += d.loss;

    g.graded += 1;
    if (d.grade === 'good') g.good += 1;
    g.lossSum += d.loss;

    if (d.grade !== 'good' && d.tag) {
      const l = (data.leaks[d.tag] ||= { count: 0, label: d.tagLabel || d.tag });
      l.count += 1;
    }
  }
  persist(data);
}

/** Mark the result of a game once it ends. */
export function finalizeGame(gameId, won) {
  const data = load();
  let g = data.games.find((x) => x.gameId === gameId);
  if (!g) { g = { gameId, ts: gameId, graded: 0, good: 0, lossSum: 0, won }; data.games.push(g); }
  g.won = won;
  persist(data);
}

export function resetStats() { persist(fresh()); }

/** Derived view for the UI. */
export function getSummary() {
  const d = load();
  const t = d.totals;
  const acc = t.graded ? Math.round(100 * t.good / t.graded) : null;
  const avgLoss = t.graded ? t.lossSum / t.graded : 0;

  const categories = Object.entries(d.categories).map(([name, c]) => ({
    name,
    graded: c.graded,
    accuracy: c.graded ? Math.round(100 * c.good / c.graded) : 0,
    avgLoss: c.graded ? c.lossSum / c.graded : 0,
  })).sort((a, b) => b.graded - a.graded);

  const leaks = Object.entries(d.leaks)
    .map(([tag, v]) => ({ tag, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);

  const games = d.games.map((g) => ({
    ts: g.ts,
    won: g.won,
    graded: g.graded,
    accuracy: g.graded ? Math.round(100 * g.good / g.graded) : 0,
  }));

  const wins = games.filter((g) => g.won === true).length;
  const finished = games.filter((g) => g.won !== null).length;

  return {
    hands: t.hands,
    graded: t.graded,
    accuracy: acc,
    avgLoss,
    counts: { good: t.good, minor: t.minor, mistake: t.mistake, blunder: t.blunder },
    categories,
    leaks,
    games,
    record: { wins, finished },
  };
}
