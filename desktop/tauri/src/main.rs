//! Chesster — обёртка Tauri v2 для браузерных шахмат.
//! Фронтенд — тот же index.html, что и в браузере и в Electron.
//! Команды повторяют окно window.Chesster из preload.js Electron, чтобы
//! слой Platform в src/platform.js работал с обеими обёртками одинаково.
//!
//! Сборка:  cargo tauri dev   /   cargo tauri build
//! Требуется Rust + зависимости Tauri v2 (см. tauri.conf.json).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Состояние внешнего UCI-движка (путь для настоящего Rodent IV в десктопе).
pub struct EngineState {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
}

impl Default for EngineState {
    fn default() -> Self {
        Self { child: Arc::new(Mutex::new(None)), stdin: Arc::new(Mutex::new(None)) }
    }
}

/// Нативное сохранение файла через системный диалог.
#[tauri::command]
fn save_file(app: AppHandle, name: String, data: Vec<u8>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_file_name(name.clone())
        .add_filter("Шахматные файлы PGN", &["pgn", "txt"])
        .save_file(move |path| {
            let res = match path {
                Some(p) => {
                    let p = p.into_path().map_err(|e| e.to_string());
                    match p {
                        Ok(p) => fs::write(&p, &data).map(|_| p.display().to_string()).map_err(|e| e.to_string()),
                        Err(e) => Err(e),
                    }
                }
                None => Err("отменено".to_string()),
            };
            let _ = tx.send(res);
        });
    rx.recv().map_err(|e| e.to_string())?
}

/// Открытие внешней ссылки (Lichess) в системном браузере.
#[tauri::command]
fn open_external(url: String) -> Result<bool, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("разрешены только http(s)".to_string());
    }
    #[cfg(target_os = "windows")]
    { Command::new("cmd").args(["/C", "start", "", &url]).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "linux")]
    { Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?; }
    Ok(true)
}

/// Запуск внешнего UCI-движка отдельным процессом.
#[tauri::command]
fn engine_spawn(app: AppHandle, state: State<EngineState>, exe: String) -> Result<u32, String> {
    let mut child = Command::new(&exe)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("нет stdout")?;
    *state.stdin.lock().unwrap() = stdin;
    *state.child.lock().unwrap() = Some(child);

    let handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = handle.emit("engine:line", line);
        }
        let _ = handle.emit("engine:exit", 0i32);
    });
    Ok(pid)
}

#[tauri::command]
fn engine_write(state: State<EngineState>, line: String) -> Result<(), String> {
    let mut guard = state.stdin.lock().unwrap();
    let stdin = guard.as_mut().ok_or("движок не запущен")?;
    stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn engine_kill(state: State<EngineState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    *state.stdin.lock().unwrap() = None;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![
            save_file, open_external, engine_spawn, engine_write, engine_kill
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска Chesster (Tauri)");
}
