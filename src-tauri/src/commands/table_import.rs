use serde::Serialize;
use std::path::Path;

/// Result of importing a CSV/XLSX file into a Table node.
/// The parsed cell data is embedded in the .cld (snapshot), so the table
/// remains portable and intact even if the source file is moved or deleted.
#[derive(Debug, Serialize)]
pub struct TableImportResult {
    /// "csv" or "xlsx"
    pub format: String,
    /// Original file name (no directory), for display only.
    pub filename: String,
    /// Sheet name for xlsx (None for csv).
    pub sheet: Option<String>,
    /// Row-major cell data, rectangularized (every row has the same length).
    pub rows: Vec<Vec<String>>,
}

/// Read a CSV or XLSX file into a rectangular 2D string grid.
#[tauri::command]
pub fn import_table_file(path: String) -> Result<TableImportResult, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File not found: {path}"));
    }

    let filename = p
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let (format, sheet, rows) = match ext.as_str() {
        "csv" | "tsv" | "txt" => {
            let rows = read_csv(p, &ext)?;
            ("csv".to_string(), None, rows)
        }
        "xlsx" | "xlsm" | "xls" | "xlsb" | "ods" => {
            let (sheet, rows) = read_spreadsheet(p)?;
            ("xlsx".to_string(), Some(sheet), rows)
        }
        other => {
            return Err(format!(
                "Unsupported file type: .{other} (expected .csv or .xlsx)"
            ));
        }
    };

    let rows = rectangularize(rows);

    Ok(TableImportResult {
        format,
        filename,
        sheet,
        rows,
    })
}

/// Parse a CSV/TSV file (no header assumption — every row is a data row).
fn read_csv(path: &Path, ext: &str) -> Result<Vec<Vec<String>>, String> {
    let delimiter = if ext == "tsv" { b'\t' } else { b',' };
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .from_path(path)
        .map_err(|e| format!("Failed to open CSV: {e}"))?;

    let mut rows: Vec<Vec<String>> = Vec::new();
    for result in rdr.records() {
        let record = result.map_err(|e| format!("Failed to read CSV row: {e}"))?;
        rows.push(record.iter().map(|s| s.to_string()).collect());
    }
    Ok(rows)
}

/// Parse the first sheet of a spreadsheet workbook into a 2D string grid.
fn read_spreadsheet(path: &Path) -> Result<(String, Vec<Vec<String>>), String> {
    use calamine::{open_workbook_auto, Reader};

    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("Failed to open spreadsheet: {e}"))?;

    let sheet_names = workbook.sheet_names().to_vec();
    let first = sheet_names
        .first()
        .cloned()
        .ok_or_else(|| "Spreadsheet has no sheets".to_string())?;

    let range = workbook
        .worksheet_range(&first)
        .map_err(|e| format!("Failed to read sheet '{first}': {e}"))?;

    let rows: Vec<Vec<String>> = range
        .rows()
        .map(|row| row.iter().map(cell_to_string).collect())
        .collect();

    Ok((first, rows))
}

/// Convert a spreadsheet cell into a display string.
/// Integer-valued floats render without a trailing ".0" (Excel stores ints as floats).
fn cell_to_string(cell: &calamine::Data) -> String {
    use calamine::Data;
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{e:?}"),
    }
}

/// Pad every row to the maximum column count so the grid is rectangular.
fn rectangularize(mut rows: Vec<Vec<String>>) -> Vec<Vec<String>> {
    let max_cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    if max_cols == 0 {
        // Guarantee a non-empty grid so the viewer always has something to render.
        return vec![vec![String::new()]];
    }
    for row in rows.iter_mut() {
        if row.len() < max_cols {
            row.resize(max_cols, String::new());
        }
    }
    rows
}
