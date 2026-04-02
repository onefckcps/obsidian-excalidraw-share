# Plan: Upgrade Excalidraw from 0.17.6 to 0.18.0

## Context & Problem Discovery

During the font embedding investigation, we discovered the **real root cause** of the ugly default font rendering:

### Font Family ID Mismatch

The **Obsidian Excalidraw plugin** (by zsviczian) uses Excalidraw 0.18.x internally, which has **new font families**:

| ID | 0.17.6 Font | 0.18.0 Font |
|----|-------------|-------------|
| 1 | Virgil (hand-drawn) | Virgil (legacy) |
| 2 | Helvetica (normal) | Helvetica (legacy) |
| 3 | Cascadia (code) | Cascadia (legacy) |
| 4 | Assistant | Assistant (legacy) |
| **5** | ❌ **Unknown** | **Excalifont** (new hand-drawn) |
| 6 | ❌ Unknown | Nunito (new normal) |
| 7 | ❌ Unknown | Comic Shanns (new code) |
| 8 | ❌ Unknown | Liberation Sans (new normal) |

Drawings published from Obsidian use `fontFamily: 5` (Excalifont), but our frontend's Excalidraw 0.17.6 doesn't recognize ID 5 and falls back to the browser default font.

### What We Already Fixed (Font Self-Hosting)

We already implemented font self-hosting for 0.17.6:
- Added `vite-plugin-static-copy` to copy `.woff2` fonts to `dist/excalidraw-assets/` and `dist/`
- Updated `flake.nix` with new `npmDepsHash`
- Updated `start.sh` with fallback font copy
- Fonts load correctly (200 OK) — but the wrong font is rendered because of the ID mismatch

## Research Tasks

The agent should investigate the following:

### 1. Excalidraw 0.18.0 Breaking Changes

Research the full list of breaking changes from the [CHANGELOG](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/CHANGELOG.md) and [releases page](https://github.com/excalidraw/excalidraw/releases):

**Known breaking changes:**
- **UMD → ESM bundle**: The package no longer ships UMD bundles. Import paths change.
- **`excalidrawAPI` prop → `onExcalidrawAPI`**: The callback prop was renamed.
- **Type import paths changed**: 
  - Old: `@excalidraw/excalidraw/types/element/types`
  - New: `@excalidraw/excalidraw/element/types`
- **New CSS import required**: `import '@excalidraw/excalidraw/index.css'`
- **Font self-hosting path changed**: `dist/prod/fonts/` instead of `excalidraw-assets-dev/`
- **New font families**: Excalifont, Nunito, Comic Shanns replace Virgil, Helvetica, Cascadia as defaults

**Research needed:**
- Are there any other breaking changes not listed above?
- Does the `LiveCollaborationTrigger` component still exist?
- Has the `updateScene` API changed?
- Has the `onChange` callback signature changed?
- Are there new peer dependencies (e.g., React 19 required)?
- Does the `useMediaQuery` hook from Excalidraw still work the same way?

### 2. Impact on Our Codebase

Audit each file that imports from `@excalidraw/excalidraw`:

#### Frontend Files to Check

| File | What to Check |
|------|---------------|
| [`Viewer.tsx`](../frontend/src/Viewer.tsx) | `excalidrawAPI` prop, `initialData`, `viewModeEnabled`, `zenModeEnabled`, `isCollaborating`, `UIOptions`, `LiveCollaborationTrigger`, `onChange`, `onPointerUpdate` |
| [`useCollab.ts`](../frontend/src/hooks/useCollab.ts) | `updateScene`, `getSceneElements`, `getAppState`, collaborator types |
| [`types/index.ts`](../frontend/src/types/index.ts) | `ExcalidrawElement` type import path |
| [`main.tsx`](../frontend/src/main.tsx) | `EXCALIDRAW_ASSET_PATH` — does 0.18.0 still use this? |
| [`vite.config.ts`](../frontend/vite.config.ts) | Font copy paths need updating (`dist/prod/fonts/` instead of `excalidraw-assets-dev/`) |
| [`index.html`](../frontend/index.html) | May need to add CSS import |

#### Specific API Questions

1. **`excalidrawAPI` prop**: Renamed to `onExcalidrawAPI` — how does the callback work now? Is it called on mount?
2. **`LiveCollaborationTrigger`**: Still exported? Same API?
3. **`updateScene({ elements, collaborators })`**: Same signature?
4. **`getSceneElements()` / `getAppState()`**: Still available on the API object?
5. **`onChange` callback**: Same `(elements, appState, files)` signature?
6. **`onPointerUpdate` callback**: Same signature?
7. **`viewModeEnabled` / `zenModeEnabled` / `isCollaborating`**: Still supported?
8. **`UIOptions.canvasActions`**: Same structure?
9. **Theme handling**: `theme` prop still works the same?

### 3. Font Self-Hosting in 0.18.0

Research the new font self-hosting mechanism:
- Where are font files in the 0.18.0 npm package? (`dist/prod/fonts/`?)
- Is `window.EXCALIDRAW_ASSET_PATH` still used?
- What font files are included? (Excalifont, Nunito, Comic Shanns, plus legacy Virgil, Cascadia, etc.?)
- Does 0.18.0 support backward compatibility with `fontFamily: 1-4` (old IDs)?

### 4. Obsidian Plugin Compatibility

Check if the Obsidian Excalidraw plugin (zsviczian) uses the `@zsviczian/excalidraw` fork or the official `@excalidraw/excalidraw`:
- What version does the Obsidian plugin use internally?
- Are there any custom font IDs beyond the standard ones?
- Will upgrading our frontend to 0.18.0 ensure full compatibility with drawings from the Obsidian plugin?

### 5. React Compatibility

- Does 0.18.0 require React 19? Our project uses React 18.3.1.
- Are there any other peer dependency changes?

## Deliverable

Create a detailed implementation plan with:
1. Exact list of files to modify and what changes are needed
2. New font self-hosting configuration for 0.18.0
3. Migration steps for each breaking change
4. Risk assessment (what could break)
5. Testing checklist
6. Whether a quick-fix font mapping (fontFamily 5→1) should be applied as an interim solution while the upgrade is in progress

## Quick Fix Option (Interim)

If the upgrade is complex, consider implementing a quick font mapping fix in [`Viewer.tsx`](../frontend/src/Viewer.tsx) as an interim solution:

```typescript
// Map new Excalidraw 0.18.x font IDs to 0.17.6 equivalents
const mapFontFamily = (elements: ExcalidrawElement[]) => 
  elements.map(el => {
    if ('fontFamily' in el) {
      const fontMap: Record<number, number> = {
        5: 1, // Excalifont → Virgil (hand-drawn)
        6: 2, // Nunito → Helvetica (normal)  
        7: 3, // Comic Shanns → Cascadia (code)
        8: 2, // Liberation Sans → Helvetica (normal)
      };
      return fontMap[el.fontFamily] 
        ? { ...el, fontFamily: fontMap[el.fontFamily] }
        : el;
    }
    return el;
  });
```

This would make drawings render with the closest matching 0.17.6 font while the full upgrade is planned.
