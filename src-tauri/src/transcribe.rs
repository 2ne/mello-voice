//! Local Whisper transcription through the bundled `whisper-cli` sidecar.

use base64::{engine::general_purpose::STANDARD as B64_STANDARD, Engine as _};
use serde::Deserialize;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

const MODEL_REL: &str = "models/ggml-base.en-q8_0.bin";
const TRANSCRIBE_DEFAULT_SECS: u64 = 120;
const MAX_WAV_BYTES: usize = 32 * 1024 * 1024;
const MAX_BASE64_CHARS: usize = ((MAX_WAV_BYTES + 2) / 3) * 4;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribePayload {
    audio_wav_base64: String,
    #[serde(default)]
    timeout_secs: Option<u64>,
}

#[tauri::command]
pub async fn transcribe_wav(app: AppHandle, payload: TranscribePayload) -> Result<String, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = (app, payload);
    #[cfg(any(target_os = "android", target_os = "ios"))]
    return Err("transcription unsupported on mobile".into());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    transcribe_desktop_inner(app, payload).await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn transcribe_desktop_inner(app: AppHandle, payload: TranscribePayload) -> Result<String, String> {
    validate_base64_payload_len(payload.audio_wav_base64.len())?;
    let buf = decode_wav(&payload.audio_wav_base64)?;
    if buf.len() < 48 {
        return Err("recording too short or invalid wav".into());
    }
    validate_decoded_wav_len(buf.len())?;

    let wall = clamp_timeout(payload.timeout_secs);

    let model_path = resolve_model_path(&app)?;

    let job_dir = env::temp_dir().join(format!("mellovoice-whisper-{}", Uuid::new_v4()));
    fs::create_dir_all(&job_dir).map_err(|e| format!("could not create temp dir: {}", e))?;

    let wav_path = job_dir.join("speech.wav");
    let out_base = job_dir.join("speech_out");
    let out_txt = job_dir.join("speech_out.txt");

    if let Err(e) = fs::write(&wav_path, &buf) {
        let _ = fs::remove_dir_all(&job_dir);
        return Err(format!("could not write temp wav: {}", e));
    }

    let n_threads = whisper_thread_count();

    let wav_arg = path_to_os_string(&wav_path)?;
    let model_arg = path_to_os_string(&model_path)?;
    let out_arg = path_to_os_string(&out_base)?;
    let t_arg = n_threads.to_string();

    let sidecar = match app.shell().sidecar("whisper-cli") {
        Ok(s) => s,
        Err(e) => {
            let _ = fs::remove_dir_all(&job_dir);
            return Err(shell_err(e));
        }
    };

    let cmd = sidecar.args([
        OsString::from("-m"),
        model_arg,
        OsString::from("-f"),
        wav_arg,
        OsString::from("-otxt"),
        OsString::from("-of"),
        out_arg,
        OsString::from("-np"),
        OsString::from("-nt"),
        OsString::from("-sns"),
        OsString::from("-l"),
        OsString::from("en"),
        OsString::from("-t"),
        OsString::from(t_arg.as_str()),
    ]);

    let run = cmd.output();
    let out = match timeout(Duration::from_secs(wall), run).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            let _ = fs::remove_dir_all(&job_dir);
            return Err(shell_err(e));
        }
        Err(_) => {
            let _ = fs::remove_dir_all(&job_dir);
            return Err(format!("whisper-cpp timed out after {wall}s"));
        }
    };

    let read_txt = fs::read_to_string(&out_txt).unwrap_or_default();
    let _ = fs::remove_dir_all(&job_dir);

    if !out.status.success() {
        return Err(format_whisper_stderr(
            &read_txt,
            &out.stderr,
            "whisper-cpp failed",
        ));
    }

    let transcript = trim_transcript(read_txt);
    if transcript.is_empty() {
        return Err(format_whisper_stderr(
            "",
            &out.stderr,
            "whisper returned empty transcript",
        ));
    }

    Ok(transcript)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn clamp_timeout(sec: Option<u64>) -> u64 {
    let v = sec.unwrap_or(TRANSCRIBE_DEFAULT_SECS);
    v.clamp(18, 240)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn whisper_thread_count() -> u32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4)
        .clamp(1, 16)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn decode_wav(b64: &str) -> Result<Vec<u8>, String> {
    let compact: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    B64_STANDARD
        .decode(compact.trim())
        .map_err(|e| format!("invalid base64 wav payload: {}", e))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn wav_too_large_err() -> String {
    format!(
        "recording too long; max wav payload is {} MiB",
        MAX_WAV_BYTES / (1024 * 1024)
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn validate_base64_payload_len(encoded_len: usize) -> Result<(), String> {
    if encoded_len > MAX_BASE64_CHARS {
        return Err(wav_too_large_err());
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn validate_decoded_wav_len(decoded_len: usize) -> Result<(), String> {
    if decoded_len > MAX_WAV_BYTES {
        return Err(wav_too_large_err());
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn resolve_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let p = app
        .path()
        .resolve(MODEL_REL, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("model path unavailable: {}", e))?;
    if !p.exists() {
        return Err(format!(
            "whisper model not found at '{}' (bundled resources may be incomplete)",
            p.display()
        ));
    }
    Ok(p)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn path_to_os_string(p: &Path) -> Result<OsString, String> {
    let s = p.as_os_str();
    if s.is_empty() {
        return Err("empty filesystem path passed to whisper".into());
    }
    Ok(s.to_owned())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn shell_err(e: impl std::fmt::Display) -> String {
    format!("could not invoke whisper-cpp sidecar: {}", e)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn format_whisper_stderr(transcript_so_far: &str, stderr: &[u8], prefix: &'static str) -> String {
    let st = transcript_so_far.trim();
    let se = std::str::from_utf8(stderr).unwrap_or("").trim();
    match (st.is_empty(), se.is_empty()) {
        (false, _) => format!("{}: {}", prefix, st),
        (_, false) => format!("{} ({})", prefix, se),
        _ => prefix.to_string(),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn trim_transcript(s: String) -> String {
    s.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_size_guards_allow_boundary_values() {
        assert!(validate_base64_payload_len(MAX_BASE64_CHARS).is_ok());
        assert!(validate_decoded_wav_len(MAX_WAV_BYTES).is_ok());
    }

    #[test]
    fn payload_size_guards_reject_oversized_values() {
        assert!(validate_base64_payload_len(MAX_BASE64_CHARS + 1).is_err());
        assert!(validate_decoded_wav_len(MAX_WAV_BYTES + 1).is_err());
    }

    #[test]
    fn timeout_is_clamped_to_expected_bounds() {
        assert_eq!(clamp_timeout(Some(1)), 18);
        assert_eq!(clamp_timeout(Some(120)), 120);
        assert_eq!(clamp_timeout(Some(999)), 240);
    }
}
