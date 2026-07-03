//! In-process Typst typesetting engine.
//!
//! Wraps `typst-as-lib` to compile a dynamic Typst source string (assembled at
//! runtime from connected Note nodes) into a PDF (`typst-pdf`) or per-page PNG
//! previews (`typst-render`). Fonts bundled in `src-tauri/fonts/` are loaded so
//! both Latin and Japanese text render without relying on system fonts.
//!
//! This module is engine-only: it knows nothing about nodes/edges. The
//! `typst_render` command module assembles the source and calls in here.

use std::path::Path;

use typst::layout::PagedDocument;
use typst_as_lib::TypstEngine;

/// Fonts shipped with the app. Japanese (Noto) + Latin (Liberation) coverage.
fn bundled_fonts() -> Vec<&'static [u8]> {
    vec![
        include_bytes!("../../fonts/NotoSerifJP.ttf") as &[u8],
        include_bytes!("../../fonts/NotoSansJP.otf") as &[u8],
        include_bytes!("../../fonts/LiberationSerif-Regular.ttf") as &[u8],
        include_bytes!("../../fonts/LiberationSerif-Bold.ttf") as &[u8],
        include_bytes!("../../fonts/LiberationSerif-Italic.ttf") as &[u8],
        include_bytes!("../../fonts/LiberationSerif-BoldItalic.ttf") as &[u8],
        include_bytes!("../../fonts/LiberationSans-Regular.ttf") as &[u8],
        include_bytes!("../../fonts/LiberationSans-Bold.ttf") as &[u8],
        include_bytes!("../../fonts/LiberationSans-Italic.ttf") as &[u8],
        include_bytes!("../../fonts/LiberationSans-BoldItalic.ttf") as &[u8],
    ]
}

/// Format Typst diagnostics into a single human-readable error string.
fn format_diags<T: std::fmt::Debug>(diags: &T) -> String {
    format!("Typst error: {diags:?}")
}

/// Compile a Typst source string into a paged document.
///
/// `image_root`, when provided, is the directory used to resolve `image("...")`
/// paths referenced from the source (Phase 2 copies referenced images there).
fn compile_doc(source: String, image_root: Option<&Path>) -> Result<PagedDocument, String> {
    let fonts = bundled_fonts();
    let compiled = match image_root {
        Some(root) => TypstEngine::builder()
            .main_file(source)
            .fonts(fonts)
            .with_file_system_resolver(root)
            .build()
            .compile(),
        None => TypstEngine::builder()
            .main_file(source)
            .fonts(fonts)
            .build()
            .compile(),
    };
    compiled.output.map_err(|diags| format_diags(&diags))
}

/// Compile a Typst source string to PDF bytes.
pub fn compile_to_pdf(source: String, image_root: Option<&Path>) -> Result<Vec<u8>, String> {
    let doc = compile_doc(source, image_root)?;
    typst_pdf::pdf(&doc, &Default::default()).map_err(|diags| format_diags(&diags))
}

/// Compile a Typst source string and render each page to a PNG image.
///
/// `pixel_per_pt` controls resolution (e.g. 2.0 ≈ 144 dpi for crisp previews).
pub fn compile_to_pngs(
    source: String,
    image_root: Option<&Path>,
    pixel_per_pt: f32,
) -> Result<Vec<Vec<u8>>, String> {
    let doc = compile_doc(source, image_root)?;
    let mut pages = Vec::with_capacity(doc.pages.len());
    for page in &doc.pages {
        let pixmap = typst_render::render(page, pixel_per_pt);
        let png = pixmap.encode_png().map_err(|e| e.to_string())?;
        pages.push(png);
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SMOKE_SRC: &str = "#set page(width: 220pt, height: 140pt, margin: 12pt)\n\
= Hello, 世界\n\
This is *Typst* rendered in-process with mixed 日本語 and Latin text.";

    #[test]
    fn compiles_to_pdf() {
        let pdf = compile_to_pdf(SMOKE_SRC.to_string(), None).expect("compile to pdf");
        assert!(pdf.starts_with(b"%PDF"), "output should be a PDF");
        assert!(pdf.len() > 500, "pdf should be non-trivial");
    }

    #[test]
    fn renders_to_png() {
        let pages = compile_to_pngs(SMOKE_SRC.to_string(), None, 2.0).expect("render to png");
        assert_eq!(pages.len(), 1, "single-page document");
        // PNG magic number.
        assert_eq!(&pages[0][..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    }

    #[test]
    fn resolves_bibliography_from_root() {
        // Verifies the file-system resolver: `bibliography("refs.bib")` must read
        // a file from the image_root dir, and `@key` must resolve against it.
        let dir = std::env::temp_dir().join("cladel-typst-test-bib");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("refs.bib"),
            "@article{smith2020, title={A Test}, author={Smith, John}, year={2020}, journal={J}}",
        )
        .unwrap();
        let src = "#set text(size: 11pt)\nSee @smith2020 for details.\n\n\
                   #bibliography(\"refs.bib\", style: \"ieee\")"
            .to_string();
        let pdf = compile_to_pdf(src, Some(&dir)).expect("compile with bibliography from root");
        assert!(pdf.starts_with(b"%PDF"));
    }
}
