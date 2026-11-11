//! Bilingual note pair sync (e.g. a Japanese Note ⇄ its English translation).
//!
//! Both notes are split into top-level Typst *blocks* (paragraphs, headings,
//! lists, figures, code blocks … separated by blank lines — blank lines inside
//! raw blocks or content blocks do not split). The Translate node stores the
//! block pairs as they were at the last sync (`SyncPair { src, dst }`). A sync
//! compares each note with its side of that snapshot (LCS diff on exact block
//! text) and lists what changed on which side:
//!
//! - `modified` / `added` on one side → translate it into the other side
//! - `deleted` on one side → delete the counterpart
//! - `conflict_modified` (both sides edited) / `conflict_deleted` (one side
//!   deleted, the other edited) → the user chooses
//!
//! Every item can also be *ignored* (accept both sides as they are). Nothing is
//! applied automatically: [`apply`] performs one user-chosen action (with the
//! translation produced by the frontend), updates both texts and the snapshot,
//! and returns the new item list. Untouched blocks (incl. hand edits such as
//! figure widths) are never rewritten.

use serde::{Deserialize, Serialize};
use typst::syntax::{parse, LinkedNode, SyntaxKind};

/// One aligned pair of the snapshot. A side is `None` when that block has no
/// counterpart (added on one side and "ignored").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncPair {
    pub src: Option<String>,
    pub dst: Option<String>,
}

// ─── Blocks ───

/// A Typst document as blocks: `lead + Σ (blocks[i] + seps[i])` == the text.
#[derive(Debug, Clone, PartialEq)]
pub struct Doc {
    pub lead: String,
    pub blocks: Vec<String>,
    pub seps: Vec<String>,
}

const BLOCK_SEP: &str = "\n\n";

impl Doc {
    pub fn parse(text: &str) -> Doc {
        let root = parse(text);
        let mut bounds: Vec<(usize, usize)> = Vec::new();
        let mut start: Option<usize> = None;
        let mut end = 0;
        for c in LinkedNode::new(&root).children() {
            match c.kind() {
                SyntaxKind::Parbreak => {
                    if let Some(s) = start.take() {
                        bounds.push((s, end));
                    }
                }
                SyntaxKind::Space => {}
                _ => {
                    if start.is_none() {
                        start = Some(c.range().start);
                    }
                    end = c.range().end;
                }
            }
        }
        if let Some(s) = start {
            bounds.push((s, end));
        }
        let Some(first) = bounds.first() else {
            return Doc { lead: text.to_string(), blocks: vec![], seps: vec![] };
        };
        let lead = text[..first.0].to_string();
        let mut blocks = Vec::with_capacity(bounds.len());
        let mut seps = Vec::with_capacity(bounds.len());
        for (i, &(s, e)) in bounds.iter().enumerate() {
            blocks.push(text[s..e].to_string());
            let next = bounds.get(i + 1).map_or(text.len(), |b| b.0);
            seps.push(text[e..next].to_string());
        }
        Doc { lead, blocks, seps }
    }

    pub fn render(&self) -> String {
        let mut out = self.lead.clone();
        for (b, s) in self.blocks.iter().zip(&self.seps) {
            out.push_str(b);
            out.push_str(s);
        }
        out
    }

    fn set(&mut self, i: usize, text: &str) {
        self.blocks[i] = text.to_string();
    }

    fn insert(&mut self, at: usize, text: &str) {
        let n = self.blocks.len();
        if n == 0 {
            self.blocks.push(text.to_string());
            self.seps.push("\n".into());
        } else if at >= n {
            let trailing = std::mem::replace(&mut self.seps[n - 1], BLOCK_SEP.into());
            self.blocks.push(text.to_string());
            self.seps.push(trailing);
        } else {
            self.blocks.insert(at, text.to_string());
            self.seps.insert(at, BLOCK_SEP.into());
        }
    }

