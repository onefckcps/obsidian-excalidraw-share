// ──────────────────────────────────────────────
// Embedded Excalidraw Scripts
// Automatically activated on every Excalidraw view
// ──────────────────────────────────────────────

import type { ExcalidrawAPI } from './collabTypes';

// ── Script Settings ──

export interface ScriptSettings {
  enableZoomAdaptive: boolean;
  baseStrokeWidth: number;
  pollIntervalMs: number;
  disableSmoothing: boolean;
  enableRightClickEraser: boolean;
}

// ──────────────────────────────────────────────
// Script 1: Zoom-Adaptive Stroke Width
// ──────────────────────────────────────────────

/**
 * Adjusts stroke width inversely with zoom level.
 *
 * **Primary strategy**: Event-driven via `api.onChange()` — zero-waste, fires
 * only when Excalidraw's scene actually changes (which includes zoom changes).
 *
 * **Fallback**: `setInterval` polling for older Excalidraw versions that lack
 * the `onChange` imperative API.
 *
 * Optionally disables streamline and smoothing for more precise pen input
 * (controlled by the separate `disableSmoothing` setting).
 */
export class ZoomAdaptiveStroke {
  private api: ExcalidrawAPI;
  private lastZoom: number | null = null;
  private smoothingApplied = false;
  private baseStrokeWidth: number;
  private pollIntervalMs: number;
  private disableSmoothing: boolean;

  // Event-driven strategy
  private onChangeUnsubscribe: (() => void) | null = null;

  // Polling fallback strategy
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private strategy: 'none' | 'event-driven' | 'polling' = 'none';

  constructor(api: ExcalidrawAPI, baseStrokeWidth: number, pollIntervalMs: number, disableSmoothing: boolean) {
    this.api = api;
    this.baseStrokeWidth = baseStrokeWidth;
    this.pollIntervalMs = pollIntervalMs;
    this.disableSmoothing = disableSmoothing;
  }

  start(): void {
    // Clean up any existing subscription/interval (idempotent)
    this.stop();
    this.lastZoom = null;
    this.smoothingApplied = false;

    // Try event-driven detection first (preferred — zero-waste)
    if (typeof this.api.onChange === 'function') {
      this.startEventDriven();
    } else {
      // Fallback to polling for older Excalidraw versions
      this.startPolling();
    }
  }

  private startEventDriven(): void {
    this.strategy = 'event-driven';

    this.onChangeUnsubscribe = this.api.onChange!(
      (_elements: unknown, appState: Record<string, unknown>, _files: unknown) => {
        this.handleAppStateChange(appState);
      }
    );

    // Also apply immediately for the current state (onChange won't fire until next change)
    try {
      const appState = this.api.getAppState();
      if (appState) this.handleAppStateChange(appState);
    } catch {
      // Will be handled on next onChange callback
    }
  }

  private startPolling(): void {
    this.strategy = 'polling';

    this.intervalId = setInterval(() => {
      try {
        const appState = this.api.getAppState();
        if (appState) this.handleAppStateChange(appState);
      } catch {
        // Ignore errors — next poll will retry
      }
    }, this.pollIntervalMs);
  }

  /**
   * Core logic: check zoom and apply stroke width + optional smoothing.
   * Called from both event-driven and polling strategies.
   * Batches smoothing + stroke width into a single updateScene call when possible.
   */
  private handleAppStateChange(appState: Record<string, unknown>): void {
    if (!appState.zoom) return;

    const zoom = appState.zoom as { value: number };
    const currentZoom = zoom.value;
    const zoomChanged = currentZoom !== this.lastZoom;
    const needsSmoothing = this.disableSmoothing && !this.smoothingApplied;

    // Nothing to do
    if (!zoomChanged && !needsSmoothing) return;

    // Build a single batched appState update
    const update: Record<string, unknown> = {};

    if (zoomChanged) {
      this.lastZoom = currentZoom;
      update.currentItemStrokeWidth = this.baseStrokeWidth / currentZoom;
    }

    if (needsSmoothing) {
      update.currentItemStreamline = 0;
      update.currentItemSmoothing = 0;
      this.smoothingApplied = true;
    }

    try {
      this.api.updateScene({ appState: update });
    } catch {
      // Ignore — will retry on next change/tick
    }
  }

  stop(): void {
    if (this.onChangeUnsubscribe) {
      this.onChangeUnsubscribe();
      this.onChangeUnsubscribe = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.strategy = 'none';
  }

  /** Update settings without full restart (unless poll interval changed in polling mode) */
  updateSettings(baseStrokeWidth: number, pollIntervalMs: number, disableSmoothing: boolean): void {
    const needsRestart = this.strategy === 'polling' && pollIntervalMs !== this.pollIntervalMs;
    this.baseStrokeWidth = baseStrokeWidth;
    this.pollIntervalMs = pollIntervalMs;
    this.disableSmoothing = disableSmoothing;
    // Force recalculation on next change/tick
    this.lastZoom = null;
    // Reset smoothing flag if the setting changed
    if (!disableSmoothing) {
      this.smoothingApplied = false; // Will be re-applied if re-enabled
    }
    if (needsRestart) {
      this.start();
    }
  }
}

// ──────────────────────────────────────────────
// Script 2: Toggle Eraser on Right Click in Freedraw
// ──────────────────────────────────────────────

/**
 * Enables temporary eraser mode while using the freedraw (pen) tool.
 * Hold right mouse button (or S Pen side button) → eraser.
 * Release → back to freedraw.
 *
 * **Optimization**: Caches the active tool type via `api.onChange()` subscription
 * to avoid calling `getAppState()` on every pointer event. Falls back to direct
 * `getAppState()` calls if `onChange` is unavailable.
 */
export class RightClickEraser {
  private api: ExcalidrawAPI;
  private container: HTMLElement;
  private isEraserMode = false;
  private originalTool: string | null = null;
  private syntheticFlag = false;

