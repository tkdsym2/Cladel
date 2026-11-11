//! Structure-aware translation plan for Typst source (Note nodes).
//!
//! The source is parsed with Typst's own parser and split into
//! - **units** to translate: prose paragraphs, heading bodies, list/enum/term
//!   item bodies, and markup inside content blocks of code (e.g. a figure's
//!   `caption: [...]`, `#let x = [...]`);
//! - everything else **kept verbatim**: code (`#set`, `#let`, `#import`,
//!   `#show`, function calls), display equations, raw blocks, comments, labels,
//!   and paragraphs that consist only of references such as `{{@image_1}}`.
//!
//! Inside a unit, inline items that must survive translation unchanged are
//! recorded as *protected* ranges (inline math, raw, `@ref`, `<label>`, links,
//! comments, escapes, `#code`, and Filonex refs `{@…}` / `{{@…}}`). After
//! translation [`check_output`] verifies they are all still present; if not,
//! the unit is retried with protected items masked as `⟦n⟧` ([`mask`] /
//! [`unmask`]), and as a last resort kept untranslated.
//!
//! `#set text(lang: "..")` is rewritten to the target language.

use std::ops::Range;

use regex::Regex;
use typst::syntax::{parse, LinkedNode, SyntaxKind};

use super::pfml::is_cjk_no_space;

/// Units longer than this are split at sentence ends (outside markup).
pub const MAX_UNIT_CHARS: usize = 1500;

#[derive(Debug, Clone, PartialEq)]
pub struct Unit {
    pub text: String,
    /// Byte ranges (within `text`) that must appear unchanged in the output.
    pub protected: Vec<Range<usize>>,
    /// Byte ranges of `*` / `_` delimiters of strong/emph (masked in fallback mode).
    pub delimiters: Vec<Range<usize>>,
    /// Second or later piece of one long paragraph: the gap before it becomes
    /// a sentence separator suited to the target language.
    pub continues_previous: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Piece {
    Keep(String),
    Translate(Unit),
}

/// Typst `lang` value for a PLaMo language code.
pub fn typst_lang(code: &str) -> &str {
    match code {
        "zh-hans" | "zh-hant" => "zh",
        other => other,
    }
}

fn filonex_ref_re() -> &'static Regex {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{@[^{}\n]+\}\}|\{@[^{}\n]+\}").unwrap())
}

// ─── Planning ───

/// Build the translation plan. Concatenating the pieces with every unit left
/// as-is reproduces `src` (except for the `lang` rewrite).
pub fn plan_typst(src: &str, target_lang: &str) -> Vec<Piece> {
    let root = parse(src);
    let linked = LinkedNode::new(&root);

    let mut units: Vec<(Range<usize>, Unit)> = Vec::new();
    segment_markup(&linked, src, target_lang, &mut units);

    let mut edits: Vec<(Range<usize>, Option<Unit>, String)> = units
        .into_iter()
        .map(|(r, u)| (r, Some(u), String::new()))
        .collect();
    let unit_ranges: Vec<Range<usize>> = edits.iter().map(|e| e.0.clone()).collect();
    for r in lang_rewrites(&linked) {
        if !unit_ranges.iter().any(|u| u.start <= r.start && r.end <= u.end) {
            edits.push((r, None, format!("\"{}\"", typst_lang(target_lang))));
        }
    }
    edits.sort_by_key(|e| e.0.start);

    let mut pieces = Vec::new();
    let mut cursor = 0;
    for (range, unit, replacement) in edits {
        if range.start < cursor {
            continue; // overlapping (should not happen)
        }
        let gap = &src[cursor..range.start];
        if unit.as_ref().map_or(false, |u| u.continues_previous) {
            pieces.push(Piece::Keep(sentence_sep(gap, target_lang)));
        } else if !gap.is_empty() {
            pieces.push(Piece::Keep(gap.to_string()));
        }
        match unit {
            Some(u) => pieces.push(Piece::Translate(u)),
            None => pieces.push(Piece::Keep(replacement)),
        }
        cursor = range.end;
    }
    if cursor < src.len() {
        pieces.push(Piece::Keep(src[cursor..].to_string()));
    }
    merge_keeps(pieces)
}

