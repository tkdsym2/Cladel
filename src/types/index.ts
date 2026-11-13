// ─── Database entities (match Rust struct field names, snake_case) ───

export interface ProjectData {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface LayerData {
  id: string;
  project_id: string;
  layer_number: number;
  created_at: string;
  updated_at: string;
}

export type NodeType = "core" | "paper" | "user_doc" | "agent_proposal" | "deleted" | "junction" | "image" | "agent" | "paper_group" | "export" | "compare" | "title" | "table" | "render" | "translate";
export type NodeStatus = "active" | "ghost" | "dismissed";
export type CreatedBy = "user" | "agent";

export interface NodeData {
  id: string;
  layer_id: string;
  node_type: NodeType;
  title: string;
  content: string | null;
  bibtex: string | null;
  metadata: string | null;
  pdf_path: string | null;
  display_id: string | null;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  status: NodeStatus;
  created_by: CreatedBy;
  created_at: string;
  updated_at: string;
  creator_user_id: string | null;
  creator_user_name: string | null;
}

export interface EdgeData {
  id: string;
  layer_id: string;
  source_node_id: string;
  target_node_id: string;
  weight: number;
  comment: string;
  source_handle: string | null;
  target_handle: string | null;
  created_by: CreatedBy;
  created_at: string;
  updated_at: string;
}

export interface CoreVersionData {
  id: string;
  node_id: string;
  version_number: number;
  content: string;
  created_at: string;
}

export interface NoteVersionData {
  id: string;
  node_id: string;
  version_number: number;
  content: string;
  created_at: string;
}

export interface CoreVersionDiff {
  version_a: number;
  version_b: number;
  content_a: string;
  content_b: string;
}

// ─── Node comments ───

export interface NodeComment {
  id: string;
  node_id: string;
  author_type: "user" | "agent";
  content: string;
  created_at: string;
  updated_at: string;
  creator_user_id: string | null;
  creator_user_name: string | null;
}

export interface NodeCommentCount {
  node_id: string;
  count: number;
}

export interface EdgeComment {
  id: string;
  edge_id: string;
  author_type: "user" | "agent";
  content: string;
  created_at: string;
  updated_at: string;
  creator_user_id: string | null;
  creator_user_name: string | null;
}

export interface EdgeCommentCount {
  edge_id: string;
  count: number;
}

// ─── Junction (edge branching) results ───

export interface SplitEdgeResult {
  junction_node: NodeData;
  edge_a: EdgeData; // source → junction
  edge_b: EdgeData; // junction → target
}

export interface DissolveJunctionResult {
  merged_edge: EdgeData;
}

export interface BibtexEntry {
  entry_type: string;
  cite_key: string;
  title: string;
  authors: string[];
  year: string | null;
  journal: string | null;
  booktitle: string | null;
  doi: string | null;
  url: string | null;
  abstract_text: string | null;
  raw: string;
  fields: Record<string, string>;
  parse_error: string | null;
}

// ─── Literature search (Semantic Scholar) ───

export interface PaperResult {
  paper_id: string;
  title: string;
  authors: string[];
  year: number | null;
  abstract_text: string | null;
  url: string | null;
}

export interface PaperDetail {
  paper_id: string;
  title: string;
  authors: string[];
  year: number | null;
  abstract_text: string | null;
  url: string | null;
  doi: string | null;
  citation_count: number | null;
  reference_count: number | null;
  references: PaperResult[];
  citations: PaperResult[];
}

// ─── Ghost node (agent proposal) metadata ───

export type GhostProposalType = "paper" | "idea" | "connection";

export interface GhostSuggestedEdge {
  target_node_id: string;
  comment: string;
}

export interface GhostData {
  proposal_type: GhostProposalType;
  reason?: string;
  // Paper proposal fields
  paper_id?: string;
  authors?: string[];
  year?: number | null;
  abstract_text?: string | null;
  url?: string | null;
  // Idea proposal fields
  body?: string;
  // Suggested edges to create on accept
  suggested_edges?: GhostSuggestedEdge[];
}

export interface CreateGhostNodeInput {
  layer_id: string;
  proposal_type: GhostProposalType;
  title: string;
  reason?: string;
  // Paper proposal
  paper_id?: string;
  authors?: string[];
  year?: number | null;
  abstract_text?: string | null;
  url?: string | null;
  // Idea proposal
  body?: string;
  // Position
  position_x: number;
  position_y: number;
  // Suggested edges
  suggested_edges?: GhostSuggestedEdge[];
}

// ─── Agent suggestions ───

export type AgentInvocationType =
  | "search_papers"
  | "suggest_connections"
  | "suggest_ideas"
  | "general"
  | "autonomous";

export type AgentStatus = "idle" | "thinking" | "done" | "error";

export interface AgentErrorInfo {
  error_code: string;
  message: string;
  retry_after_secs: number | null;
  recoverable: boolean;
}

export interface AgentSuggestion {
  id: string;
  type: "paper" | "idea" | "connection";
  title: string;
  description: string;
  data:
    | PaperResult
    | { body: string }
    | { sourceNodeId: string; targetNodeId: string; reason: string };
  actioned: boolean;
}

export interface AgentHistoryEntry {
  id: string;
  query: string;
  invocationType: AgentInvocationType;
  response: string;
  timestamp: string;
}

// ─── Agent IPC types (match Rust struct field names) ───

export interface NodeSummary {
  id: string;
  node_type: string;
  title: string;
  content_preview: string | null;
  connection_count: number;
  connected_to: string[];
}

export interface AgentEdgeComment {
  author_type: string;
  content: string;
}

export interface EdgeSummary {
  id: string;
  source_id: string;
  target_id: string;
  source_node_title: string;
  target_node_title: string;
  weight: number;
  comment: string;
  comment_count: number;
  comments: AgentEdgeComment[];
}

export interface GraphStats {
  total_nodes: number;
  total_edges: number;
  node_type_counts: Record<string, number>;
  isolated_node_count: number;
}

export interface AgentContext {
  current_layer_id: string;
  core_content_preview: string | null;
  graph_stats: GraphStats;
  node_summaries: NodeSummary[];
  edge_summaries: EdgeSummary[];
}

export interface ConnectionSuggestion {
  source_node_id: string;
  target_node_id: string;
  reason: string;
}

export interface AgentSuggestionData {
  suggestion_type: string;
  title: string;
  description: string;
  paper_data: PaperResult | null;
  idea_body: string | null;
  connection: ConnectionSuggestion | null;
}

export interface AgentResponse {
  suggestions: AgentSuggestionData[];
  message: string;
}

// ─── Command inputs (match Rust struct field names, snake_case) ───

export interface CreateNodeInput {
  layer_id: string;
  node_type: NodeType;
  title: string;
  content?: string | null;
  bibtex?: string | null;
  metadata?: string | null;
  position_x: number;
  position_y: number;
  width?: number | null;
  height?: number | null;
  created_by?: CreatedBy;
  creator_user_id?: string | null;
  creator_user_name?: string | null;
}

// ─── User Identity ───

export interface UserIdentity {
  user_id: string | null;
  user_name: string | null;
}

export interface UpdateNodeInput {
  id: string;
  title?: string | null;
  content?: string | null;
  bibtex?: string | null;
  metadata?: string | null;
  position_x?: number | null;
  position_y?: number | null;
  width?: number | null;
  height?: number | null;
  status?: NodeStatus | null;
}

export interface CreateEdgeInput {
  layer_id: string;
  source_node_id: string;
  target_node_id: string;
  weight?: number | null;
  comment?: string | null;
  source_handle?: string | null;
  target_handle?: string | null;
}

export interface UpdateEdgeInput {
  id: string;
  weight?: number | null;
  comment?: string | null;
  source_node_id?: string | null;
  target_node_id?: string | null;
  source_handle?: string | null;
  target_handle?: string | null;
}

// ─── PDF import ───

export interface PdfMetadata {
  title: string;
  authors: string[];
  year: string | null;
  abstract_text: string | null;
  journal: string | null;
  doi: string | null;
  bibtex: string | null;
  extraction_method: string;
}

// ─── BibTeX export ───

export interface PaperExportInfo {
  node_id: string;
  title: string;
  authors: string;
  year: string;
  has_bibtex: boolean;
}

export interface LayerPaperGroup {
  layer_id: string;
  layer_name: string;
  layer_number: number;
  papers: PaperExportInfo[];
}

// ─── Graph structure analysis ───

export interface IsolatedNodeInfo {
  node_id: string;
  node_title: string;
  node_type: string;
  edge_count: number;
}

export interface StarPatternInfo {
  core_direct_edges: number;
  total_edges: number;
  ratio: number;
}

export interface ClusterInfo {
  cluster_id: number;
  node_ids: string[];
  node_titles: string[];
}

export interface DepthImbalanceInfo {
  max_depth: number;
  min_leaf_depth: number;
  depth_difference: number;
}

export interface GraphAnomalies {
  isolated_nodes: IsolatedNodeInfo[];
  star_pattern: StarPatternInfo | null;
  disconnected_clusters: ClusterInfo[];
  depth_imbalance: DepthImbalanceInfo | null;
  has_anomalies: boolean;
}

// ─── Image node ───

export interface ImageFileInfo {
  file_path: string;
  mime_type: string;
  original_filename: string;
  image_width: number | null;
  image_height: number | null;
  node_id: string | null;
}

// ─── UI Preferences ───

export interface UIPreferences {
  core_default_width: number;
  core_default_height: number;
  paper_default_width: number;
  paper_default_height: number;
  user_doc_default_width: number;
  user_doc_default_height: number;
  ghost_default_width: number;
  ghost_default_height: number;
  image_default_width: number;
  image_default_height: number;
  sidebar_default_width: number;
  canvas_background: string;
  canvas_grid_enabled: boolean;
  canvas_grid_size: number;
  editor_font_size: number;
  /** UI language: "en" (default) or "ja". */
  language: AppLanguage;
}

export type AppLanguage = "en" | "ja";

export const SYSTEM_DEFAULTS: UIPreferences = {
  core_default_width: 280,
  core_default_height: 210,
  paper_default_width: 280,
  paper_default_height: 210,
  user_doc_default_width: 280,
  user_doc_default_height: 210,
  ghost_default_width: 280,
  ghost_default_height: 210,
  image_default_width: 280,
  image_default_height: 210,
  sidebar_default_width: 380,
  canvas_background: "#f8fafc",
  canvas_grid_enabled: true,
  canvas_grid_size: 20,
  editor_font_size: 13,
  language: "en",
};

// ─── Agent usage tracking ───

export interface UsageByType {
  invocation_type: string;
  count: number;
  total_tokens: number;
}

export interface UsageByModel {
  model: string;
  count: number;
  total_tokens: number;
}

export interface UsageSummary {
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  calls_today: number;
  tokens_today: number;
  calls_this_week: number;
  tokens_this_week: number;
  by_invocation_type: UsageByType[];
  by_model: UsageByModel[];
  estimated_cost_usd: number;
}

export interface UsageLogEntry {
  id: string;
  invocation_type: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  success: boolean;
  created_at: string;
}

// ─── Agent capabilities ───

export interface AgentCapabilities {
  agent_enabled: boolean;
  autonomous_enabled: boolean;
  search_papers_enabled: boolean;
  suggest_connections_enabled: boolean;
  suggest_ideas_enabled: boolean;
  autonomous_idle_seconds: number;
  autonomous_cooldown_seconds: number;
}

// ─── Agent Node Messages ───

export interface AgentNodeMessage {
  id: string;
  node_id: string;
  role: 'user' | 'agent';
  content: string;
  output_node_id: string | null;
  created_at: string;
}

// ─── Agent Node Invocation ───

export interface InvokeAgentNodeResult {
  agent_message: string;
  output_node_id: string | null;
  is_update: boolean;
}

// ─── Paper Summarize ───

export interface PaperSummarizeResult {
  agent_message: string;
  output_node_id: string;
}

// ─── Paper Group ───

export interface PaperGroupMetadata {
  group_name: string;
  member_node_ids: string[];
  original_positions: Record<string, { x: number; y: number; width: number; height: number }>;
  collapsed_size?: { width: number; height: number };
  expanded?: boolean;
}

// ─── Tab-to-Create ───

export type TabNodeType = "user_doc" | "paper" | "image" | "agent" | "import" | "export" | "compare" | "title" | "table" | "render" | "translate";

// ─── Table Node ───

export type TableMode = "unconfigured" | "manual" | "imported";

export interface TableSource {
  format: "csv" | "xlsx";
  filename: string;
  /** Absolute path of the source file — used to reload the latest state on demand. */
  path: string;
  sheet?: string | null;
}

/** Table node model, stored as JSON in NodeData.metadata. */
export interface TableModel {
  kind: "table";
  mode: TableMode;
  rows: string[][];
  source?: TableSource | null;
}

/** Result of the import_table_file backend command. */
export interface TableImportResult {
  format: "csv" | "xlsx";
  filename: string;
  sheet: string | null;
  rows: string[][];
}

// ─── Render Node ───

export type CitationStyle = "ieee" | "apa" | "acm";

/** Render node model, stored as JSON in NodeData.metadata.
 *  A render node compiles the Typst source of its connected Note nodes and
 *  shows a faithful PDF preview. */
export interface RenderModel {
  kind: "render";
  /** Citation style for the generated bibliography (default "ieee"). */
  citation_style?: CitationStyle;
}

/** Result of the render_typst_preview backend command. */
export interface RenderPreviewResult {
  /** Absolute PNG file paths for each rendered page (use convertFileSrc to display). */
  pages: string[];
  page_count: number;
  note_count: number;
}

// ─── Translate Node ───

/** Running llama-server sidecar (translation_server_start / _status). */
export interface TranslationServerStatus {
  port: number;
  pid: number;
  model_path: string;
}

/** PLaMo 3 Translate language codes (model card). */
export type TranslateLang =
  | "ja" | "en" | "zh-hans" | "zh-hant" | "ko" | "ar" | "az" | "be" | "bg" | "bn" | "ca" | "ceb" | "de" | "es"
  | "et" | "eu" | "fa" | "fr" | "gu" | "he" | "hi" | "hr" | "hu" | "hy" | "id" | "it" | "jv" | "ka" | "kk"
  | "km" | "lt" | "lv" | "ml" | "mr" | "ms" | "my" | "ne" | "nl" | "pa" | "pl" | "ru" | "si" | "sk" | "sl"
  | "sr" | "sw" | "ta" | "te" | "th" | "tl" | "ur" | "uz" | "vi";

/** Japanese output style: plain = だ・である調, polite = です・ます調. */
export type JaForm = "plain" | "polite";

export interface GlossaryEntry {
  src: string;
  dst: string;
}

/** Translate node model, stored as JSON in NodeData.metadata. */
export interface TranslateModel {
  kind: "translate";
  target_lang: TranslateLang;
  /** null = auto-detect. */
  source_lang: TranslateLang | null;
  /** Japanese output style (only used when target_lang === "ja"). */
  form: JaForm | null;
  glossary: GlossaryEntry[];
  /** Source text used when no node is connected as input. */
  input_text: string;
  /** Last completed translation. */
  output: string;
  translated_at: string | null;
  /** Note (user_doc) created by "Write to Note"; updated after each translation. */
  output_node_id: string | null;
  /** Block pairs of the last translation (single Note input only) and that
   *  Note's id — become the sync snapshot when written to a Note. */
  output_pairs: SyncPair[] | null;
  output_source_id: string | null;
  /** Bilingual note pair kept in sync by this node (null = not syncing). */
  sync: TranslateSync | null;
}

export interface TranslateOptions {
  target_lang: TranslateLang;
  /** null/omitted = auto-detect. */
  source_lang?: TranslateLang | null;
  /** Only applied when target_lang === "ja". */
  form?: JaForm | null;
  glossary?: GlossaryEntry[];
}

/** typst = Note source (prose translated, markup preserved); plain = text / Markdown. */
export type TranslateInputFormat = "typst" | "plain";

export interface TranslateInput {
  text: string;
  format: TranslateInputFormat;
}

export interface TranslateRequest extends TranslateOptions {
  /** Caller-chosen id, used by translateCancel. */
  job_id: string;
  /** Omit to use the active model (Settings → Translation). */
  model_path?: string | null;
  /** Translated in order, joined with a blank line. */
  inputs?: TranslateInput[];
  /** Shorthand for one plain-text input. */
  text?: string;
  /** Image node display_id → caption. In Typst inputs, lines holding only
   *  `{{@image_N}}` become adjustable `#figure(image("@image_N", ...))`s with
   *  the caption translated. */
  figures?: Record<string, string>;
}

// ─── Translation model management ───

export type ModelSizeLabel = "0.8b" | "2b" | "8b";

export interface RemoteModelFile {
  repo: string;
  size_label: ModelSizeLabel;
  filename: string;
  bytes: number;
  /** SHA-256 (HF lfs.oid). */
  sha256: string;
  quant: string;
  recommended: boolean;
}

export interface RemoteRepo {
  size_label: ModelSizeLabel;
  repo: string;
  files: RemoteModelFile[];
  /** Live fetch failed (files may come from the offline cache). */
  error: string | null;
  from_cache: boolean;
}

export interface LocalModel {
  path: string;
  filename: string;
  repo: string | null;
  size_label: ModelSizeLabel | null;
  quant: string | null;
  bytes: number;
  sha256: string | null;
  /** SHA-256 matched the official Hugging Face file. */
  verified: boolean;
  source: "download" | "import" | "manual";
  active: boolean;
}

export interface PartialDownload {
  path: string;
  repo: string;
  filename: string;
  downloaded: number;
  total: number;
  running: boolean;
}

export interface LocalModels {
  models_dir: string;
  models: LocalModel[];
  partials: PartialDownload[];
  active_model_path: string | null;
  /** False where local translation is not available (non-macOS builds). */
  platform_supported: boolean;
}

/** `translation-model-progress` event payload (downloads and imports). */
export interface ModelProgress {
  /** "{repo}/{filename}" or "import:{filename}" */
  key: string;
  filename: string;
  status: "starting" | "hashing" | "downloading" | "done" | "cancelled" | "error";
  downloaded: number;
  total: number;
  bytes_per_sec: number;
  error: string | null;
}

export interface LicenseText {
  lang: "ja" | "en";
  text: string | null;
  sha256: string | null;
  from_cache: boolean;
  official_url: string;
  error: string | null;
}

export interface LicenseStatus {
  accepted: boolean;
  accepted_at: string | null;
  needs_reaccept: boolean;
}

/** Streamed by translate_text. Running document = last `segment.prefix` + following `delta` texts. */
export type TranslateEvent =
  | { type: "loading" }
  | { type: "started"; chunk_count: number }
  | { type: "segment"; chunk_index: number; prefix: string }
  | { type: "delta"; chunk_index: number; text: string }
  | { type: "chunk_done"; chunk_index: number };

export interface TranslateResult {
  text: string;
  cancelled: boolean;
  chunk_count: number;
  tokens_predicted: number;
  duration_ms: number;
  /** A piece hit the generation limit (output may be cut short). */
  truncated: boolean;
  /** Pieces that needed the placeholder retry to keep their markup. */
  masked_retries: number;
  /** Starts of pieces left untranslated because their markup could not be preserved. */
  kept_original: string[];
  /** Single Typst input: (source block, translated block) pairs. */
  pairs: SyncPair[] | null;
}

// ─── Bilingual note pair sync ───

/** One aligned block pair as of the last sync; a null side has no counterpart. */
export interface SyncPair {
  src: string | null;
  dst: string | null;
}

export interface TranslateSync {
  /** The input Note (written in source_lang) ⇄ the output Note (target_lang). */
  source_note_id: string;
  target_note_id: string;
  source_lang: TranslateLang;
  target_lang: TranslateLang;
  pairs: SyncPair[];
  synced_at: string;
}

export type SyncSide = "src" | "dst";
export type SyncItemKind = "modified" | "added" | "deleted" | "conflict_modified" | "conflict_deleted";
export type SyncAction = "write_src" | "write_dst" | "delete" | "ignore";

export interface SyncItem {
  key: string;
  kind: SyncItemKind;
  /** Side that changed / was deleted / (conflict_deleted) was edited. */
  side: SyncSide;
  src_text: string | null;
  dst_text: string | null;
  old_src: string | null;
  old_dst: string | null;
}

export interface SyncState {
  source_text: string;
  target_text: string;
  pairs: SyncPair[];
  items: SyncItem[];
}

export type TabDirection = "right" | "left";

export const TAB_HANDLE_MAP: Record<TabDirection, { sourceHandle: string; targetHandle: string }> = {
  right: { sourceHandle: "right", targetHandle: "left-target" },
  left:  { sourceHandle: "left",  targetHandle: "right-target" },
};

// ─── Export Node ───

export interface ExportSection {
  node_id: string;
  display_id: string | null;
  title: string;
  content: string;
  cited_papers: CitedPaper[];
  referenced_images: ReferencedImageRef[];
}

export interface CitedPaper {
  display_id: string;
  node_id: string;
  title: string;
  authors: string[];
  year: string | null;
  journal: string | null;
  volume: string | null;
  number: string | null;
  pages: string | null;
  doi: string | null;
}

export interface ReferencedImageRef {
  display_id: string;
  node_id: string;
  title: string;
  file_path: string | null;
  caption: string | null;
  file_exists: boolean;
}

export interface ExportStyleConfig {
  en_font_preset: string;
  jp_font_preset: string;
  title_size: number;
  section_heading_size: number;
  subsection_heading_size: number;
  body_size: number;
  line_spacing: number;
  margin_top: number;
  margin_bottom: number;
  margin_left: number;
  margin_right: number;
  section_numbering: boolean;
  title_alignment: string;
  affiliation_marker: string;
  show_line_numbers: boolean;
}

export const DEFAULT_EXPORT_STYLE: ExportStyleConfig = {
  en_font_preset: "times_new_roman",
  jp_font_preset: "ms_mincho",
  title_size: 18,
  section_heading_size: 14,
  subsection_heading_size: 12,
  body_size: 11,
  line_spacing: 1.0,
  margin_top: 20,
  margin_bottom: 20,
  margin_left: 15,
  margin_right: 15,
  section_numbering: true,
  title_alignment: "left",
  affiliation_marker: "number",
  show_line_numbers: false,
};

export interface ExportAuthor {
  name: string;
  affiliations: string[];
}

export interface ExportTitlePage {
  subtitle: string;
  authors: ExportAuthor[];
}

export const DEFAULT_EXPORT_TITLE_PAGE: ExportTitlePage = {
  subtitle: "",
  authors: [],
};

export interface ExportPreview {
  sections: ExportSection[];
  citation_style: string;
  language: string;
  all_cited_papers: CitedPaper[];
  all_referenced_images: ReferencedImageRef[];
  style_config: ExportStyleConfig;
  title_page: ExportTitlePage;
}

// ─── Recent Files ───

export interface RecentFile {
  path: string;
  name: string;
  last_opened: string;
}

