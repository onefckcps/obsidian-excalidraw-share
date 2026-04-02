# Fix: Obsidian Plugin Host Cursor, Laser Pointer & Follow Mode

## Problem Statement

When the host uses the Obsidian plugin for native live collaboration:
1. **Host cursor** is NOT visible to browser users
2. **Host laser pointer** is NOT visible to browser users
3. **Follow mode** (browser users following the host) does NOT work

Drawing/element sync works correctly — only pointer-related features are broken.

## Root Cause Analysis

### Bug 1: Canvas Element Not Found / Wrong Element

The plugin's [`startPointerTracking()`](obsidian-plugin/collabManager.ts:832) relies on finding the Excalidraw canvas DOM element via [`findExcalidrawCanvas()`](obsidian-plugin/collabManager.ts:909).

The search strategy is:
1. Call `getCanvasContainerFn()` → looks for `.excalidraw` inside the active leaf
2. Then search for `.excalidraw__canvas` or `canvas` inside that container
3. Fallback: search the entire document for `.excalidraw__canvas` or `.excalidraw canvas`

**Problem**: The Obsidian Excalidraw plugin by Zsolt Viczián renders its canvas inside a React root. The actual interactive canvas element may use a different class name or DOM structure than expected. The class `.excalidraw__canvas` is specific to the standalone `@excalidraw/excalidraw` React component — the Obsidian plugin may use `.excalidraw__canvas.interactive` or just a plain `<canvas>` element with different selectors.

Additionally, the Excalidraw Obsidian plugin may use **pointer capture** on the canvas, which means `pointermove` events are captured by the canvas and don't propagate to our listener in the expected way.

### Bug 2: Pointer Tracking Not Started in Polling Fallback

In [`startChangeDetection()`](obsidian-plugin/collabManager.ts:619):
- If `api.onChange` exists → calls `startEventDrivenDetection()` → calls `startPointerTracking()` ✅
- If `api.onChange` doesn't exist → calls `startPollingDetection()` → **does NOT call `startPointerTracking()`** ❌

If the Excalidraw API returned by `ea.getExcalidrawAPI()` doesn't have the `onChange` method, pointer tracking is never initialized.

### Bug 3: Insufficient Retry Logic for Canvas Discovery

The [`startPointerTracking()`](obsidian-plugin/collabManager.ts:832) method has only a single 1-second retry if the canvas isn't found. The Excalidraw view in Obsidian may take longer to render, especially on slower machines or when the view is being initialized.

### Bug 4: Follow Mode Depends on Pointer Updates

Follow mode in the frontend's [`useCollab.ts`](frontend/src/hooks/useCollab.ts:437) works by reading `scrollX`, `scrollY`, and `zoom` from `pointer_update` messages. If the host never sends pointer updates (because pointer tracking failed), follow mode has no data to work with.

## Fix Plan

### Fix 1: Improve Canvas Element Discovery

**File**: `obsidian-plugin/collabManager.ts`

Expand the canvas search to cover more DOM structures used by the Obsidian Excalidraw plugin:

```
Selectors to try (in order):
1. '.excalidraw__canvas.interactive'  (newer Excalidraw versions)
2. '.excalidraw__canvas'              (standard Excalidraw)
3. '.excalidraw canvas'               (generic fallback)
4. 'canvas'                           (last resort within container)
```

Also improve the `getCanvasContainer` in `main.ts` to search more broadly — not just the active leaf but also try to find the Excalidraw view by type.

### Fix 2: Always Start Pointer Tracking

**File**: `obsidian-plugin/collabManager.ts`

Move `startPointerTracking()` call out of `startEventDrivenDetection()` and into `startChangeDetection()` so it runs regardless of whether event-driven or polling detection is used.

```
startChangeDetection() {
  ...
  if (api.onChange) {
    startEventDrivenDetection(api);
  } else {
    startPollingDetection();
  }
  // Always start pointer tracking, regardless of detection strategy
  startPointerTracking();
}
```

### Fix 3: Robust Retry Logic for Canvas Discovery

**File**: `obsidian-plugin/collabManager.ts`

Replace the single 1-second retry with an exponential backoff retry (up to ~10 seconds total):

```
Retry schedule: 500ms, 1000ms, 2000ms, 4000ms
Total wait: ~7.5 seconds
```

This gives the Excalidraw view enough time to fully render.

### Fix 4: Add Diagnostic Logging

**File**: `obsidian-plugin/collabManager.ts`

Add detailed logging to `findExcalidrawCanvas()` and `startPointerTracking()` so we can diagnose issues:
- Log which selector matched (or none)
- Log the element found (tag, class, dimensions)
- Log when pointer events are actually firing

### Fix 5: Alternative Pointer Tracking via appState Polling

**File**: `obsidian-plugin/collabManager.ts`

As a fallback when DOM-based pointer tracking fails, add a lightweight polling mechanism that reads the cursor position from Excalidraw's `appState`. The Excalidraw API's `getAppState()` includes `cursorButton` and potentially cursor position data. Even if this doesn't provide exact cursor coordinates, it can at least send viewport data (scrollX, scrollY, zoom) which enables follow mode.

Add a periodic viewport broadcast (every ~500ms) that sends the host's current viewport state even without pointer movement. This ensures follow mode works even if cursor tracking fails.

## Files to Modify

| File | Changes |
|------|---------|
| `obsidian-plugin/collabManager.ts` | Fix canvas discovery, always start pointer tracking, add retry logic, add viewport polling fallback |
| `obsidian-plugin/main.ts` | Improve `getCanvasContainer` to search more broadly |

## Testing

1. Start a collab session from Obsidian
2. Join from browser
3. Verify host cursor is visible in browser
4. Verify host laser pointer is visible in browser
5. Verify browser user can follow the host's viewport
6. Verify drawing sync still works correctly
7. Test with different Excalidraw plugin versions
