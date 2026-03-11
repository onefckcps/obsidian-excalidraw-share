#!/usr/bin/env bash
#
# Start script for Excalidraw Share server
# Usage: ./start.sh [--no-build] [--no-watch] [--production]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Parse arguments
SKIP_BUILD=false
WATCH=true
MODE="development"

while [[ $# -gt 0 ]]; do
	case $1 in
		--no-build)
			SKIP_BUILD=true
			shift
			;;
		--no-watch)
			WATCH=false
			shift
			;;
		--production)
			MODE="production"
			shift
			;;
		development|production)
			MODE="$1"
			shift
			;;
		*)
			echo "Unknown option: $1"
			echo "Usage: $0 [--no-build] [--no-watch] [--production]"
			exit 1
			;;
	esac
done

# Default values
API_KEY="${API_KEY:-change-me-in-production}"
BASE_URL="${BASE_URL:-http://localhost:8184}"
DATA_DIR="${DATA_DIR:-$PROJECT_ROOT/data/drawings}"
FRONTEND_DIR="${FRONTEND_DIR:-$PROJECT_ROOT/frontend/dist}"
LISTEN_ADDR="${LISTEN_ADDR:-127.0.0.1:8184}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
	echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
	echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
	echo -e "${RED}[ERROR]${NC} $1"
}

# Build in nix develop shell (from project root)
if [ "$SKIP_BUILD" = false ]; then
	log_info "Building backend and frontend..."
	cd "$PROJECT_ROOT"
	nix develop -c bash -c "
		cd backend && cargo build --release
		cd ../frontend && npm install && npm run build
	"
else
	log_info "Skipping build (--no-build flag)"
fi

BINARY="$PROJECT_ROOT/backend/target/release/excalishare"

# Check if binary exists (when --no-build is used)
if [ ! -f "$BINARY" ]; then
	log_error "Binary not found. Run without --no-build first."
	exit 1
fi

# Check if frontend exists (when --no-build is used)
if [ ! -d "$FRONTEND_DIR" ]; then
	log_error "Frontend not found. Run without --no-build first."
	exit 1
fi

# Watch mode: rebuild on changes
if [ "$WATCH" = true ]; then
	log_info "Starting watch mode..."

	# Create a PID file for the server
	SERVER_PID_FILE="$PROJECT_ROOT/.server.pid"

	# Function to start server
	start_server() {
		"$BINARY" \
			--listen-addr "$LISTEN_ADDR" \
			--data-dir "$DATA_DIR" \
			--frontend-dir "$FRONTEND_DIR" \
			--base-url "$BASE_URL" \
			--api-key "$API_KEY" &
		echo $! > "$SERVER_PID_FILE"
		log_info "Server started (PID: $(cat $SERVER_PID_FILE))"
	}

	# Function to stop server
	stop_server() {
		if [ -f "$SERVER_PID_FILE" ]; then
			local pid=$(cat "$SERVER_PID_FILE")
			if kill -0 "$pid" 2>/dev/null; then
				log_info "Stopping server (PID: $pid)..."
				kill "$pid" 2>/dev/null || true
				wait "$pid" 2>/dev/null || true
			fi
			rm -f "$SERVER_PID_FILE"
		fi
	}

	# Function to rebuild and restart
	rebuild_and_restart() {
		log_info "Rebuilding..."
		cd "$PROJECT_ROOT"
		nix develop -c bash -c "
			cd backend && cargo build --release
			cd ../frontend && npm run build
		"
		stop_server
		start_server
	}

	# Start initial server
	start_server

	# Cleanup on exit
	cleanup() {
		log_info "Shutting down..."
		stop_server
		rm -f "$SERVER_PID_FILE"
		exit 0
	}
	trap cleanup INT TERM

	# Watch backend in background - rebuild and restart on changes
	(
		cd "$PROJECT_ROOT/backend"
		while true; do
			nix develop -c cargo watch -x build
			rebuild_and_restart
		done
	) &
	BACKEND_WATCH_PID=$!

	# Watch frontend in background - rebuild on changes
	(
		cd "$PROJECT_ROOT/frontend"
		while true; do
			if command -v fswatch &> /dev/null; then
				fswatch -o src/ | xargs -n1 npm run build
			elif command -v entr &> /dev/null; then
				find src -type f | entr -r npm run build
			elif command -v inotifywait &> /dev/null; then
				inotifywait -m -r -e modify src/ | while read -r; do
					npm run build
				done
			else
				log_warn "No file watcher found. Install fswatch, entr, or inotify-tools."
				break
			fi
			log_info "Frontend rebuilt."
		done
	) &
	FRONTEND_WATCH_PID=$!

	log_info "Watch mode active. Press Ctrl+C to stop."
	log_info "  - Backend: watching for changes (auto-restart)..."
	log_info "  - Frontend: watching for changes..."

	# Wait forever
	wait
fi

# Create data directory
mkdir -p "$DATA_DIR"

log_info "Starting Excalidraw Share server..."
log_info "  Mode:      $MODE"
log_info "  Listen:    $LISTEN_ADDR"
log_info "  Data dir:  $DATA_DIR"
log_info "  Frontend:  $FRONTEND_DIR"
log_info "  Base URL:  $BASE_URL"
log_info ""

# Run the server
exec "$BINARY" \
	--listen-addr "$LISTEN_ADDR" \
	--data-dir "$DATA_DIR" \
	--frontend-dir "$FRONTEND_DIR" \
	--base-url "$BASE_URL" \
	--api-key "$API_KEY"
