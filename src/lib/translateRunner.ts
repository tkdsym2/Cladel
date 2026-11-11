import * as cmd from "./tauri-commands";
import { useGraphStore } from "../store/graphStore";
import { useTranslateStore } from "../store/translateStore";
import { useSettingsStore } from "../store/settingsStore";
import { emitNodeUpdated } from "./sync-events";
import { TAB_HANDLE_MAP, type NodeData, type TranslateInput, type TranslateModel, type TranslateSync } from "../types";
import { guessSourceLang } from "./translateLangs";

/** Node types whose text can feed a Translate node (paper → abstract). */
const INPUT_TYPES = new Set(["user_doc", "core", "paper"]);

export function defaultTranslateModel(): TranslateModel {
  const ui = useSettingsStore.getState().uiPreferences.language;
  return {
    kind: "translate",
    // Japanese UI → most likely translating Japanese drafts into English.
    target_lang: ui === "ja" ? "en" : "ja",
    source_lang: null,
    form: null,
    glossary: [],
    input_text: "",
    output: "",
    translated_at: null,
    output_node_id: null,
    output_pairs: null,
    output_source_id: null,
    sync: null,
  };
}

export function parseTranslateModel(metadata: string | null | undefined): TranslateModel {
  const base = defaultTranslateModel();
  if (!metadata) return base;
  try {
    const m = JSON.parse(metadata);
    return {
      ...base,
      ...m,
      kind: "translate",
      glossary: Array.isArray(m.glossary) ? m.glossary : [],
      input_text: typeof m.input_text === "string" ? m.input_text : "",
      output: typeof m.output === "string" ? m.output : "",
    };
  } catch {
    return base;
  }
}

/** Merge `partial` into the node's stored model (re-reads the latest first). */
export async function patchTranslateModel(nodeId: string, partial: Partial<TranslateModel>): Promise<TranslateModel> {
  const node = useGraphStore.getState().getDbNode(nodeId);
  const next = { ...parseTranslateModel(node?.metadata), ...partial };
  await useGraphStore.getState().updateNodeContent(nodeId, { metadata: JSON.stringify(next) });
  return next;
}

/** Nodes connected into this Translate node's input (incoming edges), top-to-bottom. */
export function translateInputNodes(nodeId: string): NodeData[] {
  const { dbEdges, dbNodes } = useGraphStore.getState();
  const model = parseTranslateModel(dbNodes.find((n) => n.id === nodeId)?.metadata);
  const ids = new Set(
    dbEdges.filter((e) => e.target_node_id === nodeId).map((e) => e.source_node_id),
  );
  return dbNodes
    .filter((n) => ids.has(n.id) && n.id !== linkedOutputNote(nodeId, model.output_node_id)?.id && INPUT_TYPES.has(n.node_type))
    .sort((a, b) => a.position_y - b.position_y || a.position_x - b.position_x);
}

/** What to translate: connected nodes' content (Notes as Typst, so only their
 *  prose is translated and markup is kept), else the node's own input text. */
export function collectTranslateInput(nodeId: string): { inputs: TranslateInput[]; sources: NodeData[] } {
  const sources = translateInputNodes(nodeId).filter((n) => (n.content ?? "").trim() !== "");
  if (sources.length > 0) {
    return {
      inputs: sources.map((n) => ({
        text: n.content ?? "",
        format: n.node_type === "user_doc" ? "typst" : "plain",
      })),
      sources,
    };
  }
  const model = parseTranslateModel(useGraphStore.getState().getDbNode(nodeId)?.metadata);
  const text = model.input_text.trim();
  return { inputs: text ? [{ text, format: "plain" }] : [], sources: [] };
}

/** Image node display_id → caption (its title), for `{{@image_N}}` → figure. */
export function figureCaptions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of useGraphStore.getState().dbNodes) {
    if (n.node_type === "image" && n.display_id) out[n.display_id] = n.title ?? "";
  }
  return out;
}

/** The linked output note is live only while it exists AND is still wired to
 *  this Translate node (a copied node or a removed wire unlinks it). */
export function linkedOutputNote(nodeId: string, noteId: string | null): NodeData | undefined {
  if (!noteId) return undefined;
  const { dbNodes, dbEdges } = useGraphStore.getState();
  const n = dbNodes.find((x) => x.id === noteId && x.node_type === "user_doc");
  const wired = dbEdges.some(
    (e) =>
      (e.source_node_id === nodeId && e.target_node_id === noteId) ||
      (e.source_node_id === noteId && e.target_node_id === nodeId),
  );
  return n && wired ? n : undefined;
}

