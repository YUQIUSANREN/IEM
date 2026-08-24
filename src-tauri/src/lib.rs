//! IEM 桌面/移动入口。账本逻辑在前端 sql.js 中执行，
//! Rust 侧负责文件系统、目录选择和系统通知权限，避免再维护一套数据库。

mod notify_bridge;

use tauri::Manager;

#[tauri::command]
fn ping() -> String {
    "iem".into()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(notify_bridge::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            notify_bridge::drain_notify_queue,
            notify_bridge::notification_listener_enabled,
            notify_bridge::open_notification_listener_settings
        ])
        .setup(|app| {
            let _ = app.path().app_data_dir().map(|dir| {
                std::fs::create_dir_all(dir).ok();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running IEM");
}
