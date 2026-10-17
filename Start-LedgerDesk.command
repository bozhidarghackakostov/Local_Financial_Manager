#!/bin/bash
# ==============================================================================
# LedgerDesk — Private Offline Finance Manager
# macOS Double-Clickable Launcher (.command)
# Starts the local backend server and opens the web application at once.
# ==============================================================================

# Ensure script runs from project root directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3001}"
URL="http://${HOST}:${PORT}"

clear
echo "=================================================================="
echo "  LedgerDesk — Private Offline Finance Manager"
echo "=================================================================="
echo "  Project directory : $SCRIPT_DIR"
echo "  Local server URL  : $URL"
echo "  Database file     : $SCRIPT_DIR/data/ledgerdesk.sqlite"
echo "  Backups directory : $SCRIPT_DIR/data/backups/"
echo "=================================================================="

# Ensure Node.js is located in PATH (including Homebrew, NVM, Volta, asdf, fnm)
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/current/bin:$HOME/.volta/bin:$HOME/.asdf/shims:$HOME/.fnm/current/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  # Search for any nvm node installations
  NVM_NODE=$(find "$HOME/.nvm/versions/node" -maxdepth 2 -name "node" 2>/dev/null | sort -V | tail -n 1)
  if [[ -n "$NVM_NODE" ]]; then
    export PATH="$(dirname "$NVM_NODE"):$PATH"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[Error] Node.js was not found in your PATH."
  echo "Please install Node.js (https://nodejs.org) or install via Homebrew:"
  echo "  brew install node"
  echo ""
  read -n 1 -s -r -p "Press any key to close this window..."
  echo ""
  exit 1
fi

echo "  Node.js binary    : $(which node) ($(node -v))"
echo ""

# If already running on this port, just open the browser and exit cleanly
if lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  echo "LedgerDesk server is already running on $URL"
  echo "Opening $URL in your browser..."
  open "$URL"
  exit 0
fi

# Ensure dist/server.js exists (auto-build if needed)
if [[ ! -f "dist/server.js" ]]; then
  echo "Compiling local server bundle (dist/server.js)..."
  if [[ -x "node_modules/.bin/esbuild" ]]; then
    ./node_modules/.bin/esbuild src/server/server.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.js
  else
    npx esbuild src/server/server.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.js
  fi
fi

# Launch server in background
echo "Starting LedgerDesk local server..."
node dist/server.js &
SERVER_PID=$!

# Trap signals for graceful shutdown when Terminal window is closed or Ctrl+C is pressed
cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "Stopping LedgerDesk server (PID $SERVER_PID)..."
    kill -TERM "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup INT TERM EXIT

# Wait for server to respond on /api/health
READY=0
for ((i=1; i<=30; i++)); do
  if curl -s "${URL}/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.2
done

if [[ $READY -eq 1 ]]; then
  echo "Server is ready! Opening LedgerDesk in your browser..."
  open "$URL"
else
  echo "[Warning] Server took longer than expected to respond. Opening browser..."
  open "$URL"
fi

echo ""
echo "=================================================================="
echo "  ✓ LedgerDesk is ACTIVE at $URL"
echo "  ✓ All data saved locally in: data/ledgerdesk.sqlite"
echo "  ✓ Press Ctrl+C in this Terminal window to stop the server"
echo "=================================================================="
echo ""

# Keep running until user stops it with Ctrl+C
wait "$SERVER_PID"
