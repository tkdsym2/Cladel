/**
 * Bilingual note pair sync: a Translate node keeps its input Note (source
 * language) and its output Note (target language) in step, paragraph by
 * paragraph. The diff itself runs in Rust (`translate/sync.rs`); this module
 * finds the two notes, translates the block an item needs (either direction)
 * and writes the result back. Nothing is applied without a user action.
 */
import { useEffect, useMemo, useState } from "react";
import * as cmd from "./tauri-commands";
import { useGraphStore } from "../store/graphStore";
import { useTranslateStore, EMPTY_SYNC_STATE } from "../store/translateStore";
import { emitNodeUpdated } from "./sync-events";
import { guessSourceLang } from "./translateLangs";
import {
  figureCaptions,
  linkedOutputNote,
  parseTranslateModel,
  patchTranslateModel,
  translateInputNodes,
} from "./translateRunner";
import type { NodeData, SyncAction, SyncItem, SyncSide, TranslateModel, TranslateSync } from "../types";

interface SyncContext {
  model: TranslateModel;
  sync: TranslateSync;
  src: NodeData;
  dst: NodeData;
}

/** The synced notes, if the pair is still intact: the source Note is still
 *  wired to the Translate node and the target Note is its linked output. */
export function syncNotes(nodeId: string): SyncContext | null {
  const { dbNodes, dbEdges } = useGraphStore.getState();
  const node = dbNodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const model = parseTranslateModel(node.metadata);
  const sync = model.sync;
  if (!sync) return null;
  const src = dbNodes.find((n) => n.id === sync.source_note_id && n.node_type === "user_doc");
  const wired = dbEdges.some(
    (e) =>
      (e.source_node_id === sync.source_note_id && e.target_node_id === nodeId) ||
      (e.source_node_id === nodeId && e.target_node_id === sync.source_note_id),
  );
  const dst = linkedOutputNote(nodeId, sync.target_note_id);
  if (!src || !wired || !dst) return null;
  return { model, sync, src, dst };
}

/** Notes that could start syncing: exactly one input, a Note, plus the linked output Note. */
export function syncCandidates(nodeId: string): { src: NodeData; dst: NodeData } | null {
  const model = parseTranslateModel(useGraphStore.getState().getDbNode(nodeId)?.metadata);
  const inputs = translateInputNodes(nodeId);
  const dst = linkedOutputNote(nodeId, model.output_node_id);
  if (inputs.length !== 1 || inputs[0].node_type !== "user_doc" || !dst) return null;
  return { src: inputs[0], dst };
}

/** Start syncing two existing notes, pairing their paragraphs in order. */
export async function startSync(nodeId: string): Promise<void> {
  const c = syncCandidates(nodeId);
  if (!c) return;
  const model = parseTranslateModel(useGraphStore.getState().getDbNode(nodeId)?.metadata);
  const pairs = await cmd.translationSyncAlign(c.src.content ?? "", c.dst.content ?? "");
  await patchTranslateModel(nodeId, {
    sync: {
      source_note_id: c.src.id,
      target_note_id: c.dst.id,
      source_lang: model.source_lang ?? guessSourceLang(c.src.content ?? "", model.target_lang),
      target_lang: model.target_lang,
      pairs,
      synced_at: new Date().toISOString(),
    },
  });
}

export async function stopSync(nodeId: string): Promise<void> {
  await patchTranslateModel(nodeId, { sync: null });
}

export interface SyncCounts {
  /** Changes to carry from the source note into the target note. */
  toDst: number;
  toSrc: number;
  conflicts: number;
}

export function syncCounts(items: SyncItem[] | null): SyncCounts {
  const c: SyncCounts = { toDst: 0, toSrc: 0, conflicts: 0 };
  for (const i of items ?? []) {
    if (i.kind.startsWith("conflict")) c.conflicts++;
    else if (i.side === "src") c.toDst++;
    else c.toSrc++;
  }
  return c;
}

