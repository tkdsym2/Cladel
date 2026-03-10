use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BibtexEntry {
    pub entry_type: String,
    pub cite_key: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<String>,
    pub journal: Option<String>,
    pub booktitle: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
    pub abstract_text: Option<String>,
    pub raw: String,
    pub fields: HashMap<String, String>,
    /// If set, indicates this entry had issues during parsing.
    pub parse_error: Option<String>,
}

/// Returns the byte offset for char index `idx`, or `input_len` if out of bounds.
fn byte_pos(offsets: &[usize], idx: usize, input_len: usize) -> usize {
    if idx < offsets.len() {
        offsets[idx]
    } else {
        input_len
    }
}

/// Simple BibTeX parser that handles common entries.
/// Does not depend on external crates — parses the most common BibTeX format.
#[tauri::command]
pub fn parse_bibtex(bibtex_string: String) -> Result<Vec<BibtexEntry>, String> {
    let mut entries = Vec::new();
    let input = bibtex_string.trim();
    let input_len = input.len();

    // Collect chars and their byte offsets for correct slicing
    let chars: Vec<char> = input.chars().collect();
    let byte_offsets: Vec<usize> = input.char_indices().map(|(pos, _)| pos).collect();

    let mut i = 0;

    while i < chars.len() {
        // Find the start of an entry
        if chars[i] == '@' {
            let entry_start = i;

            // Read entry type
            i += 1;
            let type_start = i;
            while i < chars.len() && chars[i] != '{' && !chars[i].is_whitespace() {
                i += 1;
            }
            let entry_type = input[byte_pos(&byte_offsets, type_start, input_len)
                ..byte_pos(&byte_offsets, i, input_len)]
                .to_lowercase();

            // Skip to opening brace
            while i < chars.len() && chars[i] != '{' {
                i += 1;
            }
            if i >= chars.len() {
                break;
            }
            i += 1; // skip '{'

            // Read cite key
            let key_start = i;
            while i < chars.len() && chars[i] != ',' && chars[i] != '}' {
                i += 1;
            }
            let cite_key = input[byte_pos(&byte_offsets, key_start, input_len)
                ..byte_pos(&byte_offsets, i, input_len)]
                .trim()
                .to_string();

            if i < chars.len() && chars[i] == ',' {
                i += 1;
            }

            // Read fields until matching closing brace
            let mut fields: HashMap<String, String> = HashMap::new();
            let mut brace_depth = 1;
            let fields_start = i;

            // Find the end of this entry
            while i < chars.len() && brace_depth > 0 {
                if chars[i] == '{' {
                    brace_depth += 1;
                } else if chars[i] == '}' {
                    brace_depth -= 1;
                }
                if brace_depth > 0 {
                    i += 1;
                }
            }

            let fields_text = &input[byte_pos(&byte_offsets, fields_start, input_len)
                ..byte_pos(&byte_offsets, i, input_len)];
            let entry_end = if i < chars.len() { i + 1 } else { i };
            let raw = input[byte_pos(&byte_offsets, entry_start, input_len)
                ..byte_pos(&byte_offsets, entry_end, input_len)]
                .to_string();

            // Parse fields from fields_text
            parse_fields(fields_text, &mut fields);

            let title = fields.get("title").cloned().unwrap_or_default();
            let authors = fields
                .get("author")
                .map(|a| {
                    a.split(" and ")
                        .map(|s| s.trim().to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            let clean_title = clean_braces(&title);
            let clean_authors: Vec<String> =
                authors.into_iter().map(|a| clean_braces(&a)).collect();

            let parse_error = if clean_title.is_empty() && cite_key.is_empty() {
                Some("Could not extract title or citation key".to_string())
            } else if clean_title.is_empty() {
                Some("Missing title field".to_string())
            } else {
                None
            };

            entries.push(BibtexEntry {
                entry_type,
                cite_key,
                title: clean_title,
                authors: clean_authors,
                year: fields.get("year").map(|s| clean_braces(s)),
                journal: fields.get("journal").map(|s| clean_braces(s)),
                booktitle: fields.get("booktitle").map(|s| clean_braces(s)),
                doi: fields.get("doi").map(|s| clean_braces(s)),
                url: fields.get("url").map(|s| clean_braces(s)),
                abstract_text: fields.get("abstract").map(|s| clean_braces(s)),
                raw,
                fields: fields
                    .into_iter()
                    .map(|(k, v)| (k, clean_braces(&v)))
                    .collect(),
                parse_error,
            });

            if i < chars.len() {
                i += 1; // skip closing '}'
            }
        } else {
            i += 1;
        }
    }

    Ok(entries)
}

fn parse_fields(text: &str, fields: &mut HashMap<String, String>) {
    let chars: Vec<char> = text.chars().collect();
    let byte_offsets: Vec<usize> = text.char_indices().map(|(pos, _)| pos).collect();
    let text_len = text.len();
    let mut i = 0;

    while i < chars.len() {
        // Skip whitespace and commas
        while i < chars.len() && (chars[i].is_whitespace() || chars[i] == ',') {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }

        // Read field name
        let name_start = i;
        while i < chars.len() && chars[i] != '=' && !chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let field_name = text
            [byte_pos(&byte_offsets, name_start, text_len)..byte_pos(&byte_offsets, i, text_len)]
            .trim()
            .to_lowercase();

        // Skip to '='
        while i < chars.len() && chars[i] != '=' {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        i += 1; // skip '='

        // Skip whitespace
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }

        // Read field value
        let value = if chars[i] == '{' {
            // Brace-delimited value
            i += 1;
            let val_start = i;
            let mut depth = 1;
            while i < chars.len() && depth > 0 {
                if chars[i] == '{' {
                    depth += 1;
                } else if chars[i] == '}' {
                    depth -= 1;
                }
                if depth > 0 {
                    i += 1;
                }
            }
            let val = text[byte_pos(&byte_offsets, val_start, text_len)
                ..byte_pos(&byte_offsets, i, text_len)]
                .to_string();
            if i < chars.len() {
                i += 1;
            }
            val
        } else if chars[i] == '"' {
            // Quote-delimited value
            i += 1;
            let val_start = i;
            while i < chars.len() && chars[i] != '"' {
                i += 1;
            }
            let val = text[byte_pos(&byte_offsets, val_start, text_len)
                ..byte_pos(&byte_offsets, i, text_len)]
                .to_string();
            if i < chars.len() {
                i += 1;
            }
            val
        } else {
            // Bare value (number or macro)
            let val_start = i;
            while i < chars.len() && chars[i] != ',' && chars[i] != '}' && !chars[i].is_whitespace()
            {
                i += 1;
            }
            text[byte_pos(&byte_offsets, val_start, text_len)..byte_pos(&byte_offsets, i, text_len)]
                .to_string()
        };

        if !field_name.is_empty() {
            fields.insert(field_name, value.trim().to_string());
        }
    }
}

fn clean_braces(s: &str) -> String {
    s.replace('{', "").replace('}', "")
}

// ─── Shared BibTeX generation utility ───

/// Escape special BibTeX characters in a value string.
pub fn escape_bibtex(s: &str) -> String {
    s.replace('{', "\\{").replace('}', "\\}")
}

/// Generate a BibTeX `@article` entry from individual metadata fields.
///
/// Used by both PDF import and BibTeX export to produce entries for Paper
/// Nodes that don't already have a stored BibTeX string.
pub fn generate_bibtex_entry(
    title: &str,
    authors: &[String],
    year: Option<&str>,
    journal: Option<&str>,
    doi: Option<&str>,
    abstract_text: Option<&str>,
) -> String {
    // Citation key: first author last name + year
    let cite_key = {
        let last_name = authors
            .first()
            .map(|a| {
                a.split_whitespace()
                    .last()
                    .unwrap_or("Unknown")
                    .to_string()
            })
            .unwrap_or_else(|| "Unknown".to_string());

        let yr = year.unwrap_or("0000");

        let clean_name: String = last_name
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect();
        let clean_name = if clean_name.is_empty() {
            "Unknown".to_string()
        } else {
            clean_name
        };

        format!("{clean_name}{yr}")
    };

    let mut bib = format!("@article{{{cite_key},\n");
    bib.push_str(&format!("  title = {{{}}},\n", escape_bibtex(title)));

    if !authors.is_empty() {
        let authors_str = authors.join(" and ");
        bib.push_str(&format!(
            "  author = {{{}}},\n",
            escape_bibtex(&authors_str)
        ));
    }

    if let Some(yr) = year {
        bib.push_str(&format!("  year = {{{yr}}},\n"));
    }

    if let Some(j) = journal {
        bib.push_str(&format!("  journal = {{{}}},\n", escape_bibtex(j)));
    }

    if let Some(d) = doi {
        bib.push_str(&format!("  doi = {{{d}}},\n"));
    }

    if let Some(abs) = abstract_text {
        bib.push_str(&format!("  abstract = {{{}}},\n", escape_bibtex(abs)));
    }

    bib.push('}');
    bib
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_multibyte_no_truncation() {
        let bib = r#"@ARTICLE{Takada2026-dt,
  title     = "The role of regularity detection and prediction in the
               exploration of sense of agency",
  author    = "Takada, Kazuma and Wen, Wen and Kasahara, Shunichi and Froese,
               Tom",
  journal   = "Conscious. Cogn.",
  publisher = "Elsevier BV",
  volume    =  138,
  number    =  103980,
  pages     =  103980,
  abstract  = "The Sense of Agency (SoA) refers to the subjective feeling of
               controlling one's actions and outcomes. Both the predictive and
               retrospective processes …",
  month     =  feb,
  year      =  2026,
  language  = "en"
}"#;
        let entries = parse_bibtex(bib.to_string()).unwrap();
        assert_eq!(entries.len(), 1);
        let e = &entries[0];

        // Raw must include the full entry with closing brace
        assert!(
            e.raw.ends_with('}'),
            "raw should end with '}}', got: ...{}",
            &e.raw[e.raw.len().saturating_sub(30)..]
        );
        assert!(
            e.raw.contains(r#"language  = "en""#),
            "raw should contain full language field"
        );

        // Fields should be fully parsed
        assert_eq!(e.fields.get("language").map(|s| s.as_str()), Some("en"));
        assert_eq!(e.year.as_deref(), Some("2026"));
        assert!(
            e.abstract_text.as_ref().unwrap().contains("…"),
            "abstract should contain ellipsis"
        );
        assert_eq!(e.authors.len(), 4);
    }

    #[test]
    fn test_long_abstract_no_truncation() {
        // Create a BibTeX with a 600+ character abstract
        let long_text = "A".repeat(600);
        let bib = format!(
            r#"@article{{key,
  title = {{Test Title}},
  author = {{Author One}},
  abstract = {{{long_text}}},
  year = {{2025}}
}}"#
        );
        let entries = parse_bibtex(bib.clone()).unwrap();
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.abstract_text.as_ref().unwrap().len(), 600);
        assert!(e.raw.ends_with('}'));
        assert_eq!(e.raw, bib);
    }
}