  // Cached active tool type (updated via onChange or direct getAppState)
  private cachedToolType: string | null = null;
  private onChangeUnsubscribe: (() => void) | null = null;

  // Bound handler references for cleanup
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;
  private onPointerCancel: (e: PointerEvent) => void;
  private onContextMenu: (e: Event) => void;
  private attached = false;

  constructor(api: ExcalidrawAPI, container: HTMLElement) {
    this.api = api;
    this.container = container;

    // Bind handlers
    this.onPointerDown = this._onPointerDown.bind(this);
    this.onPointerMove = this._onPointerMove.bind(this);
    this.onPointerUp = this._onPointerUp.bind(this);
    this.onPointerCancel = this._onPointerCancel.bind(this);
    this.onContextMenu = this._onContextMenu.bind(this);
  }

  start(): void {
    if (this.attached) return;

    // Subscribe to tool changes via onChange (if available) for cached tool type
    if (typeof this.api.onChange === 'function') {
      this.onChangeUnsubscribe = this.api.onChange(
        (_elements: unknown, appState: Record<string, unknown>, _files: unknown) => {
          const activeTool = appState.activeTool as { type?: string } | undefined;
          this.cachedToolType = activeTool?.type || null;
        }
      );
    }

    // Initialize cached tool type
    try {
      const appState = this.api.getAppState();
      const activeTool = appState.activeTool as { type?: string } | undefined;
      this.cachedToolType = activeTool?.type || null;
    } catch {
      // Will be populated on first onChange or isFreeDraw() call
    }

    this.container.addEventListener('pointerdown', this.onPointerDown, true);
    this.container.addEventListener('pointermove', this.onPointerMove, true);
    this.container.addEventListener('pointerup', this.onPointerUp, true);
    this.container.addEventListener('pointercancel', this.onPointerCancel, true);
    this.container.addEventListener('contextmenu', this.onContextMenu, true);
    this.attached = true;
  }

  stop(): void {
    if (!this.attached) return;

    // Unsubscribe from onChange
    if (this.onChangeUnsubscribe) {
      this.onChangeUnsubscribe();
      this.onChangeUnsubscribe = null;
    }

    this.container.removeEventListener('pointerdown', this.onPointerDown, true);
    this.container.removeEventListener('pointermove', this.onPointerMove, true);
    this.container.removeEventListener('pointerup', this.onPointerUp, true);
    this.container.removeEventListener('pointercancel', this.onPointerCancel, true);
    this.container.removeEventListener('contextmenu', this.onContextMenu, true);
    this.attached = false;

    // Restore tool if we were in eraser mode
    if (this.isEraserMode) {
      this.restoreTool();
    }
  }

  // ── Private helpers ──

  private isEraseButton(e: PointerEvent): boolean {
    return e.button === 2 || (e.buttons & 2) === 2;
  }

  /**
   * Check if the current tool is freedraw.
   * Uses cached tool type from onChange subscription when available,
   * falls back to direct getAppState() call otherwise.
   */
  private isFreeDraw(): boolean {
    // Use cached value if onChange subscription is active
    if (this.onChangeUnsubscribe) {
      return this.cachedToolType === 'freedraw';
    }
    // Fallback: direct API call (for older Excalidraw versions)
    try {
      const appState = this.api.getAppState();
      const activeTool = appState.activeTool as { type?: string } | undefined;
      return activeTool?.type === 'freedraw';
    } catch {
      return false;
    }
  }

  private switchToEraser(): void {
    if (this.isEraserMode) return;
    if (!this.isFreeDraw()) return;
    if (!this.api.setActiveTool) return;

    try {
      this.originalTool = this.cachedToolType || 'freedraw';
      this.isEraserMode = true;
      this.api.setActiveTool({ type: 'eraser' });
    } catch {
      // Ignore
    }
  }

  private restoreTool(): void {
    if (!this.isEraserMode) return;
    if (!this.api.setActiveTool) return;

    try {
      this.isEraserMode = false;
      this.api.setActiveTool({ type: this.originalTool || 'freedraw' });
      this.originalTool = null;
    } catch {
      // Ignore
    }
  }

