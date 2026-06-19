// ai/mc-client.js — promise-based wrapper around the Monte Carlo Web Worker,
// with a graceful fallback to running MC on the main thread if workers are
// unavailable (e.g. opened from file://).

import { bestAction, evaluateActions } from './montecarlo.js';
import { EuchreGame } from '../engine.js';

let worker = null;
let nextId = 1;
const pending = new Map();
let workerBroken = false;

function ensureWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ...rest } = e.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (rest.error) entry.reject(new Error(rest.error));
      else entry.resolve(rest);
    };
    worker.onerror = (err) => {
      workerBroken = true;
      for (const [, entry] of pending) entry.reject(err);
      pending.clear();
    };
  } catch {
    workerBroken = true;
  }
  return worker;
}

function call(type, state, opts) {
  const w = ensureWorker();
  if (!w) {
    // Synchronous fallback on the main thread.
    const game = EuchreGame.fromState(state);
    const decision = game.currentDecision();
    if (type === 'evaluate') {
      return Promise.resolve({ evals: evaluateActions(game, decision, opts), decisionKind: decision.kind, seat: decision.seat });
    }
    return Promise.resolve({ action: bestAction(game, decision, opts) });
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, state, opts });
  });
}

/** Best action for the seat to act in `state`. */
export async function mcMove(state, opts = { determinizations: 40 }) {
  const { action } = await call('move', state, opts);
  return action;
}

/** Full EV-ranked evaluation of every option for the seat to act in `state`. */
export async function mcEvaluate(state, opts = { determinizations: 60 }) {
  return call('evaluate', state, opts);
}