/** Translate with streaming into translateStore; saves the result into the node. */
export async function runTranslate(nodeId: string): Promise<void> {
  const store = useTranslateStore.getState();
  const current = store.byNode[nodeId];
  if (current && (current.status === "loading" || current.status === "translating")) return;

  const node = useGraphStore.getState().getDbNode(nodeId);
  if (!node) return;
  const model = parseTranslateModel(node.metadata);
  const { inputs, sources } = collectTranslateInput(nodeId);
  if (inputs.length === 0) {
    store.update(nodeId, {
      status: "error",
      error: "NO_INPUT",
      live: "",
    });
    return;
  }

  const jobId = `${nodeId}:${Date.now()}`;
  store.update(nodeId, {
    status: "translating",
    live: "",
    error: null,
    jobId,
    chunkIndex: 0,
    chunkCount: 0,
    truncated: false,
    keptOriginal: [],
  });

  let live = "";
  try {
    const result = await cmd.translateText(
      {
        job_id: jobId,
        inputs,
        figures: figureCaptions(),
        target_lang: model.target_lang,
        source_lang: model.source_lang,
        form: model.target_lang === "ja" ? model.form : null,
        glossary: model.glossary.filter((g) => g.src.trim() && g.dst.trim()),
      },
      (ev) => {
        const s = useTranslateStore.getState();
        switch (ev.type) {
          case "loading":
            s.update(nodeId, { status: "loading" });
            break;
          case "started":
            s.update(nodeId, { status: "translating", chunkCount: ev.chunk_count });
            break;
          case "segment":
            // Everything assembled so far (incl. untouched markup) before this piece.
            live = ev.prefix;
            s.update(nodeId, { live, chunkIndex: ev.chunk_index });
            break;
          case "delta":
            live += ev.text;
            s.update(nodeId, { live, chunkIndex: ev.chunk_index });
            break;
          case "chunk_done":
            break;
        }
      },
    );

    if (result.cancelled) {
      useTranslateStore.getState().update(nodeId, { status: "cancelled", live: result.text || live });
      return;
    }
    useTranslateStore.getState().update(nodeId, {
      status: "done",
      live: result.text,
      truncated: result.truncated,
      keptOriginal: result.kept_original,
    });

    // Never overwrite the linked output note automatically: it may have been
    // edited by hand. "Update note" in the panel applies the new result explicitly.
    await patchTranslateModel(nodeId, {
      output: result.text,
      translated_at: new Date().toISOString(),
      // Paragraph pairs → the sync snapshot once written to a Note.
      output_pairs: result.pairs ?? null,
      output_source_id: sources.length === 1 && sources[0].node_type === "user_doc" ? sources[0].id : null,
    });
  } catch (e) {
    const msg = String(e);
    useTranslateStore.getState().update(nodeId, { status: "error", error: msg, live });
    if (msg.startsWith("NO_MODEL")) void useTranslateStore.getState().refreshModelStatus();
  }
}

export async function cancelTranslate(nodeId: string): Promise<void> {
  const jobId = useTranslateStore.getState().byNode[nodeId]?.jobId;
  if (jobId) await cmd.translateCancel(jobId);
}

/** Write the saved translation into a Note: updates the linked one or creates
 *  a new Note to the right, connected from the Translate node. Returns its id. */
export async function writeTranslationToNote(nodeId: string): Promise<string | null> {
  const gs = useGraphStore.getState();
  const node = gs.getDbNode(nodeId);
  if (!node) return null;
  const model = parseTranslateModel(node.metadata);
  if (!model.output) return null;

  const linked = linkedOutputNote(nodeId, model.output_node_id);
  if (linked) {
    await gs.updateNodeContent(linked.id, { content: model.output });
    emitNodeUpdated(linked.id);
    // The note now equals the translation: (re)start syncing from its pairs.
    await patchTranslateModel(nodeId, { sync: syncFromOutput(model, linked.id) });
    return linked.id;
  }

  const width = node.width ?? 280;
  const note = await gs.addNode({
    layer_id: node.layer_id,
    node_type: "user_doc",
    title: "Translation",
    content: model.output,
    position_x: node.position_x + width + 100,
    position_y: node.position_y,
    width: 280,
    height: 210,
  });
  await gs.addEdge({
    layer_id: node.layer_id,
    source_node_id: nodeId,
    target_node_id: note.id,
    source_handle: TAB_HANDLE_MAP.right.sourceHandle,
    target_handle: TAB_HANDLE_MAP.right.targetHandle,
  });
  await patchTranslateModel(nodeId, { output_node_id: note.id, sync: syncFromOutput(model, note.id) });
  return note.id;
}

/** The snapshot to store when the last translation is written into `targetNoteId`. */
export function syncFromOutput(model: TranslateModel, targetNoteId: string): TranslateSync | null {
  if (!model.output_pairs || !model.output_source_id) return null;
  const srcNote = useGraphStore.getState().getDbNode(model.output_source_id);
  return {
    source_note_id: model.output_source_id,
    target_note_id: targetNoteId,
    source_lang: model.source_lang ?? guessSourceLang(srcNote?.content ?? "", model.target_lang),
    target_lang: model.target_lang,
    pairs: model.output_pairs,
    synced_at: new Date().toISOString(),
  };
}


export function openTranslationSettings(): void {
  useSettingsStore.getState().openSettingsTab("translation");
}