fn merge_keeps(pieces: Vec<Piece>) -> Vec<Piece> {
    let mut out: Vec<Piece> = Vec::with_capacity(pieces.len());
    for p in pieces {
        match (out.last_mut(), p) {
            (Some(Piece::Keep(a)), Piece::Keep(b)) => a.push_str(&b),
            (_, p) => out.push(p),
        }
    }
    out
}

fn is_block_item(kind: SyntaxKind) -> bool {
    matches!(kind, SyntaxKind::Heading | SyntaxKind::ListItem | SyntaxKind::EnumItem | SyntaxKind::TermItem)
}

/// Split a Markup node's children into runs separated by paragraph breaks and
/// block items; recurse into block item bodies.
fn segment_markup(markup: &LinkedNode, src: &str, target: &str, out: &mut Vec<(Range<usize>, Unit)>) {
    let children: Vec<LinkedNode> = markup.children().collect();
    let mut run: Vec<LinkedNode> = Vec::new();
    for child in children {
        let kind = child.kind();
        if kind == SyntaxKind::Parbreak || is_block_item(kind) {
            flush_run(&mut run, src, target, out);
            if is_block_item(kind) {
                for inner in child.children().filter(|c| c.kind() == SyntaxKind::Markup) {
                    segment_markup(&inner, src, target, out);
                }
            }
        } else {
            run.push(child);
        }
    }
    flush_run(&mut run, src, target, out);
}

fn has_letters(s: &str) -> bool {
    s.chars().any(char::is_alphabetic)
}

/// A run is prose if it has text (or emphasized text) of its own; a run of
/// only code / refs / math is kept, but markup inside its content blocks is
/// still translated.
fn is_prose(run: &[LinkedNode]) -> bool {
    run.iter().any(|n| match n.kind() {
        SyntaxKind::Text => {
            // Filonex refs are split into "{", Ref, "}" — braces are not prose.
            let t = n.text();
            has_letters(&filonex_ref_re().replace_all(t, ""))
        }
        SyntaxKind::Strong | SyntaxKind::Emph => has_letters(&n.get().clone().into_text()),
        _ => false,
    })
}

fn flush_run(run: &mut Vec<LinkedNode>, src: &str, target: &str, out: &mut Vec<(Range<usize>, Unit)>) {
    let nodes = std::mem::take(run);
    // Trim surrounding whitespace.
    let first = nodes.iter().position(|n| n.kind() != SyntaxKind::Space);
    let last = nodes.iter().rposition(|n| n.kind() != SyntaxKind::Space);
    let (Some(first), Some(last)) = (first, last) else { return };
    let nodes = &nodes[first..=last];

    if !is_prose(nodes) {
        for n in nodes {
            translate_code_content(n, src, target, out);
        }
        return;
    }

    let start = nodes[0].range().start;
    let end = nodes[nodes.len() - 1].range().end;
    let text = &src[start..end];

    let mut protected = Vec::new();
    let mut delimiters = Vec::new();
    collect_inline(nodes, &mut protected, &mut delimiters);
    for m in filonex_ref_re().find_iter(text) {
        protected.push(start + m.start()..start + m.end());
    }

    // Candidate split points: after sentence ends inside direct Text nodes.
    let mut splits = Vec::new();
    if text.chars().count() > MAX_UNIT_CHARS {
        for n in nodes.iter().filter(|n| n.kind() == SyntaxKind::Text) {
            let base = n.range().start;
            for (i, c) in n.text().char_indices() {
                let after = base + i + c.len_utf8();
                let next = src[after..].chars().next();
                let end_mark = matches!(c, '。' | '！' | '？' | '．')
                    || (matches!(c, '.' | '!' | '?') && next.map_or(true, char::is_whitespace));
                if end_mark && after < end {
                    splits.push(after);
                }
            }
        }
    }

    for (i, piece) in pack(start, end, &splits, src).into_iter().enumerate() {
        let mut unit = make_unit(src, piece.clone(), &protected, &delimiters);
        unit.continues_previous = i > 0;
        out.push((piece, unit));
    }
    let _ = target;
}

