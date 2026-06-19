# Euchre Trainer

A local euchre simulator for macOS built to help you **improve your game**. You
play the South seat with an AI partner against two AI opponents, with difficulty
levels and (coming in the next builds) a coaching system that reviews your hands
and shows what you could have played better.

No installation, no dependencies — just modern JavaScript served locally.

## How to run

**With make** (from this folder):

```bash
make run      # start the server and open the game in your browser
make serve    # start the server only
make stop     # stop the server
make test     # run the headless self-play validation
make help     # list all commands
```

Override the port or game count: `make run PORT=9000`, `make test GAMES=5000`.

**Or** double-click **`start.command`** — same thing, no Terminal needed.

A local server is required because the app uses ES modules / Web Workers, which
browsers block from `file://`. `make run` uses Python's built-in server, so
there's nothing to install.

## Rules implemented

- 24-card deck (9, 10, J, Q, K, A in four suits)
- You (South) + Partner (North) vs West & East
- Two-round bidding: order up the up-card, then name a suit
- Right/left bower trump logic, follow-suit enforcement
- **Going alone** and **stick the dealer**
- Standard scoring (1 / 2 / 4 points, euchre = 2), first to 10

## Difficulty

- **Easy / Medium** — rule-based heuristic player (varied, beatable)
- **Hard** — Monte Carlo (PIMC) engine running in a Web Worker; ~65% game win
  rate vs the heuristic. The same engine powers the coach's "best play" reference.

## Coaching & stats

- **Review hand** (after each hand) — every decision you made, graded by Monte
  Carlo expected value: your choice vs the best play, the point cost, and why.
- **Hint** (💡) — on your turn, the EV-ranked best action with a confidence note.
- **Stats** (📊) — best-play accuracy overall and by decision type (bidding,
  leading, following, discard), your most common leaks, and a per-game trend so
  you can watch yourself improve. Saved locally in your browser (`localStorage`
  under `http://localhost:<port>`, so keep the same port between sessions).
- **Export / Import** — download your stats as a JSON backup, then re-import to
  restore them or to **merge** progress from another machine (Replace overwrites
  instead). Use this if you ever clear browser data or switch browsers.

## Project layout

```
index.html          Shell + layout
styles.css          Card-table styling
src/cards.js        Card model + trump logic (bowers, effective suit, ranking)
src/rules.js        Pure rules: legal plays, trick winner, scoring
src/engine.js       Game state machine + decision logging (for coaching)
src/ai/heuristic.js Heuristic bidding & card play
src/ai/montecarlo.js  PIMC evaluator (determinization, EV ranking)
src/ai/mc-worker.js   Web Worker entry · mc-client.js  promise wrapper
src/coach.js        Hand replay + per-decision grading & explanations
src/stats.js        Persistent trends/leaks (localStorage)
src/ui.js           Rendering + human input
src/main.js         Game loop / orchestration
tools/serve.py      No-store dev server (avoids stale modules)
tools/*.mjs         Headless validators (selfplay, mc-eval, coach-test, stats-test)
```

## Validate the engine

```bash
node tools/selfplay.mjs 1000
```

Plays 1000 AI-vs-AI games and checks rule invariants (follow-suit, tricks sum to
5, legal actions, a winner every game) plus calibration stats.

Other harnesses:

```bash
node tools/mc-eval.mjs 100 30   # Monte Carlo vs heuristic win rate
node tools/coach-test.mjs       # coaching review on a played hand
node tools/stats-test.mjs       # stats aggregation across games
```

## Roadmap

1. ✅ Playable game (engine, rules, heuristic AI, table UI)
2. ✅ Monte Carlo hard AI (Web Worker)
3. ✅ Coaching: decision logging → EV evaluation → post-game review + hints
4. ✅ Trends & stats over time (leak detection, charts)

Ideas for later: configurable rules (score-to-11, Benny), defending alone,
difficulty between medium and hard, exportable stats.
