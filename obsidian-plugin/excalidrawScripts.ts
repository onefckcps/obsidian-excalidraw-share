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
  enableRightClickEraser: boolean;
}

// ──────────────────────────────────────────────
// Script 1: Zoom-Adaptive Stroke Width + No Smoothing
// ──────────────────────────────────────────────

/**
 * Polls the Excalidraw zoom level and adjusts stroke width inversely.
 * Also disables streamline and smoothing for more precise pen input.
 */
export class ZoomAdaptiveStroke {
  private api: ExcalidrawAPI;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastZoom: number | null = null;
  private smoothingApplied = false;
  private baseStrokeWidth: number;
  private pollIntervalMs: number;

  constructor(api: ExcalidrawAPI, baseStrokeWidth: number, pollIntervalMs: number) {
    this.api = api;
    this.baseStrokeWidth = baseStrokeWidth;
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    // Clean up any existing interval (idempotent)
    this.stop();
    this.lastZoom = null;
    this.smoothingApplied = false;

    this.intervalId = setInterval(() => {
      try {
        const appState = this.api.getAppState();
        if (!appState || !appState.zoom) return;

        // Disable streamline and smoothing (once)
        if (!this.smoothingApplied) {
          this.api.updateScene({
            appState: {
              currentItemStreamline: 0,
              currentItemSmoothing: 0,
            },
          });
          this.smoothingApplied = true;
        }

        // Zoom-adaptive stroke width
        const zoom = appState.zoom as { value: number };
        const currentZoom = zoom.value;
        if (currentZoom !== this.lastZoom) {
          this.lastZoom = currentZoom;
          const adaptedWidth = this.baseStrokeWidth / currentZoom;
          this.api.updateScene({
            appState: { currentItemStrokeWidth: adaptedWidth },
          });
        }
      } catch {
        // Ignore errors — next poll will retry
      }
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Update settings without full restart */
  updateSettings(baseStrokeWidth: number, pollIntervalMs: number): void {
    const needsRestart = pollIntervalMs !== this.pollIntervalMs;
    this.baseStrokeWidth = baseStrokeWidth;
    this.pollIntervalMs = pollIntervalMs;
    // Force recalculation on next tick
    this.lastZoom = null;
    if (needsRestart && this.intervalId) {
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
 */
export class RightClickEraser {
  private api: ExcalidrawAPI;
  private container: HTMLElement;
  private isEraserMode = false;
  private originalTool: string | null = null;
  private syntheticFlag = false;

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
    this.container.addEventListener('pointerdown', this.onPointerDown, true);
    this.container.addEventListener('pointermove', this.onPointerMove, true);
    this.container.addEventListener('pointerup', this.onPointerUp, true);
    this.container.addEventListener('pointercancel', this.onPointerCancel, true);
    this.container.addEventListener('contextmenu', this.onContextMenu, true);
    this.attached = true;
  }

  stop(): void {
    if (!this.attached) return;
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

  private isFreeDraw(): boolean {
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
      const appState = this.api.getAppState();
      const activeTool = appState.activeTool as { type?: string } | undefined;
      this.originalTool = activeTool?.type || 'freedraw';
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
    };

    if (settings.enableZoomAdaptive) {
      scripts.zoomAdaptive = new ZoomAdaptiveStroke(api, settings.baseStrokeWidth, settings.pollIntervalMs);
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

  /** Update settings for all running instances */
  updateSettings(settings: ScriptSettings): void {
    for (const [leafId, scripts] of this.instances) {
      // Zoom adaptive: update or start/stop based on toggle
      if (settings.enableZoomAdaptive && scripts.zoomAdaptive) {
        scripts.zoomAdaptive.updateSettings(settings.baseStrokeWidth, settings.pollIntervalMs);
      } else if (!settings.enableZoomAdaptive && scripts.zoomAdaptive) {
        scripts.zoomAdaptive.stop();
        scripts.zoomAdaptive = null;
      }
      // Note: enabling a previously disabled script requires re-activation via activateForLeaf

      // Right-click eraser: stop if disabled
      if (!settings.enableRightClickEraser && scripts.rightClickEraser) {
        scripts.rightClickEraser.stop();
        scripts.rightClickEraser = null;
      }

      // Clean up empty entries
      if (!scripts.zoomAdaptive && !scripts.rightClickEraser) {
        this.instances.delete(leafId);
      }
    }
  }

  /** Check if any scripts are active for a leaf */
  hasActiveScripts(leafId: string): boolean {
    return this.instances.has(leafId);
  }
}
