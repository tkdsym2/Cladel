import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectData,
  LayerData,
  NodeData,
  EdgeData,
  CoreVersionData,
  CoreVersionDiff,
  NoteVersionData,
  NodeComment,
  NodeCommentCount,
  EdgeComment,
  EdgeCommentCount,
  SplitEdgeResult,
  DissolveJunctionResult,
  BibtexEntry,
  PaperResult,
  PaperDetail,
  AgentContext,
  AgentResponse,
  AgentCapabilities,
  UIPreferences,
  PdfMetadata,
  LayerPaperGroup,
  ImageFileInfo,
  UsageSummary,
  UsageLogEntry,
  AgentNodeMessage,
  InvokeAgentNodeResult,
  PaperSummarizeResult,
  ExportPreview,
  ExportStyleConfig,
  CreateNodeInput,
  UpdateNodeInput,
  CreateEdgeInput,
  UpdateEdgeInput,
  RecentFile,
  RemoteFileInfo,
  RemoteFileStats,
  SyncStatusResult,
  UserIdentity,
} from "../types";

// ─── Tab Info ───

export interface TabInfo {
  id: string;
  file_path: string | null;
  snapshot_path: string | null;
  display_name: string;
  is_dirty: boolean;
}

// ─── Tab Commands ───

export function getTabs(): Promise<TabInfo[]> {
  return invoke("get_tabs");
}

export function getActiveTabId(): Promise<string> {
  return invoke("get_active_tab_id");
}

export function createTab(): Promise<TabInfo> {
  return invoke("create_tab");
}

export function openFileInTab(path: string): Promise<TabInfo> {
  return invoke("open_file_in_tab", { path });
}

export function switchTab(tabId: string): Promise<void> {
  return invoke("switch_tab", { tabId });
}

export function closeTab(tabId: string): Promise<string> {
  return invoke("close_tab", { tabId });
}

export function reloadActiveTabFromDisk(): Promise<void> {
  return invoke("reload_active_tab_from_disk");
}

export function updateTabAfterSave(
  filePath: string,
  displayName: string,
  isDirty: boolean,
): Promise<void> {
  return invoke("update_tab_after_save", { filePath, displayName, isDirty });
}

// ─── File Operations ───

export function fileNew(): Promise<void> {
  return invoke("file_new");
}

export function fileOpen(path: string): Promise<void> {
  return invoke("file_open", { path });
}

export function fileSave(): Promise<void> {
  return invoke("file_save");
}

export function fileSaveAs(path: string): Promise<void> {
  return invoke("file_save_as", { path });
}

export function fileGetCurrentPath(): Promise<string | null> {
  return invoke("file_get_current_path");
}

export function ensureSampleFile(): Promise<string> {
  return invoke("ensure_sample_file");
}

export function restoreSampleFile(): Promise<string> {
  return invoke("restore_sample_file");
}

// ─── Projects ───

export function getProjects(): Promise<ProjectData[]> {
  return invoke("get_projects");
}

export function createProject(name: string): Promise<ProjectData> {
  return invoke("create_project", { name });
}

// ─── Layers ───

export function getLayers(projectId: string): Promise<LayerData[]> {
  return invoke("get_layers", { projectId });
}

export function createLayer(
  projectId: string,
  coreContent?: string | null,
  sourceNodeId?: string | null,
): Promise<LayerData> {
  return invoke("create_layer", {
    projectId,
    coreContent: coreContent ?? null,
    sourceNodeId: sourceNodeId ?? null,
  });
}

export function deleteLayer(layerId: string): Promise<void> {
  return invoke("delete_layer", { layerId });
}

// ─── Nodes ───

export function getNodesByLayer(layerId: string): Promise<NodeData[]> {
  return invoke("get_nodes_by_layer", { layerId });
}

export function createNode(input: CreateNodeInput): Promise<NodeData> {
  return invoke("create_node", { input });
}

export function updateNode(input: UpdateNodeInput): Promise<NodeData> {
  return invoke("update_node", { input });
}

