//! Persistent `whisper-server` sidecar — model stays resident; `/inference` for fast repeat transcription.
//! `transcribe.rs` falls back to `whisper-cli` if the daemon is unavailable.

use serde::Deserialize;
use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const MODEL_REL: &str = "models/ggml-base.en-q8_0.bin";
const INFER_PATH: &str = "/inference";
const HEALTH_PATH: &str = "/health";

pub struct WhisperDaemonSlot(pub Mutex<Option<Arc<WhisperDaemon>>>);

pub struct WhisperDaemon {
    client: reqwest::Client,
    base_url: String,
    queue: tokio::sync::Mutex<()>,
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

#[derive(Debug, Deserialize)]
struct InferResponse {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HealthResponse {
    status: String,
}

impl WhisperDaemon {
    pub async fn infer(&self, wav_bytes: &[u8], timeout_secs: u64) -> Result<String, String> {
        if wav_bytes.len() < 64 {
            return Err("wav too small".into());
        }
        let _job = self.queue.lock().await;

        let part = reqwest::multipart::Part::bytes(wav_bytes.to_vec())
            .file_name("speech.wav")
            .mime_str("audio/wav")
            .map_err(|e| e.to_string())?;

        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("temperature", "0.0")
            .text("temperature_inc", "0.2")
            .text("response_format", "json");

        let url = format!("{}{}", self.base_url, INFER_PATH);
        let wall = std::time::Duration::from_secs(timeout_secs.max(12).min(300));

        let resp = self
            .client
            .post(url)
            .timeout(wall)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("whisper-server request failed: {}", e))?;

        if !resp.status().is_success() {
            let code = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("whisper-server HTTP {}: {}", code, body.trim()));
        }

        let parsed: InferResponse = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(err) = parsed.error.filter(|s| !s.trim().is_empty()) {
            return Err(format!("whisper-server inference error: {err}"));
        }
        let t = parsed.text.unwrap_or_default();
        let trimmed = t.trim();
        if trimmed.is_empty() {
            return Err("whisper-server returned empty text".into());
        }
        Ok(trimmed.to_string())
    }

    fn shutdown(&self) {
        if let Ok(mut g) = self.child.lock() {
            if let Some(c) = g.take() {
                let _ = c.kill();
            }
        }
    }
}

pub async fn try_daemon_infer(
    app: &AppHandle,
    wav_bytes: &[u8],
    timeout_secs: u64,
) -> Result<String, String> {
    let slot = app
        .try_state::<WhisperDaemonSlot>()
        .ok_or_else(|| "daemon state missing".to_string())?;
    let daemon: Arc<WhisperDaemon> = {
        let guard = slot
            .0
            .lock()
            .map_err(|_| "daemon mutex poisoned".to_string())?;
        let Some(d) = guard.as_ref() else {
            return Err("daemon not running".into());
        };
        d.clone()
    };
    daemon.infer(wav_bytes, timeout_secs).await
}

pub fn on_app_run_event(app: &AppHandle, event: &RunEvent) {
    if matches!(event, RunEvent::Exit) {
        shutdown_daemon(app);
    }
}

/// True when `whisper-server` is running and inference uses HTTP (cheap partial hints).
pub fn is_daemon_running(app: &AppHandle) -> bool {
    let Some(slot) = app.try_state::<WhisperDaemonSlot>() else {
        return false;
    };
    let Ok(guard) = slot.0.lock() else {
        return false;
    };
    guard.is_some()
}

pub fn shutdown_daemon(app: &AppHandle) {
    let taken = app
        .try_state::<WhisperDaemonSlot>()
        .and_then(|st| st.0.lock().ok().and_then(|mut g| g.take()));

    if let Some(d) = taken {
        d.shutdown();
    }
}

