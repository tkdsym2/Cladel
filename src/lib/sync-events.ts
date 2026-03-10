/**
 * Cross-window sync events using Tauri's event system.
 *
 * Events are broadcast to ALL windows. Each helper includes the emitting
 * window's label so receivers can ignore their own events.
 */
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ─── Event names ───

export const NODE_UPDATED = "node-updated";
export const NODE_DELETED = "node-deleted";
export const COMMENTS_CHANGED = "comments-changed";
export const FILE_CHANGED = "file-changed";
export const GRAPH_CHANGED = "graph-changed";
export const SETTINGS_CHANGED = "settings-changed";
export const EXPORT_STARTED = "export-started";
export const EXPORT_FINISHED = "export-finished";

// ─── Payload types ───

export interface NodeUpdatedPayload {
  nodeId: string;
  source: string;
}

export interface NodeDeletedPayload {
  nodeId: string;
  source: string;
}

export interface CommentsChangedPayload {
  nodeId: string;
  source: string;
}

export interface FileChangedPayload {
  source: string;
}

export interface GraphChangedPayload {
  source: string;
}

export interface SettingsChangedPayload {
  source: string;
}

export interface ExportStartedPayload {
  source: string;
}

export interface ExportFinishedPayload {
  source: string;
  error: string | null;
}

// ─── Emit helpers ───

function getWindowLabel(): string {
  return getCurrentWindow().label;
}

export function emitNodeUpdated(nodeId: string): void {
  emit(NODE_UPDATED, { nodeId, source: getWindowLabel() });
}

export function emitNodeDeleted(nodeId: string): void {
  emit(NODE_DELETED, { nodeId, source: getWindowLabel() });
}

export function emitCommentsChanged(nodeId: string): void {
  emit(COMMENTS_CHANGED, { nodeId, source: getWindowLabel() });
}

export function emitFileChanged(): void {
  emit(FILE_CHANGED, { source: getWindowLabel() });
}

export function emitGraphChanged(): void {
  emit(GRAPH_CHANGED, { source: getWindowLabel() });
}

export function emitSettingsChanged(): void {
  emit(SETTINGS_CHANGED, { source: getWindowLabel() });
}

export function emitExportStarted(): void {
  emit(EXPORT_STARTED, { source: getWindowLabel() });
}

export function emitExportFinished(error?: string | null): void {
  emit(EXPORT_FINISHED, { source: getWindowLabel(), error: error ?? null });
}

// ─── Listen helpers (ignore self-emitted events) ───

export function onNodeUpdated(
  callback: (nodeId: string) => void,
): Promise<UnlistenFn> {
  const label = getWindowLabel();
  return listen<NodeUpdatedPayload>(NODE_UPDATED, (event) => {
    if (event.payload.source !== label) {
      callback(event.payload.nodeId);
    }
  });
}

export function onNodeDeleted(
  callback: (nodeId: string) => void,
): Promise<UnlistenFn> {
  const label = getWindowLabel();
  return listen<NodeDeletedPayload>(NODE_DELETED, (event) => {
    if (event.payload.source !== label) {
      callback(event.payload.nodeId);
    }
  });
}

export function onCommentsChanged(
  callback: (nodeId: string) => void,
): Promise<UnlistenFn> {
  const label = getWindowLabel();
  return listen<CommentsChangedPayload>(COMMENTS_CHANGED, (event) => {
    if (event.payload.source !== label) {
      callback(event.payload.nodeId);
    }
  });
}

export function onFileChanged(
  callback: () => void,
): Promise<UnlistenFn> {
  const label = getWindowLabel();
  return listen<FileChangedPayload>(FILE_CHANGED, (event) => {
    if (event.payload.source !== label) {
      callback();
    }
  });
}

export function onGraphChanged(
  callback: () => void,
): Promise<UnlistenFn> {
  const label = getWindowLabel();
  return listen<GraphChangedPayload>(GRAPH_CHANGED, (event) => {
    if (event.payload.source !== label) {
      callback();
    }
  });
}

export function onSettingsChanged(
  callback: () => void,
): Promise<UnlistenFn> {
  const label = getWindowLabel();
  return listen<SettingsChangedPayload>(SETTINGS_CHANGED, (event) => {
    if (event.payload.source !== label) {
      callback();
    }
  });
}

/** Listen for export-started from ANY window (including self). */
export function onExportStarted(
  callback: (fromSelf: boolean) => void,
): Promise<UnlistenFn> {
  const label = getWindowLabel();
  return listen<ExportStartedPayload>(EXPORT_STARTED, (event) => {
    callback(event.payload.source === label);
  });
}

/** Listen for export-finished from ANY window (including self). */
export function onExportFinished(
  callback: (fromSelf: boolean, error: string | null) => void,
): Promise<UnlistenFn> {
  const label = getWindowLabel();
  return listen<ExportFinishedPayload>(EXPORT_FINISHED, (event) => {
    callback(event.payload.source === label, event.payload.error);
  });
}