export function deleteNode(nodeId: string): Promise<void> {
  return invoke("delete_node", { nodeId });
}

export function softDeleteNode(nodeId: string): Promise<NodeData> {
  return invoke("soft_delete_node", { nodeId });
}

export function updateDisplayId(
  nodeId: string,
  newDisplayId: string,
): Promise<void> {
  return invoke("update_display_id", { nodeId, newDisplayId });
}

export function updatePaperBibtex(
  nodeId: string,
  newBibtex: string,
): Promise<NodeData> {
  return invoke("update_paper_bibtex", { nodeId, newBibtex });
}

// ─── Edges ───

export function getEdgesByLayer(layerId: string): Promise<EdgeData[]> {
  return invoke("get_edges_by_layer", { layerId });
}

export function createEdge(input: CreateEdgeInput): Promise<EdgeData> {
  return invoke("create_edge", { input });
}

export function updateEdge(input: UpdateEdgeInput): Promise<EdgeData> {
  return invoke("update_edge", { input });
}

export function deleteEdge(edgeId: string): Promise<void> {
  return invoke("delete_edge", { edgeId });
}

export interface RestoreNodeInput {
  id: string;
  layer_id: string;
  node_type: string;
  title: string;
  content?: string | null;
  bibtex?: string | null;
  metadata?: string | null;
  pdf_path?: string | null;
  display_id?: string | null;
  position_x: number;
  position_y: number;
  width?: number | null;
  height?: number | null;
  status: string;
  created_by: string;
  creator_user_id?: string | null;
  creator_user_name?: string | null;
}

export function restoreNode(input: RestoreNodeInput): Promise<NodeData> {
  return invoke("restore_node", { input });
}

export interface RestoreEdgeInput {
  id: string;
  layer_id: string;
  source_node_id: string;
  target_node_id: string;
  weight: number;
  comment: string;
  source_handle?: string | null;
  target_handle?: string | null;
  created_by: string;
}

export function restoreEdge(input: RestoreEdgeInput): Promise<EdgeData> {
  return invoke("restore_edge", { input });
}

// ─── Core Versions ───

export function saveCoreVersion(
  nodeId: string,
  content: string,
): Promise<CoreVersionData> {
  return invoke("save_core_version", { nodeId, content });
}

export function getCoreVersions(nodeId: string): Promise<CoreVersionData[]> {
  return invoke("get_core_versions", { nodeId });
}

export function getCoreVersionDiff(
  nodeId: string,
  versionA: number,
  versionB: number,
): Promise<CoreVersionDiff> {
  return invoke("get_core_version_diff", { nodeId, versionA, versionB });
}

// ─── Note Versions ───

export function saveNoteVersion(
  nodeId: string,
  content: string,
): Promise<NoteVersionData> {
  return invoke("save_note_version", { nodeId, content });
}

export function getNoteVersions(nodeId: string): Promise<NoteVersionData[]> {
  return invoke("get_note_versions", { nodeId });
}

// ─── Node Comments ───

export function addNodeComment(
  nodeId: string,
  content: string,
  authorType: string,
  creatorUserId?: string | null,
  creatorUserName?: string | null,
): Promise<NodeComment> {
  return invoke("add_node_comment", {
    nodeId,
    content,
    authorType,
    creatorUserId: creatorUserId ?? null,
    creatorUserName: creatorUserName ?? null,
  });
}

export function getNodeComments(nodeId: string): Promise<NodeComment[]> {
  return invoke("get_node_comments", { nodeId });
}

export function updateNodeComment(
  commentId: string,
  content: string,
): Promise<NodeComment> {
  return invoke("update_node_comment", { commentId, content });
}

export function deleteNodeComment(commentId: string): Promise<void> {
  return invoke("delete_node_comment", { commentId });
}

export function getNodeCommentCounts(
  nodeIds: string[],
): Promise<NodeCommentCount[]> {
  return invoke("get_node_comment_counts", { nodeIds });
}