pub fn start_daemon_background(app: AppHandle) {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = app;

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        tauri::async_runtime::spawn(async move {
            match spawn_daemon(&app).await {
                Ok(daemon) => {
                    if let Some(slot) = app.try_state::<WhisperDaemonSlot>() {
                        if let Ok(mut g) = slot.0.lock() {
                            *g = Some(Arc::new(daemon));
                        }
                    }
                    log::info!("whisper-server daemon ready");
                }
                Err(e) => {
                    log::warn!(
                        "whisper-server daemon unavailable ({e}); whisper-cli fallback will be used"
                    );
                }
            }
        });
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn resolve_exe_path(candidate: PathBuf, label: &'static str) -> Result<PathBuf, String> {
    let p = fs::canonicalize(&candidate).unwrap_or(candidate);
    if !p.exists() {
        return Err(format!("{label} path does not exist: {}", p.display()));
    }
    Ok(p)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn spawn_daemon(app: &AppHandle) -> Result<WhisperDaemon, String> {
    let model_path = app
        .path()
        .resolve(MODEL_REL, tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !model_path.exists() {
        return Err(format!("model missing at {}", model_path.display()));
    }

    let public_dir = app
        .path()
        .resolve("whisper_public", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !public_dir.is_dir() {
        return Err(format!(
            "missing whisper_public at {} — add resources/whisper_public to bundle.resources",
            public_dir.display()
        ));
    }

    let model_path = resolve_exe_path(model_path, "model")?;
    let public_dir = resolve_exe_path(public_dir, "whisper public")?;

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);

    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(1, 16).to_string())
        .unwrap_or_else(|_| "4".into());

    let model_s = model_path.to_string_lossy().to_string();
    let public_s = public_dir.to_string_lossy().to_string();
    let host = "127.0.0.1";
    let port_s = port.to_string();

    // Sidecars are emitted next to the app binary (`whisper-server.exe`), not under `binaries/`.
    let sidecar = app
        .shell()
        .sidecar("whisper-server")
        .map_err(|e| e.to_string())?;

    let (mut rx, child) = sidecar
        .args([
            "-m",
            &model_s,
            "--host",
            host,
            "--port",
            &port_s,
            "--inference-path",
            INFER_PATH,
            "--public",
            &public_s,
            "-l",
            "en",
            "-t",
            &threads,
            "-sns",
            "-nt",
        ])
        .spawn()
        .map_err(|e| format!("spawn whisper-server: {}", e))?;

    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if let CommandEvent::Stderr(line) = ev {
                let s = String::from_utf8_lossy(&line);
                let t = s.trim();
                if !t.is_empty() {
                    log::debug!("[whisper-server] {}", t);
                }
            }
        }
    });

    wait_for_tcp(port).await?;

    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(4)
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let base_url = format!("http://127.0.0.1:{port}");
    wait_for_health_ready(&client, &base_url).await?;

    let daemon = WhisperDaemon {
        client,
        base_url,
        queue: tokio::sync::Mutex::new(()),
        child: Mutex::new(Some(child)),
    };

    let warm = silence_wav_16k_mono_ms(320);
    if let Err(e) = daemon.infer(&warm, 45).await {
        log::debug!("daemon warmup benign fail: {}", e);
    }

    Ok(daemon)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn wait_for_health_ready(client: &reqwest::Client, base_url: &str) -> Result<(), String> {
    // TCP accepts before whisper.cpp finishes loading weights; `/health` is 503 until ready.
    let url = format!("{base_url}{HEALTH_PATH}");
    let probe = std::time::Duration::from_secs(3);
    for attempt in 0..1200 {
        match client.get(&url).timeout(probe).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(h) = resp.json::<HealthResponse>().await {
                    if h.status == "ok" {
                        return Ok(());
                    }
                }
            }
            _ => {}
        }
        if attempt > 0 && attempt % 25 == 0 {
            log::debug!("waiting for whisper-server model load ({base_url})…");
        }
        tokio::time::sleep(std::time::Duration::from_millis(75)).await;
    }
    Err(format!(
        "whisper-server never reported ready at {base_url}{HEALTH_PATH}"
    ))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn wait_for_tcp(port: u16) -> Result<(), String> {
    let addr = format!("127.0.0.1:{port}");
    for _ in 0..100 {
        if std::net::TcpStream::connect(&addr).is_ok() {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    }
    Err(format!(
        "whisper-server failed to open port {port} within timeout"
    ))
}

fn silence_wav_16k_mono_ms(ms: u32) -> Vec<u8> {
    let sample_rate: u32 = 16000;
    let n = ((sample_rate * ms) / 1000).max(400) as usize;
    let data_bytes = n * 2;
    let riff_len = (36 + data_bytes) as u32;
    let mut v = Vec::with_capacity(44 + data_bytes);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&riff_len.to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&sample_rate.to_le_bytes());
    v.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    v.extend_from_slice(&2u16.to_le_bytes());
    v.extend_from_slice(&16u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&(data_bytes as u32).to_le_bytes());
    v.resize(44 + data_bytes, 0);
    v
}
