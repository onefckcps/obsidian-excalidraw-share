#!/usr/bin/env bash
# patch-excalidraw.sh
# Patches @excalidraw/excalidraw to use 987px as the mobile breakpoint
# instead of the hardcoded 730px (MQ_MAX_WIDTH_PORTRAIT).
#
# This makes Excalidraw render the mobile bottom toolbar at ≤987px
# instead of ≤730px, matching our responsive design breakpoint.
#
# Version-agnostic: searches all chunks in dist/dev and dist/prod instead
# of relying on hardcoded chunk hashes that change between versions.
#
# Run automatically via `npm install` (postinstall hook in package.json).

set -e

EXCALIDRAW_DIR="node_modules/@excalidraw/excalidraw/dist"
OLD_VALUE="730"
NEW_VALUE="987"

if [ ! -d "$EXCALIDRAW_DIR" ]; then
  echo "[patch-excalidraw] Warning: $EXCALIDRAW_DIR not found (skipping)"
  exit 0
fi

patched=0

# Dev build: readable constant name, e.g. "var MQ_MAX_WIDTH_PORTRAIT = 730;"
# (prefix/suffix vary between versions: var/let/const, semicolon, spacing)
for f in "$EXCALIDRAW_DIR"/dev/*.js; do
  [ -f "$f" ] || continue
  if grep -qE "MQ_MAX_WIDTH_PORTRAIT = ${OLD_VALUE}" "$f"; then
    sed -i -E "s/MQ_MAX_WIDTH_PORTRAIT = ${OLD_VALUE}/MQ_MAX_WIDTH_PORTRAIT = ${NEW_VALUE}/g" "$f"
    echo "[patch-excalidraw] Patched dev: $(basename "$f") (MQ_MAX_WIDTH_PORTRAIT ${OLD_VALUE} → ${NEW_VALUE})"
    patched=$((patched + 1))
  fi
done

# Prod build: minified, constant inlined as e.g. "XX=730," — match a two-letter
# minified identifier assigned the value 730 followed by a comma.
for f in "$EXCALIDRAW_DIR"/prod/*.js; do
  [ -f "$f" ] || continue
  # Skip files already patched (value 987 present with same pattern)
  if grep -qE "[A-Za-z_$][A-Za-z0-9_$]=${NEW_VALUE}," "$f" && ! grep -qE "[A-Za-z_$][A-Za-z0-9_$]=${OLD_VALUE}," "$f"; then
    continue
  fi
  if grep -qE "[A-Za-z_$][A-Za-z0-9_$]=${OLD_VALUE}," "$f"; then
    sed -i -E "s/([A-Za-z_\$][A-Za-z0-9_\$])=${OLD_VALUE},/\1=${NEW_VALUE},/g" "$f"
    echo "[patch-excalidraw] Patched prod: $(basename "$f") (breakpoint ${OLD_VALUE} → ${NEW_VALUE})"
    patched=$((patched + 1))
  fi
done

if [ "$patched" -eq 0 ]; then
  echo "[patch-excalidraw] No breakpoint pattern found in @excalidraw/excalidraw (already patched or layout changed)"
fi

# ─── @excalidraw/common (form-factor breakpoints) ───
# Newer versions moved breakpoint logic to @excalidraw/common:
#   MQ_MAX_MOBILE = 599  (phone cutoff)
#   MQ_MAX_TABLET = 1180 (tablet cutoff)
# We raise the phone cutoff to 987 so the mobile UI shows at ≤987px.
COMMON_DIR="node_modules/@excalidraw/common/dist"
if [ -d "$COMMON_DIR" ]; then
  for f in "$COMMON_DIR"/dev/*.js; do
    [ -f "$f" ] || continue
    if grep -qE "MQ_MAX_MOBILE = 599" "$f"; then
      sed -i -E "s/MQ_MAX_MOBILE = 599/MQ_MAX_MOBILE = ${NEW_VALUE}/g" "$f"
      echo "[patch-excalidraw] Patched common dev: $(basename "$f") (MQ_MAX_MOBILE 599 → ${NEW_VALUE})"
      patched=$((patched + 1))
    fi
  done
  for f in "$COMMON_DIR"/prod/*.js; do
    [ -f "$f" ] || continue
    # Minified: two-letter identifier = 599
    if grep -qE "[A-Za-z_$][A-Za-z0-9_$]=599[,;]" "$f"; then
      sed -i -E "s/([A-Za-z_\$][A-Za-z0-9_\$])=599([,;])/\1=${NEW_VALUE}\2/g" "$f"
      echo "[patch-excalidraw] Patched common prod: $(basename "$f") (mobile breakpoint 599 → ${NEW_VALUE})"
      patched=$((patched + 1))
    fi
  done
fi

echo "[patch-excalidraw] Done."
