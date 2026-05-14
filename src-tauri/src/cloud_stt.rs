//! Opt-in Groq cloud speech-to-text (OpenAI-compatible) when env flags are present.

use base64::{engine::general_purpose::STANDARD as B64_STANDARD, Engine as _};
use serde::Deserialize;

const GROQ_AUDIO_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroqAudioPayload {
    audio_wav_base64: String,
}

#[tauri::command]
pub async fn groq_cloud_transcribe_wav(payload: GroqAudioPayload) -> Result<String, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = payload;
    #[cfg(any(target_os = "android", target_os = "ios"))]
    return Err("cloud stt unsupported on mobile".into());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    groq_cloud_inner(payload.audio_wav_base64).await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn groq_cloud_inner(audio_wav_base64: String) -> Result<String, String> {
    if std::env::var("MELLOVOICE_GROQ_CLOUD").ok().as_deref() != Some("1") {
        return Err("cloud stt disabled (set MELLOVOICE_GROQ_CLOUD=1)".into());
    }

    let api_key =
        std::env::var("MELLOVOICE_GROQ_API_KEY").map_err(|_| "MELLOVOICE_GROQ_API_KEY unset".to_string())?;
    let key = api_key.trim();
    if key.is_empty() {
        return Err("MELLOVOICE_GROQ_API_KEY empty".into());
    }

    let wav = decode(&audio_wav_base64)?;
    if wav.len() < 64 {
        return Err("audio too short".into());
    }

    let part = reqwest::multipart::Part::bytes(wav)
        .file_name("speech.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3")
        .text("response_format", "json");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(GROQ_AUDIO_URL)
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("groq transcribe failed: {}", e))?;

    if !resp.status().is_success() {
        let code = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("groq transcribe HTTP {}: {}", code, err_body.trim()));
    }

    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = v
        .get("text")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    match text {
        Some(t) => Ok(t.to_string()),
        None => Err("groq transcript empty or malformed".into()),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn decode(b64: &str) -> Result<Vec<u8>, String> {
    let compact: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    B64_STANDARD
        .decode(compact.trim())
        .map_err(|e| format!("invalid base64: {}", e))
}
