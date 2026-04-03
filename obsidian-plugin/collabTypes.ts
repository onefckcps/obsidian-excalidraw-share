// ──────────────────────────────────────────────
// Collaboration types for the Obsidian plugin
// Mirrors the WebSocket protocol used by the backend and frontend
// ──────────────────────────────────────────────

export interface CollaboratorInfo {
  id: string;
  name: string;
  colorIndex: number;
}

export interface CollabStatusResponse {
  active: boolean;
  session_id?: string;
  participant_count?: number;
}

// ──────────────────────────────────────────────
// Client → Server WebSocket messages
// ──────────────────────────────────────────────

export type ClientMessage =
  | { type: 'scene_update'; elements: unknown[] }
  | { type: 'scene_delta'; elements: unknown[]; seq: number }
  | { type: 'pointer_update'; x: number; y: number; button: 'down' | 'up'; tool?: 'pointer' | 'laser'; scrollX?: number; scrollY?: number; zoom?: number }
  | { type: 'set_name'; name: string }
  | { type: 'files_update'; files: Record<string, unknown> };

// ──────────────────────────────────────────────
// Server → Client WebSocket messages
// ──────────────────────────────────────────────

export type ServerMessage =
  | {
      type: 'snapshot';
      elements: unknown[];
      appState: Record<string, unknown>;
      files: Record<string, unknown>;
      collaborators: CollaboratorInfo[];
    }
  | { type: 'scene_update'; elements: unknown[]; from: string }
  | { type: 'scene_delta'; elements: unknown[]; from: string; seq: number }
  | { type: 'full_sync'; elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown>; seq: number }
  | {
      type: 'pointer_update';
      x: number;
      y: number;
      button: string;
      tool?: 'pointer' | 'laser';
      userId: string;
      name: string;
      colorIndex: number;
      scrollX?: number;
      scrollY?: number;
      zoom?: number;
    }
  | {
      type: 'user_joined';
      userId: string;
      name: string;
      collaborators: CollaboratorInfo[];
    }
  | {
      type: 'user_left';
      userId: string;
      name: string;
      collaborators: CollaboratorInfo[];
    }
  | { type: 'files_update'; files: Record<string, unknown>; from: string }
  | { type: 'session_ended'; saved: boolean }
  | { type: 'error'; message: string };

// ──────────────────────────────────────────────
// Excalidraw API types (subset used by collab)
// ──────────────────────────────────────────────

export interface ExcalidrawElement {
  id: string;
  version: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

export interface ExcalidrawCollaborator {
  username?: string;
  pointer?: { x: number; y: number; tool?: 'pointer' | 'laser' };
  button?: 'up' | 'down';
  color?: { background: string; stroke: string };
  id?: string;
  userState?: string;
  selectedElementIds?: string[];
}

export interface ExcalidrawAPI {
  updateScene: (data: {
    elements?: unknown[];
    appState?: Record<string, unknown>;
    collaborators?: Map<string, ExcalidrawCollaborator>;
    commitToHistory?: boolean;
  }) => void;
  getSceneElements: () => ExcalidrawElement[];
  getSceneElementsIncludingDeleted?: () => ExcalidrawElement[];
  getFiles: () => Record<string, unknown>;
  getAppState: () => Record<string, unknown>;
  /** Set the active drawing tool. Available on Excalidraw 0.17+ */
  setActiveTool?: (tool: { type: string; [key: string]: unknown }) => void;
  /** Add binary files (images) to the Excalidraw file cache. Available on Excalidraw 0.17+ */
  addFiles?: (files: { id: string; mimeType: string; dataURL: string; created: number; lastRetrieved?: number }[]) => void;

  // ── Event subscription methods (Excalidraw imperative API) ──
  // These return an unsubscribe function. Available on newer Excalidraw versions.
  onChange?: (
    callback: (
      elements: readonly ExcalidrawElement[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => void,
  ) => () => void;
  onPointerDown?: (
    callback: (
      activeTool: unknown,
      pointerDownState: unknown,
      event: PointerEvent,
    ) => void,
  ) => () => void;
  onPointerUp?: (
    callback: (
      activeTool: unknown,
      pointerDownState: unknown,
      event: PointerEvent,
    ) => void,
  ) => () => void;
}

// ──────────────────────────────────────────────
// Color palette for collaborators (same as frontend)
// ──────────────────────────────────────────────

export const COLLAB_COLORS: { background: string; stroke: string }[] = [
  { background: '#FF6B6B33', stroke: '#FF6B6B' },  // Red
  { background: '#4ECDC433', stroke: '#4ECDC4' },  // Teal
  { background: '#45B7D133', stroke: '#45B7D1' },  // Blue
  { background: '#96CEB433', stroke: '#96CEB4' },  // Green
  { background: '#DDA0DD33', stroke: '#DDA0DD' },  // Plum
  { background: '#F7DC6F33', stroke: '#F7DC6F' },  // Gold
  { background: '#E8915633', stroke: '#E89156' },  // Orange
  { background: '#98D8C833', stroke: '#98D8C8' },  // Mint
];

export function getCollaboratorColor(colorIndex: number): { background: string; stroke: string } {
  return COLLAB_COLORS[colorIndex % COLLAB_COLORS.length];
}
