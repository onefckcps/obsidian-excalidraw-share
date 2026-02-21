#!/usr/bin/env bash
#
# Start script for Excalidraw Share server
# Usage: ./start.sh [development|production]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Default values
MODE="${1:-development}"
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

# Check if binary exists
BINARY="$PROJECT_ROOT/backend/target/release/excalidraw-share"

if [ ! -f "$BINARY" ]; then
	log_warn "Binary not found. Building..."
	cd "$PROJECT_ROOT/backend"
	cargo build --release
fi

# Check if frontend exists
if [ ! -d "$FRONTEND_DIR" ]; then
	log_warn "Frontend not found. Building..."
	cd "$PROJECT_ROOT/frontend"
	npm install
	npm run build
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