/// Greedy-pack [start, end) into pieces ≤ MAX_UNIT_CHARS at the given split
/// points; leading whitespace of each piece is left outside (kept verbatim).
fn pack(start: usize, end: usize, splits: &[usize], src: &str) -> Vec<Range<usize>> {
    if splits.is_empty() {
        return vec![start..end];
    }
    let mut pieces = Vec::new();
    let mut piece_start = start;
    let mut last_ok: Option<usize> = None;
    for &s in splits {
        if src[piece_start..s].chars().count() > MAX_UNIT_CHARS {
            if let Some(cut) = last_ok.take() {
                pieces.push(piece_start..cut);
                piece_start = skip_ws(src, cut, end);
            }
        }
        if s > piece_start {
            last_ok = Some(s);
        }
    }
    if src[piece_start..end].chars().count() > MAX_UNIT_CHARS {
        if let Some(cut) = last_ok.filter(|&c| c > piece_start) {
            pieces.push(piece_start..cut);
            piece_start = skip_ws(src, cut, end);
        }
    }
    if piece_start < end {
        pieces.push(piece_start..end);
    }
    pieces
}

fn skip_ws(src: &str, mut i: usize, end: usize) -> usize {
    while i < end {
        let c = src[i..].chars().next().unwrap();
        if !c.is_whitespace() {
            break;
        }
        i += c.len_utf8();
    }
    i
}

fn make_unit(src: &str, r: Range<usize>, protected: &[Range<usize>], delimiters: &[Range<usize>]) -> Unit {
    let rel = |v: &[Range<usize>]| -> Vec<Range<usize>> {
        let mut out: Vec<Range<usize>> = v
            .iter()
            .filter(|p| r.start <= p.start && p.end <= r.end)
            .map(|p| p.start - r.start..p.end - r.start)
            .collect();
        out.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
        // Drop ranges nested in an earlier one (e.g. `@x` inside `{@x}`).
        let mut merged: Vec<Range<usize>> = Vec::new();
        for p in out {
            if merged.last().map_or(true, |l| p.start >= l.end) {
                merged.push(p);
            }
        }
        merged
    };
    Unit {
        text: src[r.clone()].to_string(),
        protected: rel(protected),
        delimiters: rel(delimiters),
        continues_previous: false,
    }
}

/// Protected inline items and strong/emph delimiters among `nodes` (absolute ranges).
fn collect_inline(nodes: &[LinkedNode], protected: &mut Vec<Range<usize>>, delims: &mut Vec<Range<usize>>) {
    let mut i = 0;
    while i < nodes.len() {
        let n = &nodes[i];
        match n.kind() {
            SyntaxKind::Equation
            | SyntaxKind::Raw
            | SyntaxKind::Ref
            | SyntaxKind::Label
            | SyntaxKind::Link
            | SyntaxKind::LineComment
            | SyntaxKind::BlockComment
            | SyntaxKind::Escape => protected.push(n.range()),
            SyntaxKind::Strong | SyntaxKind::Emph => {
                let kids: Vec<LinkedNode> = n.children().collect();
                if kids.len() >= 2 {
                    delims.push(kids[0].range());
                    delims.push(kids[kids.len() - 1].range());
                }
                for k in kids.iter().filter(|k| k.kind() == SyntaxKind::Markup) {
                    let inner: Vec<LinkedNode> = k.children().collect();
                    collect_inline(&inner, protected, delims);
                }
            }
            SyntaxKind::Hash => {
                if let Some(expr) = nodes.get(i + 1) {
                    let blocks = content_blocks(expr);
                    match blocks.first() {
                        // `#emph[..]`, `#text(fill: red)[..]`: protect the head, translate the content.
                        Some(cb) => {
                            protected.push(n.range().start..cb.range().start);
                            for cb in &blocks {
                                for m in cb.children().filter(|c| c.kind() == SyntaxKind::Markup) {
                                    let inner: Vec<LinkedNode> = m.children().collect();
                                    collect_inline(&inner, protected, delims);
                                }
                            }
                        }
                        // `#name`, `#h(1em)`, `#image("x")`: protect whole.
                        None => protected.push(n.range().start..expr.range().end),
                    }
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
}

/// Content blocks under a code expression (not descending into them).
fn content_blocks<'a>(node: &LinkedNode<'a>) -> Vec<LinkedNode<'a>> {
    let mut out = Vec::new();
    fn walk<'a>(n: &LinkedNode<'a>, out: &mut Vec<LinkedNode<'a>>) {
        for c in n.children() {
            if c.kind() == SyntaxKind::ContentBlock {
                out.push(c);
            } else {
                walk(&c, out);
            }
        }
    }
    walk(node, &mut out);
    out
}

/// In a non-prose run: translate markup inside content blocks of code
/// (figure captions, `#let x = [..]`, `#emph[..]` on its own line, …), but
/// not inside set/show rules or imports (templates and configuration).
fn translate_code_content(n: &LinkedNode, src: &str, target: &str, out: &mut Vec<(Range<usize>, Unit)>) {
    if matches!(
        n.kind(),
        SyntaxKind::SetRule | SyntaxKind::ShowRule | SyntaxKind::ModuleImport | SyntaxKind::ModuleInclude
    ) {
        return;
    }
    for cb in content_blocks(n) {
        for m in cb.children().filter(|c| c.kind() == SyntaxKind::Markup) {
            segment_markup(&m, src, target, out);
        }
    }
}

/// Ranges of the string value in `#set text(.., lang: "..")`.
fn lang_rewrites(root: &LinkedNode) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    fn walk(n: &LinkedNode, out: &mut Vec<Range<usize>>) {
        if n.kind() == SyntaxKind::SetRule {
            let target_is_text = n.children().any(|c| c.kind() == SyntaxKind::Ident && c.text() == "text");
            if target_is_text {
                for args in n.children().filter(|c| c.kind() == SyntaxKind::Args) {
                    for named in args.children().filter(|c| c.kind() == SyntaxKind::Named) {
                        let kids: Vec<LinkedNode> = named.children().collect();
                        let is_lang = kids.first().map_or(false, |k| k.kind() == SyntaxKind::Ident && k.text() == "lang");
                        if is_lang {
                            if let Some(s) = kids.iter().find(|k| k.kind() == SyntaxKind::Str) {
                                out.push(s.range());
                            }
                        }
                    }
                }
            }
            return;
        }
        for c in n.children() {
            walk(&c, out);
        }
    }
    walk(root, &mut out);
    out
}