    fn remove(&mut self, i: usize) {
        let n = self.blocks.len();
        self.blocks.remove(i);
        let sep = self.seps.remove(i);
        if i == n - 1 && i > 0 {
            self.seps[i - 1] = sep; // keep the document's trailing whitespace
        }
    }
}

/// Split a Typst text into blocks (exposed for the initial alignment).
pub fn blocks(text: &str) -> Vec<String> {
    Doc::parse(text).blocks
}

// ─── Diff ───

enum Op {
    Eq(usize, usize),
    Del(usize),
    Ins(usize),
}

/// LCS diff of two string sequences.
fn diff(a: &[&str], b: &[&str]) -> Vec<Op> {
    let (n, m) = (a.len(), b.len());
    let mut lcs = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut ops = Vec::new();
    while i < n || j < m {
        if i < n && j < m && a[i] == b[j] {
            ops.push(Op::Eq(i, j));
            i += 1;
            j += 1;
        } else if j < m && (i == n || lcs[i][j + 1] >= lcs[i + 1][j]) {
            ops.push(Op::Ins(j));
            j += 1;
        } else {
            ops.push(Op::Del(i));
            i += 1;
        }
    }
    ops
}

/// Status of one snapshot pair on one side.
#[derive(Debug, Clone, Copy, PartialEq)]
enum St {
    /// The pair has no block on this side.
    Absent,
    Same(usize),
    Modified(usize),
    Deleted,
}

impl St {
    fn pos(self) -> Option<usize> {
        match self {
            St::Same(p) | St::Modified(p) => Some(p),
            _ => None,
        }
    }
}

struct SideView {
    st: Vec<St>,
    /// New blocks: (position in the current doc, last snapshot pair before it).
    added: Vec<(usize, Option<usize>)>,
}

fn analyze(old: &[Option<&str>], cur: &[String]) -> SideView {
    let idx: Vec<usize> = (0..old.len()).filter(|&i| old[i].is_some()).collect();
    let olds: Vec<&str> = idx.iter().map(|&i| old[i].unwrap()).collect();
    let curs: Vec<&str> = cur.iter().map(String::as_str).collect();
    let mut st: Vec<St> = old.iter().map(|o| if o.is_some() { St::Deleted } else { St::Absent }).collect();
    let mut added = Vec::new();

    let mut anchor: Option<usize> = None;
    let mut dels: Vec<usize> = Vec::new();
    let mut ins: Vec<usize> = Vec::new();
    let mut flush = |dels: &mut Vec<usize>, ins: &mut Vec<usize>, anchor: &mut Option<usize>, st: &mut Vec<St>| {
        // Within a hunk, deletions and insertions pair up as modifications;
        // the rest are deletions or additions (placed after the modified ones).
        let k = dels.len().min(ins.len());
        for t in 0..k {
            st[idx[dels[t]]] = St::Modified(ins[t]);
        }
        let a = if k > 0 { Some(idx[dels[k - 1]]) } else { *anchor };
        for &p in &ins[k..] {
            added.push((p, a));
        }
        if let Some(&last) = dels.last() {
            *anchor = Some(idx[last]);
        }
        dels.clear();
        ins.clear();
    };
    for op in diff(&olds, &curs) {
        match op {
            Op::Eq(o, c) => {
                flush(&mut dels, &mut ins, &mut anchor, &mut st);
                st[idx[o]] = St::Same(c);
                anchor = Some(idx[o]);
            }
            Op::Del(o) => dels.push(o),
            Op::Ins(c) => ins.push(c),
        }
    }
    flush(&mut dels, &mut ins, &mut anchor, &mut st);
    SideView { st, added }
}

