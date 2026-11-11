//! Split long source text into pieces that are translated one request at a time.
//!
//! Paragraphs (separated by blank lines) are packed greedily up to `max_chars`,
//! so short neighbouring paragraphs share context. A paragraph longer than
//! `max_chars` is split at sentence ends, and a sentence longer than that is
//! hard-split on a char boundary. The blank-line separators of the original
//! text are kept, so the translated pieces can be re-joined with the same
//! paragraph layout.

/// Default chunk size in characters (≈ well inside the 16K-token context
/// even for CJK, leaving room for the output).
pub const DEFAULT_MAX_CHARS: usize = 1200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Sep {
    /// Original paragraph separator (e.g. "\n\n"), reproduced verbatim.
    Paragraph(String),
    /// Split inside a paragraph: a space, or nothing for ja/zh targets.
    Sentence,
    /// Last chunk.
    End,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub text: String,
    /// What goes between this chunk's translation and the next one.
    pub sep: Sep,
}

impl Sep {
    pub fn render(&self, target_lang: &str) -> &str {
        match self {
            Sep::Paragraph(s) => s.as_str(),
            Sep::Sentence if super::pfml::is_cjk_no_space(target_lang) => "",
            Sep::Sentence => " ",
            Sep::End => "",
        }
    }
}

pub fn split_into_chunks(text: &str, max_chars: usize) -> Vec<Chunk> {
    let max_chars = max_chars.max(1);
    let text = text.replace("\r\n", "\n");

    // 1. Paragraphs with the separator that follows each.
    let mut paragraphs: Vec<(String, String)> = Vec::new();
    for (para, sep) in split_paragraphs(&text) {
        let para = para.trim();
        if para.is_empty() {
            // Fold the separator into the previous paragraph's one.
            if let Some(last) = paragraphs.last_mut() {
                last.1.push_str(&sep);
            }
            continue;
        }
        paragraphs.push((para.to_string(), sep));
    }

    // 2. Pack paragraphs; split oversize ones.
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut current: Option<(String, String)> = None; // (text, trailing sep)
    for (para, sep) in paragraphs {
        if char_len(&para) > max_chars {
            if let Some((t, s)) = current.take() {
                chunks.push(Chunk { text: t, sep: Sep::Paragraph(s) });
            }
            let pieces = split_long_paragraph(&para, max_chars);
            let n = pieces.len();
            for (i, piece) in pieces.into_iter().enumerate() {
                let sep = if i + 1 < n { Sep::Sentence } else { Sep::Paragraph(sep.clone()) };
                chunks.push(Chunk { text: piece, sep });
            }
            continue;
        }
        current = match current.take() {
            Some((t, s)) if char_len(&t) + char_len(&s) + char_len(&para) <= max_chars => {
                Some((format!("{t}{s}{para}"), sep))
            }
            Some((t, s)) => {
                chunks.push(Chunk { text: t, sep: Sep::Paragraph(s) });
                Some((para, sep))
            }
            None => Some((para, sep)),
        };
    }
    if let Some((t, s)) = current {
        chunks.push(Chunk { text: t, sep: Sep::Paragraph(s) });
    }
    if let Some(last) = chunks.last_mut() {
        last.sep = Sep::End;
    }
    chunks
}

/// Re-join translated pieces using the chunks' separators.
#[cfg(test)]
pub fn join_translations(chunks: &[Chunk], translations: &[String], target_lang: &str) -> String {
    let mut out = String::new();
    for (chunk, tr) in chunks.iter().zip(translations) {
        out.push_str(tr.trim());
        out.push_str(chunk.sep.render(target_lang));
    }
    out
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// Split on blank lines (a newline, optional spaces/tabs, newline, ...),
/// returning each paragraph with the separator after it ("" for the last).
fn split_paragraphs(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut para_start = 0;
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            // Scan a run of whitespace; it's a separator if it holds ≥2 newlines.
            let mut j = i;
            let mut newlines = 0;
            while j < bytes.len() && matches!(bytes[j], b'\n' | b' ' | b'\t') {
                if bytes[j] == b'\n' {
                    newlines += 1;
                }
                j += 1;
            }
            if newlines >= 2 {
                // Keep only the newlines (drop indentation of the next line).
                let sep = "\n".repeat(newlines);
                out.push((text[para_start..i].to_string(), sep));
                para_start = j;
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out.push((text[para_start..].to_string(), String::new()));
    out
}

/// Split one paragraph into pieces of at most `max_chars`, preferring
/// sentence boundaries.
fn split_long_paragraph(para: &str, max_chars: usize) -> Vec<String> {
    let mut pieces = Vec::new();
    let mut current = String::new();
    for sentence in split_sentences(para) {
        if char_len(&sentence) > max_chars {
            if !current.trim().is_empty() {
                pieces.push(current.trim().to_string());
            }
            current = String::new();
            pieces.extend(hard_split(&sentence, max_chars));
            continue;
        }
        if char_len(&current) + char_len(&sentence) > max_chars && !current.trim().is_empty() {
            pieces.push(current.trim().to_string());
            current = String::new();
        }
        current.push_str(&sentence);
    }
    if !current.trim().is_empty() {
        pieces.push(current.trim().to_string());
    }
    pieces
}

/// Sentences including their terminator and trailing whitespace.
fn split_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        let is_end = match c {
            '。' | '！' | '？' | '．' => true,
            // Latin terminators only before whitespace (avoid "3.14", "e.g.x").
            '.' | '!' | '?' => next.map_or(true, char::is_whitespace),
            _ => false,
        };
        if is_end {
            let mut j = i + 1;
            // Closing quotes/brackets belong to the sentence.
            while j < chars.len() && matches!(chars[j], '」' | '』' | ')' | '）' | '"' | '\'' | '”' | '’') {
                j += 1;
            }
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            out.push(chars[start..j].iter().collect());
            start = j;
            i = j;
            continue;
        }
        i += 1;
    }
    if start < chars.len() {
        out.push(chars[start..].iter().collect());
    }
    out
}

