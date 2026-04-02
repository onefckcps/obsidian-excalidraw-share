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

# Security: reject default API key in production mode
if [ "$API_KEY" = "change-me-in-production" ]; then
	if [ "$MODE" = "production" ]; then
		log_error "Cannot use default API key in production mode. Set API_KEY environment variable."
		exit 1
	else
		log_warn "⚠️  Using default API key! Set API_KEY env var for production."
	fi
fi

# Build in nix develop shell (from project root)
if [ "$SKIP_BUILD" = false ]; then
	log_info "Building backend and frontend..."
	cd "$PROJECT_ROOT"
	nix develop -c bash -c "
		cd backend && cargo build --release
		cd ../frontend && npm install && npm run build
	"

	# Ensure Excalidraw font assets are in the frontend dist
	# (vite-plugin-static-copy handles this during build, but this is a safety net)
	# Excalidraw 0.17.6 loads fonts from two paths:
	#   1. Webpack chunks: /excalidraw-assets/Virgil.woff2 (canvas rendering)
	#   2. CSS @font-face: /Virgil.woff2 (SVG export)
	if [ -d "$PROJECT_ROOT/frontend/node_modules/@excalidraw/excalidraw/dist/excalidraw-assets-dev" ]; then
		if [ ! -f "$FRONTEND_DIR/excalidraw-assets/Virgil.woff2" ]; then
			log_info "Copying Excalidraw font assets to frontend dist..."
			mkdir -p "$FRONTEND_DIR/excalidraw-assets"
			cp "$PROJECT_ROOT/frontend/node_modules/@excalidraw/excalidraw/dist/excalidraw-assets-dev/"*.woff2 "$FRONTEND_DIR/excalidraw-assets/" 2>/dev/null || true
			cp "$PROJECT_ROOT/frontend/node_modules/@excalidraw/excalidraw/dist/excalidraw-assets-dev/"*.woff2 "$FRONTEND_DIR/" 2>/dev/null || true
		fi
	fi
else
	log_info "Skipping build (--no-build flag)"
fi

BINARY="$PROJECT_ROOT/backend/target/release/excalishare"
SERVER_LOG="$PROJECT_ROOT/backend/server.log"

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

# Ensure data directory exists
mkdir -p "$DATA_DIR"

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
			--api-key "$API_KEY" \
			>> "$SERVER_LOG" 2>&1 &
		echo $! > "$SERVER_PID_FILE"
		log_info "Server started (PID: $(cat $SERVER_PID_FILE))"
		# Give the server a moment to start and check if it's alive
		sleep 0.5
		if ! kill -0 "$(cat $SERVER_PID_FILE)" 2>/dev/null; then
			log_error "Server failed to start! Check logs: $SERVER_LOG"
			tail -20 "$SERVER_LOG"
			return 1
		fi
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

	# Start initial server
	> "$SERVER_LOG"  # Truncate log file
	start_server
	log_info "Server logs: tail -f $SERVER_LOG"

	# Cleanup on exit
	cleanup() {
		log_info "Shutting down..."
		stop_server
		# Kill background watch processes
		kill "$BACKEND_WATCH_PID" 2>/dev/null || true
		kill "$FRONTEND_WATCH_PID" 2>/dev/null || true
		rm -f "$SERVER_PID_FILE"
		exit 0
	}
	trap cleanup INT TERM

	# Watch backend in background using cargo watch with shell command
	# cargo watch -s runs a shell command after each successful build
	# We use -i to ignore non-source files that might trigger loops
	(
		cd "$PROJECT_ROOT"
		nix develop -c bash -c "
			cd backend
			cargo watch \
				-w src \
				-s 'cargo build --release 2>&1 && kill \$(cat \"$SERVER_PID_FILE\" 2>/dev/null) 2>/dev/null; \"$BINARY\" --listen-addr \"$LISTEN_ADDR\" --data-dir \"$DATA_DIR\" --frontend-dir \"$FRONTEND_DIR\" --base-url \"$BASE_URL\" --api-key \"$API_KEY\" >> \"$SERVER_LOG\" 2>&1 & echo \$! > \"$SERVER_PID_FILE\"; echo \"[INFO] Server restarted (PID: \$(cat $SERVER_PID_FILE))\"'
		"
	) &
	BACKEND_WATCH_PID=$!

	# Watch frontend in background - rebuild on changes
	(
		cd "$PROJECT_ROOT"
		# Run watch under nix develop to have access to inotify-tools
		nix develop -c bash -c '
			cd frontend
			debounce_timer=0
			trigger_build() {
				kill $debounce_timer 2>/dev/null || true
				(
					sleep 0.5
					if npm run build; then
						echo "[INFO] Frontend rebuilt."
					else
						echo "[WARN] Frontend build failed."
					fi
				) &
				debounce_timer=$!
			}
			if command -v inotifywait &> /dev/null; then
				inotifywait -m -r -e modify src/ | while read -r; do trigger_build; done
			elif command -v fswatch &> /dev/null; then
				fswatch -o src/ | while read -r; do trigger_build; done
			elif command -v entr &> /dev/null; then
				while true; do
					find src -type f | entr -p npm run build
					echo "[INFO] Frontend rebuilt."
				done
			else
				echo "[WARN] No file watcher found. Install inotify-tools, fswatch, or entr."
			fi
		'
	) &
	FRONTEND_WATCH_PID=$!

	log_info "Watch mode active. Press Ctrl+C to stop."
	log_info "  - Backend: watching src/ for changes (auto-rebuild + restart)..."
	log_info "  - Frontend: watching for changes..."
	log_info "  - Server logs: tail -f $SERVER_LOG"

	# Wait forever (use loop to survive signal interrupts)
	while true; do
		wait -n 2>/dev/null || sleep 1
	done
fi

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