// ─── Items ───

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Src,
    Dst,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Modified,
    Added,
    Deleted,
    ConflictModified,
    ConflictDeleted,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SyncItem {
    /// Stable within one (texts, snapshot) state; passed back to [`apply`].
    pub key: String,
    pub kind: ItemKind,
    /// The side that changed (`added`/`modified`), was deleted (`deleted`), or
    /// was edited (`conflict_deleted`). Src for `conflict_modified`.
    pub side: Side,
    /// Current blocks (None if not present on that side).
    pub src_text: Option<String>,
    pub dst_text: Option<String>,
    /// Snapshot blocks (what was synced last time).
    pub old_src: Option<String>,
    pub old_dst: Option<String>,
}

struct State {
    src: Doc,
    dst: Doc,
    pairs: Vec<SyncPair>,
    sv: SideView,
    dv: SideView,
}

impl State {
    fn new(src_text: &str, dst_text: &str, pairs: Vec<SyncPair>) -> State {
        let src = Doc::parse(src_text);
        let dst = Doc::parse(dst_text);
        let so: Vec<Option<&str>> = pairs.iter().map(|p| p.src.as_deref()).collect();
        let dso: Vec<Option<&str>> = pairs.iter().map(|p| p.dst.as_deref()).collect();
        let sv = analyze(&so, &src.blocks);
        let dv = analyze(&dso, &dst.blocks);
        State { src, dst, pairs, sv, dv }
    }

    fn cur(&self, side: Side, st: St) -> Option<String> {
        let doc = if side == Side::Src { &self.src } else { &self.dst };
        st.pos().map(|p| doc.blocks[p].clone())
    }

    fn items(&self) -> Vec<SyncItem> {
        use St::*;
        let mut out = Vec::new();
        for (i, pair) in self.pairs.iter().enumerate() {
            let (s, d) = (self.sv.st[i], self.dv.st[i]);
            let found = match (s, d) {
                (Modified(_), Same(_)) => Some((ItemKind::Modified, Side::Src)),
                (Same(_), Modified(_)) => Some((ItemKind::Modified, Side::Dst)),
                (Modified(_), Modified(_)) => Some((ItemKind::ConflictModified, Side::Src)),
                (Deleted, Same(_)) => Some((ItemKind::Deleted, Side::Src)),
                (Same(_), Deleted) => Some((ItemKind::Deleted, Side::Dst)),
                (Deleted, Modified(_)) => Some((ItemKind::ConflictDeleted, Side::Dst)),
                (Modified(_), Deleted) => Some((ItemKind::ConflictDeleted, Side::Src)),
                _ => None,
            };
            if let Some((kind, side)) = found {
                out.push(SyncItem {
                    key: format!("p{i}"),
                    kind,
                    side,
                    src_text: self.cur(Side::Src, s),
                    dst_text: self.cur(Side::Dst, d),
                    old_src: pair.src.clone(),
                    old_dst: pair.dst.clone(),
                });
            }
        }
        for (side, view, doc) in [(Side::Src, &self.sv, &self.src), (Side::Dst, &self.dv, &self.dst)] {
            for &(pos, _) in &view.added {
                let text = Some(doc.blocks[pos].clone());
                out.push(SyncItem {
                    key: format!("{}{pos}", if side == Side::Src { "s" } else { "d" }),
                    kind: ItemKind::Added,
                    side,
                    src_text: if side == Side::Src { text.clone() } else { None },
                    dst_text: if side == Side::Dst { text } else { None },
                    old_src: None,
                    old_dst: None,
                });
            }
        }
        out
    }

