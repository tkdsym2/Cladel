//! Streaming client for llama-server `POST /completion` (SSE, loopback only).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};

use super::pfml::STOP_TOKENS;

/// Max tokens to generate for a source piece of `chars` characters.
pub fn n_predict_for(chars: usize) -> u32 {
    (chars.saturating_mul(4)).clamp(256, 4096) as u32
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompletionOutcome {
    pub text: String,
    pub cancelled: bool,
    pub tokens_predicted: Option<u64>,
    /// "eos" | "word" (stop token) | "limit" (hit n_predict) | ...
    pub stop_type: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum SseEvent {
    Delta { content: String, stop: bool, tokens_predicted: Option<u64>, stop_type: Option<String> },
    Error(String),
}

/// Parse one SSE line from llama-server. Non-data lines return `None`.
pub fn parse_sse_line(line: &str) -> Option<SseEvent> {
    let line = line.trim_end_matches('\r');
    let (is_error_field, payload) = if let Some(p) = line.strip_prefix("data:") {
        (false, p.trim_start())
    } else if let Some(p) = line.strip_prefix("error:") {
        (true, p.trim_start())
    } else {
        return None;
    };
    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }
    let v: Value = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(_) if is_error_field => return Some(SseEvent::Error(payload.to_string())),
        Err(e) => return Some(SseEvent::Error(format!("Malformed stream data: {e}"))),
    };
    if let Some(err) = v.get("error") {
        let msg = err.get("message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| err.to_string());
        return Some(SseEvent::Error(msg));
    }
    if is_error_field {
        return Some(SseEvent::Error(v.to_string()));
    }
    Some(SseEvent::Delta {
        content: v.get("content").and_then(Value::as_str).unwrap_or_default().to_string(),
        stop: v.get("stop").and_then(Value::as_bool).unwrap_or(false),
        tokens_predicted: v.get("tokens_predicted").and_then(Value::as_u64),
        stop_type: v.get("stop_type").and_then(Value::as_str).map(str::to_string),
    })
}

pub fn request_body(prompt: &str, n_predict: u32) -> Value {
    json!({
        "prompt": prompt,
        "n_predict": n_predict,
        "temperature": 0.0,
        "stop": STOP_TOKENS,
        "stream": true,
        "cache_prompt": true,
    })
}

/// Stream one completion, calling `on_delta` for each piece of text.
/// Checks `cancel` at least every 200 ms; cancelling drops the connection,
/// which makes llama-server stop generating.
pub async fn stream_completion(
    client: &reqwest::Client,
    port: u16,
    prompt: &str,
    n_predict: u32,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str),
) -> Result<CompletionOutcome, String> {
    let url = format!("http://127.0.0.1:{port}/completion");
    let send = client.post(&url).json(&request_body(prompt, n_predict)).send();
    let resp = tokio::select! {
        r = send => r.map_err(|e| format!("llama-server request failed: {e}"))?,
        _ = wait_cancel(cancel) => return Ok(CompletionOutcome { cancelled: true, ..Default::default() }),
    };
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
            .unwrap_or(body);
        return Err(format!("llama-server returned {status}: {msg}"));
    }

    let mut out = CompletionOutcome::default();
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let next = tokio::select! {
            n = stream.next() => n,
            _ = wait_cancel(cancel) => {
                out.cancelled = true;
                return Ok(out);
            }
        };
        let Some(bytes) = next else { break };
        let bytes = bytes.map_err(|e| format!("llama-server stream error: {e}"))?;
        buf.extend_from_slice(&bytes);
        // Complete lines only — a line never ends inside a UTF-8 sequence.
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line[..line.len() - 1]).into_owned();
            match parse_sse_line(&line) {
                Some(SseEvent::Delta { content, stop, tokens_predicted, stop_type }) => {
                    if !content.is_empty() {
                        out.text.push_str(&content);
                        on_delta(&content);
                    }
                    if stop {
                        out.tokens_predicted = tokens_predicted;
                        out.stop_type = stop_type;
                        return Ok(out);
                    }
                }
                Some(SseEvent::Error(e)) => return Err(format!("llama-server error: {e}")),
                None => {}
            }
        }
    }
    Ok(out)
}

async fn wait_cancel(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_delta_and_final_event() {
        assert_eq!(
            parse_sse_line(r#"data: {"index":0,"content":"Hel","stop":false}"#),
            Some(SseEvent::Delta { content: "Hel".into(), stop: false, tokens_predicted: None, stop_type: None })
        );
        assert_eq!(
            parse_sse_line(r#"data: {"content":"","stop":true,"tokens_predicted":5,"stop_type":"eos"}"#),
            Some(SseEvent::Delta { content: "".into(), stop: true, tokens_predicted: Some(5), stop_type: Some("eos".into()) })
        );
    }

    #[test]
    fn ignores_non_data_lines() {
        assert_eq!(parse_sse_line(""), None);
        assert_eq!(parse_sse_line(": keep-alive"), None);
        assert_eq!(parse_sse_line("data: [DONE]"), None);
    }

    #[test]
    fn parses_errors() {
        assert_eq!(
            parse_sse_line(r#"error: {"code":500,"message":"boom","type":"server_error"}"#),
            Some(SseEvent::Error(r#"{"code":500,"message":"boom","type":"server_error"}"#.into()))
        );
        assert_eq!(
            parse_sse_line(r#"data: {"error":{"code":400,"message":"context too long"}}"#),
            Some(SseEvent::Error("context too long".into()))
        );
    }

    #[test]
    fn request_body_is_greedy_streaming_with_stop_tokens() {
        let b = request_body("P", 300);
        assert_eq!(b["temperature"], 0.0);
        assert_eq!(b["stream"], true);
        assert_eq!(b["n_predict"], 300);
        assert_eq!(b["stop"], json!(["<|plamo:tag|>", "<|plamo:bos|>"]));
    }

    #[test]
    fn n_predict_bounds() {
        assert_eq!(n_predict_for(10), 256);
        assert_eq!(n_predict_for(500), 2000);
        assert_eq!(n_predict_for(100_000), 4096);
    }
}