// ─── Edge Comments ───

export function addEdgeComment(
  edgeId: string,
  content: string,
  authorType: string,
  creatorUserId?: string | null,
  creatorUserName?: string | null,
): Promise<EdgeComment> {
  return invoke("add_edge_comment", {
    edgeId,
    content,
    authorType,
    creatorUserId: creatorUserId ?? null,
    creatorUserName: creatorUserName ?? null,
  });
}

export function getEdgeComments(edgeId: string): Promise<EdgeComment[]> {
  return invoke("get_edge_comments", { edgeId });
}

export function updateEdgeComment(
  commentId: string,
  content: string,
): Promise<EdgeComment> {
  return invoke("update_edge_comment", { commentId, content });
}

export function deleteEdgeComment(commentId: string): Promise<void> {
  return invoke("delete_edge_comment", { commentId });
}

export function getEdgeCommentCounts(
  edgeIds: string[],
): Promise<EdgeCommentCount[]> {
  return invoke("get_edge_comment_counts", { edgeIds });
}

// ─── Junctions ───

export function splitEdgeAtJunction(
  edgeId: string,
  positionX: number,
  positionY: number,
): Promise<SplitEdgeResult> {
  return invoke("split_edge_at_junction", { edgeId, positionX, positionY });
}

export function dissolveJunction(nodeId: string): Promise<DissolveJunctionResult> {
  return invoke("dissolve_junction", { nodeId });
}

// ─── BibTeX ───

export function parseBibtex(bibtexString: string): Promise<BibtexEntry[]> {
  return invoke("parse_bibtex", { bibtexString });
}

// ─── Literature Search (Semantic Scholar) ───

export function searchPapers(
  query: string,
  limit?: number | null,
): Promise<PaperResult[]> {
  return invoke("search_papers", { query, limit: limit ?? null });
}

export function getPaperDetails(paperId: string): Promise<PaperDetail> {
  return invoke("get_paper_details", { paperId });
}

// ─── Settings ───

export function saveApiKey(key: string): Promise<void> {
  return invoke("save_api_key", { key });
}

export function getApiKeyStatus(): Promise<string | null> {
  return invoke("get_api_key_status");
}

export function deleteApiKey(): Promise<void> {
  return invoke("delete_api_key");
}

// ─── Gemini API Key ───

export function saveGeminiApiKey(key: string): Promise<void> {
  return invoke("save_gemini_api_key", { key });
}

export function getGeminiApiKeyStatus(): Promise<string | null> {
  return invoke("get_gemini_api_key_status");
}

export function deleteGeminiApiKey(): Promise<void> {
  return invoke("delete_gemini_api_key");
}

export function saveAgentCapabilities(
  capabilities: AgentCapabilities,
): Promise<void> {
  return invoke("save_agent_capabilities", { capabilities });
}

export function getAgentCapabilities(): Promise<AgentCapabilities> {
  return invoke("get_agent_capabilities");
}

// ─── UI Preferences ───

export function getUiPreferences(): Promise<UIPreferences> {
  return invoke("get_ui_preferences");
}

export function saveUiPreferences(
  preferences: UIPreferences,
): Promise<void> {
  return invoke("save_ui_preferences", { preferences });
}

// ─── Recent Files ───

export function getRecentFiles(): Promise<RecentFile[]> {
  return invoke("get_recent_files");
}

export function addRecentFile(path: string): Promise<void> {
  return invoke("add_recent_file", { path });
}

export function removeRecentFile(path: string): Promise<void> {
  return invoke("remove_recent_file", { path });
}

// ─── PDF Import ───

export function importPdf(filePath: string): Promise<PdfMetadata> {
  return invoke("import_pdf", { filePath });
}

export function extractPdfWithClaude(filePath: string): Promise<PdfMetadata> {
  return invoke("extract_pdf_with_claude", { filePath });
}

// ─── Export ───