  private dispatchSyntheticDown(original: PointerEvent): void {
    this.syntheticFlag = true;
    const synth = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: original.pointerId,
      pointerType: original.pointerType,
      clientX: original.clientX,
      clientY: original.clientY,
      screenX: original.screenX,
      screenY: original.screenY,
      width: original.width,
      height: original.height,
      pressure: original.pressure || 0.5,
      tiltX: original.tiltX,
      tiltY: original.tiltY,
      isPrimary: original.isPrimary,
      button: 0,
      buttons: 1,
    });
    original.target?.dispatchEvent(synth);
    this.syntheticFlag = false;
  }

  // ── Event handlers ──

  private _onPointerDown(e: PointerEvent): void {
    if (this.syntheticFlag) return;

    if (this.isEraseButton(e) && (this.isFreeDraw() || this.isEraserMode)) {
      e.preventDefault();
      e.stopPropagation();
      this.switchToEraser();
      this.dispatchSyntheticDown(e);
    }
  }

  private _onPointerMove(e: PointerEvent): void {
    if (this.isEraseButton(e) && !this.isEraserMode && this.isFreeDraw()) {
      this.switchToEraser();
    }
  }

  private _onPointerUp(_e: PointerEvent): void {
    if (this.isEraserMode) {
      this.restoreTool();
    }
  }

  private _onPointerCancel(_e: PointerEvent): void {
    if (this.isEraserMode) {
      this.restoreTool();
    }
  }

  private _onContextMenu(e: Event): void {
    if (this.isFreeDraw() || this.isEraserMode) {
      e.preventDefault();
      e.stopPropagation();
      if (!this.isEraserMode) this.switchToEraser();
    }
  }
}

// ──────────────────────────────────────────────
// Script Manager — manages per-leaf script instances
// ──────────────────────────────────────────────

interface LeafScripts {
  zoomAdaptive: ZoomAdaptiveStroke | null;
  rightClickEraser: RightClickEraser | null;
  /** Stored references for re-enabling scripts without requiring leaf re-activation */
  api: ExcalidrawAPI;
  container: HTMLElement;
}

export class ExcalidrawScriptManager {
  private instances: Map<string, LeafScripts> = new Map();

  /**
   * Activate scripts for a specific leaf.
   * If scripts are already active for this leaf, they are stopped first.
   */
  activateForLeaf(
    leafId: string,
    api: ExcalidrawAPI,
    container: HTMLElement,
    settings: ScriptSettings,
  ): void {
    // Stop existing scripts for this leaf
    this.deactivateForLeaf(leafId);

    const scripts: LeafScripts = {
      zoomAdaptive: null,
      rightClickEraser: null,
      api,
      container,
    };

    if (settings.enableZoomAdaptive) {
      scripts.zoomAdaptive = new ZoomAdaptiveStroke(api, settings.baseStrokeWidth, settings.pollIntervalMs, settings.disableSmoothing);
      scripts.zoomAdaptive.start();
    }

    if (settings.enableRightClickEraser) {
      scripts.rightClickEraser = new RightClickEraser(api, container);
      scripts.rightClickEraser.start();
    }

    this.instances.set(leafId, scripts);
  }

  /** Stop and remove scripts for a specific leaf */
  deactivateForLeaf(leafId: string): void {
    const scripts = this.instances.get(leafId);
    if (!scripts) return;

    scripts.zoomAdaptive?.stop();
    scripts.rightClickEraser?.stop();
    this.instances.delete(leafId);
  }

  /** Stop all scripts across all leaves */
  deactivateAll(): void {
    for (const [leafId] of this.instances) {
      this.deactivateForLeaf(leafId);
    }
  }

  /**
   * Update settings for all running instances.
   * Can now re-enable previously disabled scripts using stored api/container refs.
   */
  updateSettings(settings: ScriptSettings): void {
    for (const [, scripts] of this.instances) {
      // ── Zoom Adaptive ──
      if (settings.enableZoomAdaptive) {
        if (scripts.zoomAdaptive) {
          // Already running — update settings in-place
          scripts.zoomAdaptive.updateSettings(settings.baseStrokeWidth, settings.pollIntervalMs, settings.disableSmoothing);
        } else {
          // Re-enable: create new instance using stored refs
          scripts.zoomAdaptive = new ZoomAdaptiveStroke(scripts.api, settings.baseStrokeWidth, settings.pollIntervalMs, settings.disableSmoothing);
          scripts.zoomAdaptive.start();
        }
      } else if (scripts.zoomAdaptive) {
        // Disable
        scripts.zoomAdaptive.stop();
        scripts.zoomAdaptive = null;
      }

      // ── Right-Click Eraser ──
      if (settings.enableRightClickEraser) {
        if (!scripts.rightClickEraser) {
          // Re-enable: create new instance using stored refs
          scripts.rightClickEraser = new RightClickEraser(scripts.api, scripts.container);
          scripts.rightClickEraser.start();
        }
        // Already running — no settings to update
      } else if (scripts.rightClickEraser) {
        // Disable
        scripts.rightClickEraser.stop();
        scripts.rightClickEraser = null;
      }
    }
  }

  /** Check if any scripts are active for a leaf */
  hasActiveScripts(leafId: string): boolean {
    return this.instances.has(leafId);
  }
}
