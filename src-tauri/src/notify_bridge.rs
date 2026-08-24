//! Android 通知监听桥接：注册 Kotlin 插件（打开设置 / 查询授权）。
//! 队列由 NotificationListenerService 写入 filesDir，drain 用文件系统读取。

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedNotify {
    pub package_name: String,
    pub title: String,
    pub body: String,
    pub posted_at: i64,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct EnabledResp {
    enabled: bool,
}

#[cfg(target_os = "android")]
struct AndroidBridge<R: Runtime>(tauri::plugin::PluginHandle<R>);

fn queue_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    // Android PathPlugin.getDataDir = Context.dataDir；监听服务写在 filesDir = dataDir/files。
    #[cfg(target_os = "android")]
    {
        Ok(data.join("files").join("iem-notify-queue.jsonl"))
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(data.join("iem-notify-queue.jsonl"))
    }
}

#[tauri::command]
pub fn drain_notify_queue(app: AppHandle) -> Result<Vec<QueuedNotify>, String> {
    let path = queue_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let reading = path.with_extension("jsonl.reading");
    std::fs::rename(&path, &reading).map_err(|error| error.to_string())?;
    let text = std::fs::read_to_string(&reading).map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(&reading);
    let mut items = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(item) = serde_json::from_str::<QueuedNotify>(line) {
            items.push(item);
        }
    }
    Ok(items)
}

#[tauri::command]
pub fn notification_listener_enabled(app: AppHandle) -> bool {
    #[cfg(target_os = "android")]
    {
        if let Some(bridge) = app.try_state::<AndroidBridge<tauri::Wry>>() {
            return bridge
                .0
                .run_mobile_plugin::<EnabledResp>("isEnabled", ())
                .map(|row| row.enabled)
                .unwrap_or(false);
        }
    }
    let _ = app;
    false
}

#[tauri::command]
pub fn open_notification_listener_settings(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let bridge = app
            .try_state::<AndroidBridge<tauri::Wry>>()
            .ok_or_else(|| "通知设置桥未初始化".to_string())?;
        return bridge
            .0
            .run_mobile_plugin::<serde_json::Value>("openSettings", ())
            .map(|_| ())
            .map_err(|error| error.to_string());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("仅 Android 支持打开通知使用权设置".into())
    }
}

/// 只负责在 Android 上挂上 NotifyBridgePlugin，命令走应用 invoke_handler。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("iem-notify")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.iem.app", "NotifyBridgePlugin")?;
                app.manage(AndroidBridge(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                let _ = app;
            }
            Ok(())
        })
        .build()
}