    /// Position in `side`'s doc right after the blocks of pairs `< before`.
    fn insert_pos(&self, side: Side, before: usize) -> usize {
        let view = if side == Side::Src { &self.sv } else { &self.dv };
        (0..before.min(view.st.len())).rev().find_map(|j| view.st[j].pos()).map_or(0, |p| p + 1)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncAction {
    /// Write `translation` into the src note.
    WriteSrc,
    /// Write `translation` into the dst note.
    WriteDst,
    /// Delete the remaining counterpart (`deleted` / `conflict_deleted`).
    Delete,
    /// Accept both sides as they are.
    Ignore,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncState {
    pub source_text: String,
    pub target_text: String,
    pub pairs: Vec<SyncPair>,
    pub items: Vec<SyncItem>,
}

pub fn plan(src_text: &str, dst_text: &str, pairs: Vec<SyncPair>) -> Vec<SyncItem> {
    State::new(src_text, dst_text, pairs).items()
}

pub fn apply(
    src_text: &str,
    dst_text: &str,
    pairs: Vec<SyncPair>,
    key: &str,
    action: SyncAction,
    translation: Option<&str>,
) -> Result<SyncState, String> {
    let mut s = State::new(src_text, dst_text, pairs);
    let item = s
        .items()
        .into_iter()
        .find(|it| it.key == key)
        .ok_or_else(|| "STALE: the notes changed; review the changes again.".to_string())?;
    let tr = || {
        translation
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| "Missing translation".to_string())
    };
    // Pairs whose block is gone on both sides are dropped afterwards.
    let mut dead: Vec<bool> = (0..s.pairs.len())
        .map(|i| s.sv.st[i].pos().is_none() && s.dv.st[i].pos().is_none())
        .collect();

    if item.kind == ItemKind::Added {
        let pos: usize = item.key[1..].parse().map_err(|_| "bad key")?;
        let view = if item.side == Side::Src { &s.sv } else { &s.dv };
        let anchor = view.added.iter().find(|a| a.0 == pos).map(|a| a.1).ok_or("bad key")?;
        let at_pair = anchor.map_or(0, |a| a + 1);
        let text = if item.side == Side::Src { item.src_text.clone() } else { item.dst_text.clone() };
        let new_pair = match (action, item.side) {
            (SyncAction::WriteDst, Side::Src) => {
                let t = tr()?;
                let at = s.insert_pos(Side::Dst, at_pair);
                s.dst.insert(at, t);
                SyncPair { src: text, dst: Some(t.to_string()) }
            }
            (SyncAction::WriteSrc, Side::Dst) => {
                let t = tr()?;
                let at = s.insert_pos(Side::Src, at_pair);
                s.src.insert(at, t);
                SyncPair { src: Some(t.to_string()), dst: text }
            }
            (SyncAction::Ignore, Side::Src) => SyncPair { src: text, dst: None },
            (SyncAction::Ignore, Side::Dst) => SyncPair { src: None, dst: text },
            _ => return Err("This action does not apply to an added paragraph".into()),
        };
        s.pairs.insert(at_pair, new_pair);
        dead.insert(at_pair, false);
    } else {
        let i: usize = item.key[1..].parse().map_err(|_| "bad key")?;
        let (sp, dp) = (s.sv.st[i].pos(), s.dv.st[i].pos());
        match action {
            SyncAction::WriteDst => {
                let t = tr()?;
                match dp {
                    Some(p) => s.dst.set(p, t),
                    None => {
                        let at = s.insert_pos(Side::Dst, i);
                        s.dst.insert(at, t);
                    }
                }
                s.pairs[i] = SyncPair { src: item.src_text.clone(), dst: Some(t.to_string()) };
            }
            SyncAction::WriteSrc => {
                let t = tr()?;
                match sp {
                    Some(p) => s.src.set(p, t),
                    None => {
                        let at = s.insert_pos(Side::Src, i);
                        s.src.insert(at, t);
                    }
                }
                s.pairs[i] = SyncPair { src: Some(t.to_string()), dst: item.dst_text.clone() };
            }
            SyncAction::Delete => {
                match (sp, dp) {
                    (Some(p), None) => s.src.remove(p),
                    (None, Some(p)) => s.dst.remove(p),
                    _ => return Err("Nothing to delete".into()),
                }
                dead[i] = true;
            }
            SyncAction::Ignore => {
                s.pairs[i] = SyncPair { src: item.src_text.clone(), dst: item.dst_text.clone() };
                dead[i] = sp.is_none() && dp.is_none();
            }
        }
    }

    let pairs: Vec<SyncPair> = s
        .pairs
        .into_iter()
        .zip(dead)
        .filter(|(p, d)| !*d && (p.src.is_some() || p.dst.is_some()))
        .map(|(p, _)| p)
        .collect();
    let (source_text, target_text) = (s.src.render(), s.dst.render());
    let items = plan(&source_text, &target_text, pairs.clone());
    Ok(SyncState { source_text, target_text, pairs, items })
}

/// Pair two existing notes block by block (used to start syncing notes that
/// were not produced by this Translate node's last run).
pub fn align_by_position(src_text: &str, dst_text: &str) -> Vec<SyncPair> {
    let (a, b) = (blocks(src_text), blocks(dst_text));
    (0..a.len().max(b.len()))
        .map(|i| SyncPair { src: a.get(i).cloned(), dst: b.get(i).cloned() })
        .collect()
}

// ─── Commands ───

#[tauri::command]
pub fn translation_sync_plan(source_text: String, target_text: String, pairs: Vec<SyncPair>) -> Vec<SyncItem> {
    plan(&source_text, &target_text, pairs)
}

#[tauri::command]
pub fn translation_sync_apply(
    source_text: String,
    target_text: String,
    pairs: Vec<SyncPair>,
    key: String,
    action: SyncAction,
    translation: Option<String>,
) -> Result<SyncState, String> {
    apply(&source_text, &target_text, pairs, &key, action, translation.as_deref())
}

#[tauri::command]
pub fn translation_sync_align(source_text: String, target_text: String) -> Vec<SyncPair> {
    align_by_position(&source_text, &target_text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const JA: &str = "= はじめに\n\n本研究では手法を提案する。\n\n```py\nx = 1\n\ny = 2\n```\n\n{{@image_1}}\n\n#let a = [一\n\n二]\n\n結論。\n";
    const EN: &str = "= Introduction\n\nIn this study, we propose a method.\n\n```py\nx = 1\n\ny = 2\n```\n\n#figure(image(\"@image_1\", width: 80%), caption: [Setup]) <fig:image_1>\n\n#let a = [One\n\nTwo]\n\nConclusion.\n";

    fn synced() -> Vec<SyncPair> {
        align_by_position(JA, EN)
    }

    fn kinds(items: &[SyncItem]) -> Vec<(ItemKind, Side, String)> {
        items.iter().map(|i| (i.kind, i.side, i.key.clone())).collect()
    }

    #[test]
    fn blocks_split_at_top_level_blank_lines_only() {
        let d = Doc::parse(JA);
        assert_eq!(d.blocks.len(), 6);
        assert_eq!(d.blocks[2], "```py\nx = 1\n\ny = 2\n```");
        assert_eq!(d.blocks[4], "#let a = [一\n\n二]");
        assert_eq!(d.render(), JA);
        let lead = Doc::parse("\n\n  本文\n\n\n");
        assert_eq!((lead.lead.as_str(), lead.blocks.len()), ("\n\n  ", 1));
        assert_eq!(lead.render(), "\n\n  本文\n\n\n");
    }

    #[test]
    fn unchanged_notes_have_no_items() {
        assert!(plan(JA, EN, synced()).is_empty());
    }

    #[test]
    fn modification_is_translated_into_the_other_side_only() {
        let ja = JA.replace("手法を提案する。", "新しい手法を提案する。");
        let en = EN.replace("width: 80%", "width: 40%"); // hand edit on the EN side
        let items = plan(&ja, &en, synced());
        assert_eq!(
            kinds(&items),
            vec![(ItemKind::Modified, Side::Src, "p1".into()), (ItemKind::Modified, Side::Dst, "p3".into())]
        );
        let r = apply(&ja, &en, synced(), "p1", SyncAction::WriteDst, Some("We propose a new method.")).unwrap();
        assert!(r.target_text.contains("We propose a new method.\n\n```py"));
        assert!(r.target_text.contains("width: 40%"), "hand edit kept");
        assert_eq!(r.source_text, ja);
        assert_eq!(kinds(&r.items), vec![(ItemKind::Modified, Side::Dst, "p3".into())]);
        // Ignoring the layout-only edit marks it as synced.
        let r = apply(&r.source_text, &r.target_text, r.pairs, "p3", SyncAction::Ignore, None).unwrap();
        assert!(r.items.is_empty());
    }

    #[test]
    fn added_paragraph_is_inserted_at_the_matching_place() {
        let ja = JA.replace("本研究では手法を提案する。\n\n", "本研究では手法を提案する。\n\n背景を述べる。\n\n");
        let items = plan(&ja, EN, synced());
        assert_eq!(kinds(&items), vec![(ItemKind::Added, Side::Src, "s2".into())]);
        let r = apply(&ja, EN, synced(), "s2", SyncAction::WriteDst, Some("We describe the background.")).unwrap();
        assert!(r.target_text.contains("a method.\n\nWe describe the background.\n\n```py"));
        assert!(r.items.is_empty());
        assert_eq!(r.pairs.len(), 7);
        // Added at the very end (after the trailing newline handling).
        let en = format!("{EN}\nAppendix.\n");
        let r = apply(JA, &en, synced(), "d6", SyncAction::WriteSrc, Some("付録。")).unwrap();
        assert!(r.source_text.ends_with("結論。\n\n付録。\n"), "{:?}", r.source_text);
        assert!(r.items.is_empty());
    }

    #[test]
    fn deletion_and_conflicts() {
        // Deleted in JA → delete in EN.
        let ja = JA.replace("結論。\n", "");
        let items = plan(&ja, EN, synced());
        assert_eq!(kinds(&items), vec![(ItemKind::Deleted, Side::Src, "p5".into())]);
        let r = apply(&ja, EN, synced(), "p5", SyncAction::Delete, None).unwrap();
        assert!(r.target_text.ends_with("Two]\n"), "{:?}", r.target_text);
        assert!(r.items.is_empty());
        assert_eq!(r.pairs.len(), 5);

        // Both edited → conflict; choose the EN version.
        let ja = JA.replace("結論。", "結論である。");
        let en = EN.replace("Conclusion.", "In conclusion.");
        let items = plan(&ja, &en, synced());
        assert_eq!(kinds(&items), vec![(ItemKind::ConflictModified, Side::Src, "p5".into())]);
        let r = apply(&ja, &en, synced(), "p5", SyncAction::WriteSrc, Some("結論として。")).unwrap();
        assert!(r.source_text.ends_with("結論として。\n") && r.items.is_empty());

        // Deleted in JA, edited in EN → conflict; restore into JA.
        let ja = JA.replace("結論。\n", "");
        let items = plan(&ja, &en, synced());
        assert_eq!(kinds(&items), vec![(ItemKind::ConflictDeleted, Side::Dst, "p5".into())]);
        let r = apply(&ja, &en, synced(), "p5", SyncAction::WriteSrc, Some("結論として。")).unwrap();
        assert!(r.source_text.contains("二]\n\n結論として。"), "{:?}", r.source_text);
        assert!(r.items.is_empty());
    }

    #[test]
    fn ignored_addition_stays_one_sided() {
        let en = EN.replace("Conclusion.", "Conclusion.\n\nEnglish-only note.");
        let r = apply(JA, &en, synced(), "d6", SyncAction::Ignore, None).unwrap();
        assert!(r.items.is_empty());
        assert_eq!(r.pairs.last().unwrap(), &SyncPair { src: None, dst: Some("English-only note.".into()) });
        // Later edits of a one-sided block raise nothing.
        let en2 = en.replace("English-only note.", "English-only remark.");
        assert!(plan(JA, &en2, r.pairs.clone()).is_empty());
    }

    #[test]
    fn stale_key_is_rejected() {
        assert!(apply(JA, EN, synced(), "p0", SyncAction::Ignore, None).unwrap_err().starts_with("STALE"));
    }
}