// ─── Verification / masking ───

fn count(hay: &str, needle: &str) -> usize {
    if needle.is_empty() {
        0
    } else {
        hay.matches(needle).count()
    }
}

fn count_kinds(src: &str) -> (usize, usize) {
    fn walk(n: &LinkedNode, acc: &mut (usize, usize)) {
        match n.kind() {
            SyntaxKind::Strong => acc.0 += 1,
            SyntaxKind::Emph => acc.1 += 1,
            _ => {}
        }
        for c in n.children() {
            walk(&c, acc);
        }
    }
    let root = parse(src);
    let mut acc = (0, 0);
    walk(&LinkedNode::new(&root), &mut acc);
    acc
}

/// Verify a translated unit: every protected item still present (as often as
/// in the source), same number of strong/emph spans, and no new syntax errors.
pub fn check_output(unit: &Unit, output: &str) -> Result<(), String> {
    for r in &unit.protected {
        let token = &unit.text[r.clone()];
        let need = count(&unit.text, token);
        if count(output, token) < need {
            return Err(format!("lost `{token}`"));
        }
    }
    if count_kinds(&unit.text) != count_kinds(output) {
        return Err("strong/emph markup changed".into());
    }
    if parse(output).erroneous() && !parse(&unit.text).erroneous() {
        return Err("output is not valid Typst".into());
    }
    Ok(())
}

/// A `// comment` hides the rest of its line, so text the model placed after
/// it on the same line would silently disappear. Move such text to the next
/// line.
pub fn repair_line_comments(unit: &Unit, output: &str) -> String {
    let mut out = output.to_string();
    for r in &unit.protected {
        let token = &unit.text[r.clone()];
        if !token.starts_with("//") {
            continue;
        }
        let mut from = 0;
        while let Some(pos) = out[from..].find(token) {
            let end = from + pos + token.len();
            match out[end..].chars().next() {
                Some('\n') | None => {}
                Some(_) => {
                    let rest = out[end..].trim_start_matches([' ', '\t']).to_string();
                    out.truncate(end);
                    out.push('\n');
                    out.push_str(&rest);
                }
            }
            from = end;
        }
    }
    out
}

