#!/usr/bin/env bash
# patch-excalidraw.sh
# Patches @excalidraw/excalidraw to use 987px as the mobile breakpoint
# instead of the hardcoded 730px (MQ_MAX_WIDTH_PORTRAIT).
#
# This makes Excalidraw render the mobile bottom toolbar at ≤987px
# instead of ≤730px, matching our responsive design breakpoint.
#
# Run automatically via `npm install` (postinstall hook in package.json).

set -e

EXCALIDRAW_DIR="node_modules/@excalidraw/excalidraw/dist"
OLD_VALUE="730"
NEW_VALUE="987"

# Dev build: chunk-3KPV5WBD.js
DEV_CHUNK="${EXCALIDRAW_DIR}/dev/chunk-3KPV5WBD.js"
if [ -f "$DEV_CHUNK" ]; then
  if grep -q "var MQ_MAX_WIDTH_PORTRAIT = ${OLD_VALUE}" "$DEV_CHUNK"; then
    sed -i "s/var MQ_MAX_WIDTH_PORTRAIT = ${OLD_VALUE}/var MQ_MAX_WIDTH_PORTRAIT = ${NEW_VALUE}/g" "$DEV_CHUNK"
    echo "[patch-excalidraw] Patched dev build: MQ_MAX_WIDTH_PORTRAIT ${OLD_VALUE} → ${NEW_VALUE}"
  else
    echo "[patch-excalidraw] Dev build already patched or pattern not found (skipping)"
  fi
else
  echo "[patch-excalidraw] Warning: dev chunk not found at ${DEV_CHUNK}"
fi

# Prod build: chunk-FX7ZIABN.js — minified, uses NE=730
PROD_CHUNK="${EXCALIDRAW_DIR}/prod/chunk-FX7ZIABN.js"
if [ -f "$PROD_CHUNK" ]; then
  if grep -q "NE=${OLD_VALUE}," "$PROD_CHUNK"; then
    sed -i "s/NE=${OLD_VALUE},/NE=${NEW_VALUE},/g" "$PROD_CHUNK"
    echo "[patch-excalidraw] Patched prod build: NE=${OLD_VALUE} → NE=${NEW_VALUE}"
  else
    echo "[patch-excalidraw] Prod build already patched or pattern not found (skipping)"
  fi
else
  echo "[patch-excalidraw] Warning: prod chunk not found at ${PROD_CHUNK}"
fi

echo "[patch-excalidraw] Done."
