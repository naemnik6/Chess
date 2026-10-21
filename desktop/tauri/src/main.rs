//! Chesster — обёртка Tauri v2 для браузерных шахмат.
//! Фронтенд — тот же index.html, что и в браузере и в Electron: он копируется
//! в desktop/tauri/dist/ скриптом build.js (frontendDist указывает именно туда,
//! чтобы в бинарник не попал весь репозиторий вместе с node_modules).
//! Команды повторяют окно window.Chesster из preload.js Electron, чтобы
//! слой Platform в src/platform.js работал с обеими обёртками одинаково.
//!
//! Сборка:  cargo tauri dev   /   cargo tauri build
//! Перед первой сборкой: cd ../.. && node build.js  (создаст dist/index.html).
//! Требуется Rust + системные зависимости Tauri v2 (см. TAURI.md).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

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

/// Остановить движок, если он запущен: сначала закрываем stdin, затем процесс.
/// Вызывается перед новым запуском и при выходе из приложения (как в Electron),
/// чтобы не оставлять висящих процессов Rodent IV.
fn kill_engine(state: &EngineState) {
    *state.stdin.lock().unwrap() = None;
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Все команды помечены `(async)`: без этого Tauri выполняет их в главном
/// потоке, а диалоги и ожидание ответа заблокировали бы окно (вплоть до
/// взаимной блокировки, когда диалог ждёт главный поток, а команда — диалог).

/// Нативное сохранение файла через системный диалог.
/// Данные передаются текстом (PGN/JSON): приложение сохраняет только текст,
/// а вложенные Uint8Array в JSON-IPC Tauri не переносятся (raw-транспорт
/// доступен только для ArrayBuffer всем аргументом целиком).
#[tauri::command(async)]
fn save_file(app: AppHandle, name: String, data: String) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_file_name(name.clone())
        .add_filter("Шахматные файлы PGN", &["pgn", "txt"])
        .save_file(move |path| {
            let res = match path {
                Some(p) => match p.into_path() {
                    Ok(pb) => fs::write(&pb, data.as_bytes())
                        .map(|_| pb.display().to_string())
                        .map_err(|e| e.to_string()),
                    Err(e) => Err(e.to_string()),
                },
                None => Err("отменено".to_string()),
            };
            let _ = tx.send(res);
        });
    rx.recv().map_err(|e| e.to_string())?
}

/// Открытие внешней ссылки (Lichess, страница релизов) в системном браузере.
/// В Windows идём через rundll32, а не через cmd: оболочка разбила бы адрес
/// по символам & и потребовала бы экранирования кавычек.
#[tauri::command(async)]
fn open_external(url: String) -> Result<bool, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("разрешены только http(s)".to_string());
    }
    if url.len() > 4000 || url.chars().any(|c| c.is_control() || c.is_whitespace() || c == '"' || c == '\'') {
        return Err("недопустимые символы в адресе".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url])
            .spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(true)
}

/// Выбор исполняемого файла движка (диалог открытия).
/// Ответ совпадает с Electron: { canceled, path }.
#[tauri::command(async)]
fn pick_engine(app: AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Исполняемые файлы", &["exe", "bin"])
        .pick_file(move |path| {
            let v = match path {
                Some(p) => match p.into_path() {
                    Ok(pb) => serde_json::json!({ "canceled": false, "path": pb.display().to_string() }),
                    Err(e) => serde_json::json!({ "canceled": true, "error": e.to_string() }),
                },
                None => serde_json::json!({ "canceled": true }),
            };
            let _ = tx.send(v);
        });
    rx.recv().map_err(|e| e.to_string())?
}

/// Запуск внешнего UCI-движка отдельным процессом.
#[tauri::command(async)]
fn engine_spawn(app: AppHandle, state: State<EngineState>, exe: String) -> Result<u32, String> {
    kill_engine(&state);                    /* как в Electron: один движок за раз */
    let mut cmd = Command::new(&exe);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    /* консольные UCI-движки под Windows не должны открывать чёрное окно */
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("нет stdout")?;
    *state.stdin.lock().unwrap() = stdin;
    *state.child.lock().unwrap() = Some(child);

    let handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => { let _ = handle.emit("engine:line", text); }
                Err(e) => {
                    let _ = handle.emit("engine:error", e.to_string());
                    break;
                }
            }
        }
        let _ = handle.emit("engine:exit", 0i32);
    });
    Ok(pid)
}

#[tauri::command(async)]
fn engine_write(state: State<EngineState>, line: String) -> Result<(), String> {
    let mut guard = state.stdin.lock().unwrap();
    let stdin = guard.as_mut().ok_or("движок не запущен")?;
    stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn engine_kill(state: State<EngineState>) -> Result<(), String> {
    kill_engine(&state);
    Ok(())
}

fn main() {
    /* Мост window.Chesster внедряется до загрузки страницы: platform.js
       сразу видит обёртку (как preload.js в Electron). Версия подставляется
       из Cargo.toml — она же отображается в «О программе». */
    let bridge = include_str!("../bridge.js").replace("__CT_VER__", env!("CARGO_PKG_VERSION"));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .initialization_script(&bridge)
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![
            save_file, open_external, pick_engine, engine_spawn, engine_write, engine_kill
        ])
        .build(tauri::generate_context!())
        .expect("ошибка запуска Chesster (Tauri)");

    app.run(|app_handle, event| {
        /* закрыли окно или вышли из приложения — глушим процесс движка */
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<EngineState>() {
                kill_engine(&state);
            }
        }
    });
}
