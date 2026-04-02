import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types'

export interface ExcalidrawData {
  type: string
  version: number
  elements: ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

export interface PublicDrawing {
  id: string
  created_at: string
  source_path: string | null
  password_protected: boolean
}

// ──────────────────────────────────────────────
// Collaboration types
// ──────────────────────────────────────────────

export interface CollaboratorInfo {
  id: string
  name: string
  colorIndex: number
}

export interface CollabStatusResponse {
  active: boolean
  session_id?: string
  participant_count?: number
  password_required?: boolean
}

export interface CollabSessionInfo {
  session_id: string
  drawing_id: string
  created_at: string
  participant_count: number
  participants: CollaboratorInfo[]
}

// Client -> Server WebSocket messages
export type ClientMessage =
  | { type: 'scene_update'; elements: ExcalidrawElement[] }
  | { type: 'scene_delta'; elements: ExcalidrawElement[]; seq: number }
  | { type: 'pointer_update'; x: number; y: number; button: 'down' | 'up'; tool?: 'pointer' | 'laser'; scrollX?: number; scrollY?: number; zoom?: number }
  | { type: 'set_name'; name: string }

// Server -> Client WebSocket messages
export type ServerMessage =
  | {
      type: 'snapshot'
      elements: ExcalidrawElement[]
      appState: Partial<AppState>
      files: BinaryFiles
      collaborators: CollaboratorInfo[]
    }
  | { type: 'scene_update'; elements: ExcalidrawElement[]; from: string }
  | { type: 'scene_delta'; elements: ExcalidrawElement[]; from: string; seq: number }
  | { type: 'full_sync'; elements: ExcalidrawElement[]; appState: Partial<AppState>; files: BinaryFiles; seq: number }
  | {
      type: 'pointer_update'
      x: number
      y: number
      button: string
      tool?: 'pointer' | 'laser'
      userId: string
      name: string
      colorIndex: number
      scrollX?: number
      scrollY?: number
      zoom?: number
    }
  | {
      type: 'user_joined'
      userId: string
      name: string
      collaborators: CollaboratorInfo[]
    }
  | {
      type: 'user_left'
      userId: string
      name: string
      collaborators: CollaboratorInfo[]
    }
  | { type: 'session_ended'; saved: boolean }
  | { type: 'error'; message: string }