export function getPaperNodesByLayers(): Promise<LayerPaperGroup[]> {
  return invoke("get_paper_nodes_by_layers");
}

export function exportBibtexSelected(nodeIds: string[]): Promise<string> {
  return invoke("export_bibtex_selected", { nodeIds });
}

export function exportBibtexToFile(nodeIds: string[]): Promise<string> {
  return invoke("export_bibtex_to_file", { nodeIds });
}

// ─── Image Import ───

export function validateImageFile(filePath: string): Promise<ImageFileInfo> {
  return invoke("validate_image_file", { filePath });
}

export function createImageNode(
  layerId: string,
  title: string,
  description: string | null,
  positionX: number,
  positionY: number,
  nodeWidth: number | null,
  nodeHeight: number | null,
  filePath: string,
  mimeType: string,
  originalFilename: string,
  imageWidth: number | null,
  imageHeight: number | null,
  creatorUserId?: string | null,
  creatorUserName?: string | null,
): Promise<string> {
  return invoke("create_image_node", {
    layerId,
    title,
    description,
    positionX,
    positionY,
    nodeWidth,
    nodeHeight,
    filePath,
    mimeType,
    originalFilename,
    imageWidth,
    imageHeight,
    creatorUserId: creatorUserId ?? null,
    creatorUserName: creatorUserName ?? null,
  });
}

export function getNodeImageInfo(nodeId: string): Promise<ImageFileInfo> {
  return invoke("get_node_image_info", { nodeId });
}

export function checkFileExists(filePath: string): Promise<boolean> {
  return invoke("check_file_exists", { filePath });
}

export function updateNodeImagePath(
  nodeId: string,
  newFilePath: string,
): Promise<void> {
  return invoke("update_node_image_path", { nodeId, newFilePath });
}

export function openFileExternal(filePath: string): Promise<void> {
  return invoke("open_file_external", { filePath });
}

export function setPaperPdfPath(
  nodeId: string,
  pdfPath: string,
): Promise<void> {
  return invoke("set_paper_pdf_path", { nodeId, pdfPath });
}

export function getPaperPdfPath(nodeId: string): Promise<string | null> {
  return invoke("get_paper_pdf_path", { nodeId });
}

// ─── Usage Tracking ───

export function getUsageSummary(): Promise<UsageSummary> {
  return invoke("get_usage_summary");
}

export function getUsageHistory(limit: number): Promise<UsageLogEntry[]> {
  return invoke("get_usage_history", { limit });
}

export function clearUsageLog(): Promise<void> {
  return invoke("clear_usage_log");
}

// ─── Agent Node Messages ───

export function getAgentNodeMessages(nodeId: string): Promise<AgentNodeMessage[]> {
  return invoke("get_agent_node_messages", { nodeId });
}

export function addAgentNodeMessage(
  nodeId: string,
  role: string,
  content: string,
  outputNodeId?: string | null,
): Promise<AgentNodeMessage> {
  return invoke("add_agent_node_message", {
    nodeId,
    role,
    content,
    outputNodeId: outputNodeId ?? null,
  });
}

export function deleteAgentNodeMessage(messageId: string): Promise<void> {
  return invoke("delete_agent_node_message", { messageId });
}

// ─── Agent ───

export function invokeAgent(
  query: string,
  invocationType: string,
  context: AgentContext,
  provider?: string | null,
): Promise<AgentResponse> {
  return invoke("invoke_agent", {
    query,
    invocationType,
    context,
    provider: provider ?? null,
  });
}

export function invokeAgentNode(
  agentNodeId: string,
  userMessage: string,
  updateNodeId?: string | null,
  provider?: string | null,
): Promise<InvokeAgentNodeResult> {
  return invoke("invoke_agent_node", {
    agentNodeId,
    userMessage,
    updateNodeId: updateNodeId ?? null,
    provider: provider ?? null,
  });
}

export function invokeAgentComment(
  nodeId: string,
  layerId: string,
  userMessage: string,
  provider?: string | null,
): Promise<string> {
  return invoke("invoke_agent_comment", {
    nodeId,
    layerId,
    userMessage,
    provider: provider ?? null,
  });
}