/// Replace protected items and emphasis delimiters with `⟦n⟧`.
pub fn mask(unit: &Unit) -> (String, Vec<String>) {
    let mut spans: Vec<Range<usize>> = unit.protected.iter().chain(unit.delimiters.iter()).cloned().collect();
    spans.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
    let mut out = String::new();
    let mut tokens = Vec::new();
    let mut cursor = 0;
    for s in spans {
        if s.start < cursor {
            continue;
        }
        out.push_str(&unit.text[cursor..s.start]);
        tokens.push(unit.text[s.clone()].to_string());
        out.push_str(&format!("⟦{}⟧", tokens.len()));
        cursor = s.end;
    }
    out.push_str(&unit.text[cursor..]);
    (out, tokens)
}

/// Restore `⟦n⟧` placeholders; each must appear exactly once.
pub fn unmask(output: &str, tokens: &[String]) -> Result<String, String> {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"⟦\s*(\d+)\s*⟧").unwrap());
    let mut seen = vec![0usize; tokens.len()];
    for c in re.captures_iter(output) {
        let i: usize = c[1].parse().map_err(|_| "bad placeholder")?;
        if i == 0 || i > tokens.len() {
            return Err(format!("unknown placeholder ⟦{i}⟧"));
        }
        seen[i - 1] += 1;
    }
    if let Some(i) = seen.iter().position(|&n| n != 1) {
        return Err(format!("placeholder ⟦{}⟧ appears {} times", i + 1, seen[i]));
    }
    Ok(re
        .replace_all(output, |c: &regex::Captures| tokens[c[1].parse::<usize>().unwrap() - 1].clone())
        .into_owned())
}

// ─── Figures ───

/// Width given to figures created from `{{@image_N}}`; the author adjusts it
/// (and `placement`, the label, the caption) in the translated note.
pub const DEFAULT_FIGURE_WIDTH: &str = "80%";

/// Rewrite every line that holds only image references (`{{@image_1}}`, maybe
/// several) into explicit, adjustable Typst figures:
///
/// ```typst
/// #figure(image("@image_1", width: 80%), caption: [Image node title]) <fig:image_1>
/// ```
///
/// The caption sits in a content block, so the translation plan translates it
/// like any other caption. `figures` maps an Image node's display_id to its
/// caption (the node's title); other ids, and references inside raw blocks,
/// comments or code, are left untouched. The Render node resolves
/// `image("@image_1")` to the image file.
pub fn expand_figure_refs(src: &str, figures: &std::collections::HashMap<String, String>) -> String {
    use std::collections::HashSet;
    use std::sync::OnceLock;
    static LINE: OnceLock<Regex> = OnceLock::new();
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    let line_re = LINE.get_or_init(|| {
        Regex::new(r"(?m)^([ \t]*)((?:\{\{@[A-Za-z0-9_\-:.]+\}\}[ \t]*)+)$").unwrap()
    });
    let token_re = TOKEN.get_or_init(|| Regex::new(r"\{\{@([A-Za-z0-9_\-:.]+)\}\}").unwrap());
    if figures.is_empty() || !src.contains("{{@") {
        return src.to_string();
    }

    // Start offsets of real markup references (not inside raw/comments/code).
    fn walk(n: &LinkedNode, src: &str, out: &mut HashSet<usize>) {
        if n.kind() == SyntaxKind::Ref {
            out.insert(n.range().start);
            return;
        }
        for c in n.children() {
            walk(&c, src, out);
        }
    }
    let root = parse(src);
    let mut refs = HashSet::new();
    walk(&LinkedNode::new(&root), src, &mut refs);

    let mut out = String::with_capacity(src.len() + 128);
    let mut cursor = 0;
    for caps in line_re.captures_iter(src) {
        let indent = caps.get(1).unwrap().as_str();
        let body = caps.get(2).unwrap();
        let mut lines = Vec::new();
        let mut converted = false;
        for t in token_re.captures_iter(body.as_str()) {
            let token = t.get(0).unwrap();
            let id = &t[1];
            let ref_at = body.start() + token.start() + 2;
            match figures.get(id) {
                Some(caption) if refs.contains(&ref_at) => {
                    converted = true;
                    lines.push(figure_source(id, caption));
                }
                _ => lines.push(token.as_str().to_string()),
            }
        }
        if !converted {
            continue;
        }
        let whole = caps.get(0).unwrap();
        out.push_str(&src[cursor..whole.start()]);
        let joined: Vec<String> = lines.iter().map(|l| format!("{indent}{l}")).collect();
        out.push_str(&joined.join("\n"));
        cursor = whole.end();
    }
    out.push_str(&src[cursor..]);
    out
}

