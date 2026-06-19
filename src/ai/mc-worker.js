// ai/mc-worker.js — runs Monte Carlo off the main thread so the UI never stalls.
// Module worker: receives exported game state, returns a chosen action or a full
// evaluation of the options.

import { EuchreGame } from '../engine.js';
import { evaluateActions, bestAction } from './montecarlo.js';

self.onmessage = (e) => {
  const { id, type, state, opts } = e.data;
  try {
    const game = EuchreGame.fromState(state);
    const decision = game.currentDecision();
    if (!decision) { self.postMessage({ id, error: 'no decision pending' }); return; }

    if (type === 'evaluate') {
      const evals = evaluateActions(game, decision, opts || { determinizations: 60 });
      self.postMessage({ id, evals, decisionKind: decision.kind, seat: decision.seat });
    } else {
      const action = bestAction(game, decision, opts || { determinizations: 40 });
      self.postMessage({ id, action });
    }
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