// ─── Paper Summarize & Chat ───

export function invokePaperSummarize(
  nodeId: string,
  layerId: string,
): Promise<PaperSummarizeResult> {
  return invoke("invoke_paper_summarize", { nodeId, layerId });
}

export function invokePaperChat(
  nodeId: string,
  userMessage: string,
): Promise<string> {
  return invoke("invoke_paper_chat", { nodeId, userMessage });
}

// ─── Paper Summary Prompt ───

export function getPaperSummaryPrompt(): Promise<string> {
  return invoke("get_paper_summary_prompt");
}

export function savePaperSummaryPrompt(prompt: string): Promise<void> {
  return invoke("save_paper_summary_prompt", { prompt });
}

export function resetPaperSummaryPrompt(): Promise<void> {
  return invoke("reset_paper_summary_prompt");
}

// ─── PDF Export ───

export function getExportSections(exportNodeId: string): Promise<ExportPreview> {
  return invoke("get_export_sections", { exportNodeId });
}

export function updateExportSectionOrder(
  exportNodeId: string,
  sectionOrder: string[],
): Promise<void> {
  return invoke("update_export_section_order", { exportNodeId, sectionOrder });
}

export function updateExportCitationStyle(
  exportNodeId: string,
  style: string,
): Promise<void> {
  return invoke("update_export_citation_style", { exportNodeId, style });
}

export function updateExportLanguage(
  exportNodeId: string,
  language: string,
): Promise<void> {
  return invoke("update_export_language", { exportNodeId, language });
}

export function updateExportStyleConfig(
  exportNodeId: string,
  styleConfig: ExportStyleConfig,
): Promise<void> {
  return invoke("update_export_style_config", { exportNodeId, styleConfig });
}

export function generateExportPdf(
  exportNodeId: string,
  outputPath: string,
): Promise<string> {
  return invoke("generate_export_pdf", { exportNodeId, outputPath });
}

// ─── Supabase Config ───

export function saveSupabaseConfig(url: string, anonKey: string): Promise<void> {
  return invoke("save_supabase_config", { url, anonKey });
}

export function getSupabaseConfig(): Promise<[string, string]> {
  return invoke("get_supabase_config");
}

export function getSupabaseConfigStatus(): Promise<boolean> {
  return invoke("get_supabase_config_status");
}

export function deleteSupabaseConfig(): Promise<void> {
  return invoke("delete_supabase_config");
}

// ─── Nano Banana ───

export interface NanoBananaResult {
  file_path: string;
  mime_type: string;
  description: string | null;
}

export function generateNanoBananaImage(
  nodeId: string,
  layerId: string,
  prompt: string,
  aspectRatio?: string,
): Promise<NanoBananaResult> {
  return invoke("generate_nano_banana_image", { nodeId, layerId, prompt, aspectRatio });
}

// ─── Cloud Sync ───

export function syncListRemote(): Promise<RemoteFileInfo[]> {
  return invoke("sync_list_remote");
}

export function syncCheckStatus(localPath: string): Promise<SyncStatusResult> {
  return invoke("sync_check_status", { localPath });
}

export function syncUpload(localPath: string): Promise<void> {
  return invoke("sync_upload", { localPath });
}

export function syncDownload(remoteName: string, localPath: string): Promise<void> {
  return invoke("sync_download", { remoteName, localPath });
}

export function syncGetRemoteStats(remoteName: string): Promise<RemoteFileStats> {
  return invoke("sync_get_remote_stats", { remoteName });
}

// ─── User Identity ───

export function getUserIdentity(): Promise<UserIdentity> {
  return invoke("get_user_identity");
}

export function registerUser(userName: string): Promise<UserIdentity> {
  return invoke("register_user", { userName });
}

export function updateUserName(userName: string): Promise<UserIdentity> {
  return invoke("update_user_name", { userName });
}
