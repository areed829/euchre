# Euchre Trainer — make targets
#   make run    start the server and open the game
#   make test   run the headless self-play validation
#
# Override defaults like:  make run PORT=9000   |   make test GAMES=5000

PORT  ?= 8777
GAMES ?= 1000
URL   := http://localhost:$(PORT)

.DEFAULT_GOAL := help
.PHONY: help run serve open test stop

help:
	@echo "Euchre Trainer — available commands:"
	@echo "  make run     Start the local server and open the game in your browser"
	@echo "  make serve   Start the local server only (no browser auto-open)"
	@echo "  make open    Open the game in your browser (server must be running)"
	@echo "  make test    Run headless self-play validation (GAMES=$(GAMES))"
	@echo "  make stop    Stop any server running on port $(PORT)"
	@echo ""
	@echo "Variables:  PORT=$(PORT)   GAMES=$(GAMES)"

run:
	@echo "Euchre Trainer → $(URL)   (press Ctrl+C to stop)"
	@( sleep 1; open "$(URL)" ) &
	@python3 -m http.server $(PORT)

serve:
	@echo "Euchre Trainer serving at $(URL)   (press Ctrl+C to stop)"
	@python3 -m http.server $(PORT)

open:
	@open "$(URL)"

test:
	@node tools/selfplay.mjs $(GAMES)

stop:
	@pids=$$(lsof -ti tcp:$(PORT)); \
	if [ -n "$$pids" ]; then kill $$pids && echo "Stopped server on port $(PORT)."; \
	else echo "No server running on port $(PORT)."; fi
