//! Heuristic polishing + optional Groq Llama refinement (same API key as cloud STT).

use serde::Deserialize;
use serde_json::json;

const GROQ_CHAT_URL: &str = "https://api.groq.com/openai/v1/chat/completions";

#[tauri::command]
pub async fn polish_final_transcript(text: String) -> Result<String, String> {
    let t = text.trim();
    if t.is_empty() {
        return Ok(String::new());
    }

    let h = heuristic_polish_en(t);

    #[cfg(any(target_os = "android", target_os = "ios"))]
    return Ok(h);

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        Ok(polish_with_optional_llm(h).await)
    }
}

/// Capitalise phrase starts after `.!?` boundaries; normalise whitespace; light terminal punctuation.
pub fn heuristic_polish_en(input: &str) -> String {
    let condensed = normalize_ws(input);
    if condensed.is_empty() {
        return String::new();
    }

    let mut out = String::with_capacity(condensed.len() + 1);
    let mut cap_next = true;

    for ch in condensed.trim().chars() {
        if cap_next {
            if ch.is_whitespace() {
                out.push(ch);
                continue;
            }
            if ch.is_alphabetic() {
                for u in ch.to_uppercase() {
                    out.push(u);
                }
                cap_next = false;
            } else {
                out.push(ch);
                if !(ch.is_ascii_digit() || ch == '"' || ch == '\'' || ch == '(') {
                    cap_next = false;
                }
            }
        } else {
            out.push(ch);
            if matches!(ch, '.' | '!' | '?') {
                cap_next = true;
            }
        }
    }

    let trimmed = normalize_ws(out.trim());
    append_terminal_if_needed(trimmed)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn polish_with_optional_llm(text: String) -> String {
    let key_opt = std::env::var("MELLOVOICE_GROQ_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty());

    let Some(api_key) = key_opt else {
        return text;
    };

    if std::env::var("MELLOVOICE_GROQ_POLISH").ok().as_deref() != Some("1") {
        return text;
    }

    polish_groq_llama(&text, api_key.trim())
        .await
        .unwrap_or(text)
}

fn normalize_ws(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn append_terminal_if_needed(s: String) -> String {
    let t = s.trim_end();
    if t.is_empty() {
        return String::new();
    }
    if t.ends_with('.') || t.ends_with('!') || t.ends_with('?') {
        return t.to_string();
    }
    if let Some(ch) = t.chars().rev().find(|c| !c.is_whitespace()) {
        if ch.is_alphanumeric() || ch == '\'' || ch == '\u{2019}' || ch == '"' || ch == '\u{201d}' {
            let mut out = t.to_string();
            if !out.ends_with('.') && !out.ends_with('!') && !out.ends_with('?') {
                out.push('.');
            }
            return out;
        }
    }
    t.to_string()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn polish_groq_llama(prompt: &str, api_key: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .ok()?;

    let body = json!({
        "model": "llama-3.1-8b-instant",
        "messages": [{
            "role": "user",
            "content": format!(
                "Improve this dictated English transcript for readability: spelling, capitalization, punctuation, grammar. \
                 Preserve wording and factual content; never invent details. Respond with corrected text only, no quotes:\n\n{}",
                prompt.trim(),
            ),
        }],
        "temperature": 0.15,
        "max_tokens": 1024usize,
    });

    let resp = client
        .post(GROQ_CHAT_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let chat: ChatCompletionResponse = resp.json().await.ok()?;
    let content = chat
        .choices?
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)?;

    Some(heuristic_polish_en(content.trim()))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Option<Vec<GroqChoice>>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct GroqChoice {
    message: GroqMsg,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct GroqMsg {
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heuristic_polish_empty_and_whitespace() {
        assert_eq!(heuristic_polish_en(""), "");
        assert_eq!(heuristic_polish_en("   \n\t  "), "");
    }

    #[test]
    fn heuristic_polish_sentence_cap_and_period() {
        let out = heuristic_polish_en("hello world");
        assert!(out.starts_with("Hello"));
        assert!(out.ends_with('.'));
    }

    #[test]
    fn heuristic_polish_respects_sentence_boundaries() {
        let out = heuristic_polish_en("first. second phrase");
        assert!(out.contains("First."));
        assert!(out.contains("Second"));
    }
}