fn hard_split(text: &str, max_chars: usize) -> Vec<String> {
    let chars: Vec<char> = text.trim().chars().collect();
    chars
        .chunks(max_chars)
        .map(|c| c.iter().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(chunks: &[Chunk]) -> Vec<&str> {
        chunks.iter().map(|c| c.text.as_str()).collect()
    }

    #[test]
    fn empty_and_whitespace() {
        assert!(split_into_chunks("", 100).is_empty());
        assert!(split_into_chunks("  \n\n \n", 100).is_empty());
    }

    #[test]
    fn single_paragraph() {
        let c = split_into_chunks("  Hello world.  ", 100);
        assert_eq!(c, vec![Chunk { text: "Hello world.".into(), sep: Sep::End }]);
    }

    #[test]
    fn short_paragraphs_are_packed_with_their_separator() {
        let c = split_into_chunks("A.\n\nB.\r\n\r\nC.", 100);
        assert_eq!(texts(&c), vec!["A.\n\nB.\n\nC."]);
    }

    #[test]
    fn paragraphs_split_when_over_limit() {
        let c = split_into_chunks("aaaa\n\nbbbb\n\n\ncccc", 10);
        assert_eq!(texts(&c), vec!["aaaa\n\nbbbb", "cccc"]);
        assert_eq!(c[0].sep, Sep::Paragraph("\n\n\n".into()));
        assert_eq!(c[1].sep, Sep::End);
    }

    #[test]
    fn single_newlines_stay_inside_a_paragraph() {
        let c = split_into_chunks("line1\nline2", 100);
        assert_eq!(texts(&c), vec!["line1\nline2"]);
    }

    #[test]
    fn long_paragraph_split_at_sentences() {
        let c = split_into_chunks("これは一文目です。これは二文目です。これは三文目です。", 12);
        assert_eq!(texts(&c), vec!["これは一文目です。", "これは二文目です。", "これは三文目です。"]);
        assert_eq!(c[0].sep, Sep::Sentence);
        assert_eq!(c[2].sep, Sep::End);

        let c = split_into_chunks("Pi is 3.14 here. Second one! Third?", 17);
        assert_eq!(texts(&c), vec!["Pi is 3.14 here.", "Second one!", "Third?"]);
    }

    #[test]
    fn closing_quote_stays_with_sentence() {
        let s = split_sentences("彼は「行く。」と言った。次。");
        assert_eq!(s, vec!["彼は「行く。」", "と言った。", "次。"]);
    }

    #[test]
    fn overlong_sentence_is_hard_split() {
        let c = split_into_chunks("あいうえおかきくけこさしすせそ", 6);
        assert_eq!(texts(&c), vec!["あいうえおか", "きくけこさし", "すせそ"]);
    }

    #[test]
    fn join_respects_target_language() {
        let chunks = split_into_chunks("一文目です。二文目です。\n\n次の段落。", 7);
        assert_eq!(chunks.len(), 3);
        let tr = vec!["First.".to_string(), " Second. \n".to_string(), "Next.".to_string()];
        assert_eq!(join_translations(&chunks, &tr, "en"), "First. Second.\n\nNext.");
        let tr = vec!["一。".to_string(), "二。".to_string(), "三。".to_string()];
        assert_eq!(join_translations(&chunks, &tr, "ja"), "一。二。\n\n三。");
    }

    #[test]
    fn every_char_is_covered() {
        let src = "第一段落。とても長い文がここに続きます、そして終わります。\n\n  Second paragraph. With two sentences.\n\n\n最後";
        let chunks = split_into_chunks(src, 15);
        let rebuilt: String = chunks.iter().map(|c| c.text.as_str()).collect::<String>();
        let squash = |s: &str| s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
        assert_eq!(squash(&rebuilt), squash(src));
        assert!(chunks.iter().all(|c| c.text.chars().count() <= 15));
    }
}
