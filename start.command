#!/bin/bash
# Double-click this file to launch the Euchre Trainer in your browser.
cd "$(dirname "$0")"
PORT=8777
URL="http://localhost:$PORT"
echo "Euchre Trainer — serving on $URL"
echo "Close this window (or press Ctrl+C) to stop the server."
# Open the browser shortly after the server starts.
( sleep 1; open "$URL" ) &
python3 tools/serve.py "$PORT"