/** Live list of pending changes (recomputed whenever either note changes). */
export function useSyncPlan(nodeId: string): { sync: TranslateSync | null; valid: boolean; items: SyncItem[] | null } {
  const meta = useGraphStore((s) => s.dbNodes.find((n) => n.id === nodeId)?.metadata ?? null);
  const sync = useMemo(() => parseTranslateModel(meta).sync, [meta]);
  const srcContent = useGraphStore((s) =>
    sync ? (s.dbNodes.find((n) => n.id === sync.source_note_id)?.content ?? null) : null,
  );
  const dstContent = useGraphStore((s) =>
    sync ? (s.dbNodes.find((n) => n.id === sync.target_note_id)?.content ?? null) : null,
  );
  const edges = useGraphStore((s) => s.dbEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const valid = useMemo(() => !!sync && !!syncNotes(nodeId), [sync, nodeId, edges, srcContent, dstContent]);
  const [items, setItems] = useState<SyncItem[] | null>(null);

  useEffect(() => {
    if (!sync || !valid) {
      setItems(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      cmd
        .translationSyncPlan(srcContent ?? "", dstContent ?? "", sync.pairs)
        .then((r) => !cancelled && setItems(r))
        .catch(() => !cancelled && setItems(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sync, valid, srcContent, dstContent]);

  return { sync, valid, items };
}

/** Translate one block of a synced pair into the `to` side's language. */
async function translateBlock(nodeId: string, ctx: SyncContext, text: string, to: SyncSide): Promise<string | null> {
  const { model, sync } = ctx;
  const toLang = to === "dst" ? sync.target_lang : sync.source_lang;
  const fromLang = to === "dst" ? sync.source_lang : sync.target_lang;
  const glossary = model.glossary
    .filter((g) => g.src.trim() && g.dst.trim())
    .map((g) => (to === "dst" ? g : { src: g.dst, dst: g.src }));
  const jobId = `${nodeId}:sync:${Date.now()}`;
  useTranslateStore.getState().updateSync(nodeId, { jobId });
  const r = await cmd.translateText(
    {
      job_id: jobId,
      inputs: [{ text, format: "typst" }],
      figures: figureCaptions(),
      target_lang: toLang,
      source_lang: fromLang,
      form: toLang === "ja" ? model.form : null,
      glossary,
    },
    () => {},
  );
  if (r.cancelled) return null;
  if (r.kept_original.length > 0) {
    useTranslateStore.getState().updateSync(nodeId, { warning: r.kept_original.join(" / ") });
  }
  return r.text.trim();
}

function sameItem(a: SyncItem, b: SyncItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Apply one action; false if cancelled or failed (error stored in the sync state). */
async function applyOne(nodeId: string, item: SyncItem, action: SyncAction): Promise<boolean> {
  const store = useTranslateStore.getState();
  try {
    const ctx = syncNotes(nodeId);
    if (!ctx) throw new Error("NOT_LINKED");
    let translation: string | null = null;
    if (action === "write_src" || action === "write_dst") {
      const text = action === "write_dst" ? item.src_text : item.dst_text;
      if (!text) throw new Error("Nothing to translate");
      translation = await translateBlock(nodeId, ctx, text, action === "write_dst" ? "dst" : "src");
      if (translation === null || useTranslateStore.getState().syncByNode[nodeId]?.cancelRequested) return false;
    }

    // The notes may have been edited while translating: re-read and make sure
    // the item still means the same thing.
    const latest = syncNotes(nodeId);
    if (!latest) throw new Error("NOT_LINKED");
    const srcText = latest.src.content ?? "";
    const dstText = latest.dst.content ?? "";
    const now = await cmd.translationSyncPlan(srcText, dstText, latest.sync.pairs);
    const still = now.find((i) => i.key === item.key);
    if (!still || !sameItem(still, item)) throw new Error("STALE");

    const res = await cmd.translationSyncApply(srcText, dstText, latest.sync.pairs, item.key, action, translation);
    const gs = useGraphStore.getState();
    if (res.source_text !== srcText) {
      await gs.updateNodeContent(latest.src.id, { content: res.source_text });
      emitNodeUpdated(latest.src.id);
    }
    if (res.target_text !== dstText) {
      await gs.updateNodeContent(latest.dst.id, { content: res.target_text });
      emitNodeUpdated(latest.dst.id);
    }
    await patchTranslateModel(nodeId, {
      sync: { ...latest.sync, pairs: res.pairs, synced_at: new Date().toISOString() },
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store.updateSync(nodeId, { error: msg.startsWith("STALE") ? "STALE" : msg });
    if (msg.startsWith("NO_MODEL")) void useTranslateStore.getState().refreshModelStatus();
    return false;
  }
}

export async function applySyncItem(nodeId: string, item: SyncItem, action: SyncAction): Promise<void> {
  const store = useTranslateStore.getState();
  if (store.syncByNode[nodeId]?.busyKey) return;
  store.updateSync(nodeId, { ...EMPTY_SYNC_STATE, busyKey: item.key });
  await applyOne(nodeId, item, action);
  useTranslateStore.getState().updateSync(nodeId, { busyKey: null, jobId: null, progress: null });
}

/** The default action for a non-conflict item: carry the change across. */
export function defaultAction(item: SyncItem): SyncAction | null {
  if (item.kind === "deleted") return "delete";
  if (item.kind === "modified" || item.kind === "added") return item.side === "src" ? "write_dst" : "write_src";
  return null;
}

/** Apply every non-conflicting change, one at a time (conflicts stay listed). */
export async function applyAllSync(nodeId: string): Promise<void> {
  const store = useTranslateStore.getState();
  if (store.syncByNode[nodeId]?.busyKey) return;
  store.updateSync(nodeId, { ...EMPTY_SYNC_STATE, busyKey: "all" });
  const ctx0 = syncNotes(nodeId);
  const first = ctx0 ? await cmd.translationSyncPlan(ctx0.src.content ?? "", ctx0.dst.content ?? "", ctx0.sync.pairs) : [];
  const total = first.filter((i) => defaultAction(i)).length;
  for (let done = 0; done < total; done++) {
    if (useTranslateStore.getState().syncByNode[nodeId]?.cancelRequested) break;
    const ctx = syncNotes(nodeId);
    if (!ctx) break;
    const items = await cmd.translationSyncPlan(ctx.src.content ?? "", ctx.dst.content ?? "", ctx.sync.pairs);
    const next = items.find((i) => defaultAction(i));
    if (!next) break;
    useTranslateStore.getState().updateSync(nodeId, { progress: `${done + 1} / ${total}` });
    if (!(await applyOne(nodeId, next, defaultAction(next)!))) break;
  }
  useTranslateStore.getState().updateSync(nodeId, { busyKey: null, jobId: null, progress: null });
}

export async function cancelSync(nodeId: string): Promise<void> {
  const s = useTranslateStore.getState().syncByNode[nodeId];
  useTranslateStore.getState().updateSync(nodeId, { cancelRequested: true });
  if (s?.jobId) await cmd.translateCancel(s.jobId);
}