fn figure_source(id: &str, caption: &str) -> String {
    let caption = caption.split_whitespace().collect::<Vec<_>>().join(" ");
    let image = format!("image(\"@{id}\", width: {DEFAULT_FIGURE_WIDTH})");
    if caption.is_empty() {
        format!("#figure({image}) <fig:{id}>")
    } else {
        let escaped = crate::commands::typst_render::escape_typst(&caption);
        format!("#figure({image}, caption: [{escaped}]) <fig:{id}>")
    }
}

/// Separator between pieces split from one long paragraph.
pub fn sentence_sep(original_ws: &str, target_lang: &str) -> String {
    if is_cjk_no_space(target_lang) {
        String::new()
    } else if original_ws.is_empty() {
        " ".into()
    } else {
        original_ws.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "#set text(font: \"Noto Serif JP\", lang: \"ja\")\n#let 手法名 = [提案手法]\n\n= はじめに\n研究者は *重要* な $w_i$ を {@smith2020} で示す。#手法名 を @fig:x と #emph[強調] で。// c\n次の行\n\n$ E = x $ <eq:e>\n\n{{@image_1}}\n\n#figure(image(\"a.png\"), caption: [概要]) <fig:o>\n\n```py\nprint(\"こんにちは\")\n```\n\n- 項目 {@table_1[2,3]}\n+ 番号\n/ 用語: 説明\n";

    fn units(p: &[Piece]) -> Vec<&str> {
        p.iter()
            .filter_map(|x| match x {
                Piece::Translate(u) => Some(u.text.as_str()),
                _ => None,
            })
            .collect()
    }

    fn identity(p: &[Piece]) -> String {
        p.iter()
            .map(|x| match x {
                Piece::Keep(s) => s.as_str(),
                Piece::Translate(u) => u.text.as_str(),
            })
            .collect()
    }

    fn figs(pairs: &[(&str, &str)]) -> std::collections::HashMap<String, String> {
        pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn image_refs_become_adjustable_figures() {
        let src = "本文。\n\n{{@image_1}}\n\n  {{@image_2}} {{@paper_x}}\n\n```\n{{@image_1}}\n```\n// {{@image_1}}\n\n文中の {{@image_1}} は残す。\n";
        let out = expand_figure_refs(src, &figs(&[("image_1", "概要 *図*"), ("image_2", "")]));
        assert_eq!(
            out,
            "本文。\n\n#figure(image(\"@image_1\", width: 80%), caption: [概要 \\*図\\*]) <fig:image_1>\n\n  #figure(image(\"@image_2\", width: 80%)) <fig:image_2>\n  {{@paper_x}}\n\n```\n{{@image_1}}\n```\n// {{@image_1}}\n\n文中の {{@image_1}} は残す。\n"
        );
        // The caption is then translated like any other caption.
        assert_eq!(units(&plan_typst(&out, "en")), vec!["本文。", "概要 \\*図\\*", "文中の {{@image_1}} は残す。"]);
        // No known images → unchanged.
        assert_eq!(expand_figure_refs(src, &figs(&[])), src);
    }

    #[test]
    fn translates_prose_only() {
        let p = plan_typst(DOC, "en");
        assert_eq!(
            units(&p),
            vec![
                "提案手法",
                "はじめに",
                "研究者は *重要* な $w_i$ を {@smith2020} で示す。#手法名 を @fig:x と #emph[強調] で。// c\n次の行",
                "概要",
                "項目 {@table_1[2,3]}",
                "番号",
                "用語",
                "説明",
            ]
        );
    }

    #[test]
    fn untouched_source_round_trips_except_lang() {
        let p = plan_typst(DOC, "en");
        assert_eq!(identity(&p), DOC.replace("lang: \"ja\"", "lang: \"en\""));
        let p = plan_typst(DOC, "zh-hans");
        assert!(identity(&p).contains("lang: \"zh\""));
    }

    #[test]
    fn protected_items_of_a_paragraph() {
        let p = plan_typst(DOC, "en");
        let u = p
            .iter()
            .find_map(|x| match x {
                Piece::Translate(u) if u.text.starts_with("研究者") => Some(u),
                _ => None,
            })
            .unwrap();
        let toks: Vec<&str> = u.protected.iter().map(|r| &u.text[r.clone()]).collect();
        assert_eq!(toks, vec!["$w_i$", "{@smith2020}", "#手法名", "@fig:x", "#emph", "// c"]);
        let delims: Vec<&str> = u.delimiters.iter().map(|r| &u.text[r.clone()]).collect();
        assert_eq!(delims, vec!["*", "*"]);
    }

    #[test]
    fn check_accepts_good_and_rejects_broken_output() {
        let p = plan_typst("本手法は $O(n)$ で {@a} より *速い*。#手法名 を使う。", "en");
        let Piece::Translate(u) = &p[0] else { panic!() };
        assert!(check_output(u, "This method is *faster* than {@a} at $O(n)$. It uses #手法名.").is_ok());
        assert!(check_output(u, "This method is *faster* than {@a} at O(n). It uses #手法名.").is_err());
        assert!(check_output(u, "This method is faster than {@a} at $O(n)$. It uses #手法名.").is_err());
        assert!(check_output(u, "This method is *faster* than {@a} at $O(n)$. It uses #method name.").is_err());
    }

    #[test]
    fn text_after_a_line_comment_is_moved_to_the_next_line() {
        let p = plan_typst("前半 // メモ\n後半。", "en");
        let Piece::Translate(u) = &p[0] else { panic!() };
        assert_eq!(repair_line_comments(u, "First half // メモ second half."), "First half // メモ\nsecond half.");
        assert_eq!(repair_line_comments(u, "First // メモ\nsecond."), "First // メモ\nsecond.");
    }

    #[test]
    fn mask_unmask_round_trip() {
        let p = plan_typst("本手法は $O(n)$ で {@a} より *速い*。", "en");
        let Piece::Translate(u) = &p[0] else { panic!() };
        let (masked, tokens) = mask(u);
        assert_eq!(masked, "本手法は ⟦1⟧ で ⟦2⟧ より ⟦3⟧速い⟦4⟧。");
        let restored = unmask("This method is ⟦3⟧faster⟦4⟧ than ⟦2⟧ at ⟦ 1 ⟧.", &tokens).unwrap();
        assert_eq!(restored, "This method is *faster* than {@a} at $O(n)$.");
        assert!(unmask("lost ⟦1⟧ ⟦2⟧ ⟦3⟧", &tokens).is_err());
        assert!(unmask("dup ⟦1⟧ ⟦1⟧ ⟦2⟧ ⟦3⟧ ⟦4⟧", &tokens).is_err());
    }

    #[test]
    fn reference_only_paragraph_is_kept() {
        let p = plan_typst("{{@image_1}}\n\n{@a; @b}\n\n本文。", "en");
        assert_eq!(units(&p), vec!["本文。"]);
    }

    #[test]
    fn set_rule_content_is_not_translated() {
        let p = plan_typst("#show heading: it => [見出し: #it.body]\n#import \"x.typ\": *\n\n本文。", "en");
        assert_eq!(units(&p), vec!["本文。"]);
    }

    #[test]
    fn long_paragraph_is_split_outside_markup() {
        let sentence = "これは $x_1$ を含む長い文です。";
        let para = sentence.repeat(120); // ≈ 2160 chars
        let p = plan_typst(&para, "ja");
        let us = units(&p);
        assert!(us.len() >= 2, "{}", us.len());
        assert!(us.iter().all(|u| u.chars().count() <= MAX_UNIT_CHARS));
        assert!(us.iter().all(|u| u.matches('$').count() % 2 == 0));
        // CJK target: pieces re-join with nothing in between.
        assert_eq!(identity(&p), para);
        // Latin target: a space is inserted where "。" had none.
        let p = plan_typst(&para, "en");
        assert_eq!(identity(&p).matches("。 これは").count(), units(&p).len() - 1);
    }

    #[test]
    fn nested_list_bodies() {
        let p = plan_typst("- 親\n  - 子の項目\n- 次", "en");
        assert_eq!(units(&p), vec!["親", "子の項目", "次"]);
    }
}
