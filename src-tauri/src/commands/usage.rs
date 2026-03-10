use crate::db::Database;
use serde::Serialize;
use tauri::State;

// ─── Response types ───

#[derive(Debug, Serialize)]
pub struct UsageByType {
    pub invocation_type: String,
    pub count: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Serialize)]
pub struct UsageByModel {
    pub model: String,
    pub count: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Serialize)]
pub struct UsageSummary {
    pub total_calls: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_tokens: u64,
    pub calls_today: u64,
    pub tokens_today: u64,
    pub calls_this_week: u64,
    pub tokens_this_week: u64,
    pub by_invocation_type: Vec<UsageByType>,
    pub by_model: Vec<UsageByModel>,
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Serialize)]
pub struct UsageLogEntry {
    pub id: String,
    pub invocation_type: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub success: bool,
    pub created_at: String,
}

// ─── Cost estimation ───

fn estimate_cost(model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    let (input_per_m, output_per_m) = if model.contains("gemini") {
        (0.15, 0.60)
    } else if model.contains("opus") {
        (15.0, 75.0)
    } else if model.contains("haiku") {
        (0.25, 1.25)
    } else {
        // Default to Sonnet pricing
        (3.0, 15.0)
    };

    (input_tokens as f64 / 1_000_000.0) * input_per_m
        + (output_tokens as f64 / 1_000_000.0) * output_per_m
}

// ─── Tauri commands ───

#[tauri::command]
pub fn get_usage_summary(db: State<'_, Database>) -> Result<UsageSummary, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Total aggregates
    let (total_calls, total_input_tokens, total_output_tokens, total_tokens): (u64, u64, u64, u64) =
        conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(total_tokens), 0) \
             FROM agent_usage_log",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;

    // Today aggregates
    let (calls_today, tokens_today): (u64, u64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0) FROM agent_usage_log \
             WHERE date(created_at) = date('now')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // This week aggregates (last 7 days)
    let (calls_this_week, tokens_this_week): (u64, u64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0) FROM agent_usage_log \
             WHERE created_at >= datetime('now', '-7 days')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // By invocation type
    let mut type_stmt = conn
        .prepare(
            "SELECT invocation_type, COUNT(*), COALESCE(SUM(total_tokens), 0) \
             FROM agent_usage_log GROUP BY invocation_type ORDER BY COUNT(*) DESC",
        )
        .map_err(|e| e.to_string())?;

    let by_invocation_type: Vec<UsageByType> = type_stmt
        .query_map([], |row| {
            Ok(UsageByType {
                invocation_type: row.get(0)?,
                count: row.get(1)?,
                total_tokens: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // By model
    let mut model_stmt = conn
        .prepare(
            "SELECT model, COUNT(*), COALESCE(SUM(total_tokens), 0) \
             FROM agent_usage_log GROUP BY model ORDER BY COUNT(*) DESC",
        )
        .map_err(|e| e.to_string())?;

    let by_model: Vec<UsageByModel> = model_stmt
        .query_map([], |row| {
            Ok(UsageByModel {
                model: row.get(0)?,
                count: row.get(1)?,
                total_tokens: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Estimated cost: sum per-model costs
    let estimated_cost_usd = {
        let mut cost_stmt = conn
            .prepare(
                "SELECT model, COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0) \
                 FROM agent_usage_log GROUP BY model",
            )
            .map_err(|e| e.to_string())?;

        let rows: Vec<(String, u64, u64)> = cost_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, u64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        rows.iter()
            .map(|(model, inp, out)| estimate_cost(model, *inp, *out))
            .sum()
    };

    Ok(UsageSummary {
        total_calls,
        total_input_tokens,
        total_output_tokens,
        total_tokens,
        calls_today,
        tokens_today,
        calls_this_week,
        tokens_this_week,
        by_invocation_type,
        by_model,
        estimated_cost_usd,
    })
}

#[tauri::command]
pub fn get_usage_history(
    db: State<'_, Database>,
    limit: u64,
) -> Result<Vec<UsageLogEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, invocation_type, model, input_tokens, output_tokens, total_tokens, success, created_at \
             FROM agent_usage_log ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let entries: Vec<UsageLogEntry> = stmt
        .query_map([limit], |row| {
            Ok(UsageLogEntry {
                id: row.get(0)?,
                invocation_type: row.get(1)?,
                model: row.get(2)?,
                input_tokens: row.get(3)?,
                output_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                success: row.get::<_, i32>(6)? == 1,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(entries)
}

#[tauri::command]
pub fn clear_usage_log(db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM agent_usage_log", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
