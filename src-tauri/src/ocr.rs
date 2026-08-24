//! 系统 OCR：Android 走 ML Kit 中文包，Windows 走系统光学字符识别。
//! 除全文外回传每行框，坐标相对压缩后送去识字的那张图（不是屏幕）。
//! 浏览器 / 其他桌面系统没有对应 API，命令直接返回说明。

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct AndroidOcr<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// 一行字及其在识图图上的像素框。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrBlock {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 前端用 imageWidth/imageHeight 把框换成相对位置，猜头像旁店名。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRecognizeOut {
    pub text: String,
    pub image_width: u32,
    pub image_height: u32,
    pub blocks: Vec<OcrBlock>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrReq {
    image_base64: String,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrResp {
    text: String,
    #[serde(default)]
    image_width: u32,
    #[serde(default)]
    image_height: u32,
    #[serde(default)]
    blocks: Vec<OcrBlock>,
}

#[tauri::command]
pub async fn ocr_recognize(app: AppHandle, image_base64: String) -> Result<OcrRecognizeOut, String> {
    let raw = strip_data_url(&image_base64);
    if raw.is_empty() {
        return Err("没有读到图片".into());
    }
    // 系统 OCR 是阻塞调用，放到工作线程，避免卡住 WebView 的 IPC。
    tauri::async_runtime::spawn_blocking(move || ocr_recognize_sync(app, raw))
        .await
        .map_err(|_| "OCR 中断".to_string())?
}

fn ocr_recognize_sync(app: AppHandle, raw: String) -> Result<OcrRecognizeOut, String> {
    #[cfg(target_os = "android")]
    {
        let bridge = app
            .try_state::<AndroidOcr<tauri::Wry>>()
            .ok_or_else(|| "OCR 桥未初始化".to_string())?;
        let resp = bridge
            .0
            .run_mobile_plugin::<OcrResp>("recognize", OcrReq { image_base64: raw })
            .map_err(|error| error.to_string())?;
        let text = resp.text.trim().to_string();
        if text.is_empty() {
            return Err("没有识别到文字，请换一张更清晰的账单截图".into());
        }
        return Ok(OcrRecognizeOut {
            text,
            image_width: resp.image_width,
            image_height: resp.image_height,
            blocks: resp.blocks,
        });
    }

    #[cfg(target_os = "windows")]
    {
        let _ = app;
        return ocr_windows(&raw);
    }

    #[cfg(not(any(target_os = "android", target_os = "windows")))]
    {
        let _ = app;
        Err("当前环境没有系统 OCR。请在 Android 或 Windows 版 IEM 里使用识图。".into())
    }
}

fn strip_data_url(input: &str) -> String {
    match input.split_once("base64,") {
        Some((_, data)) => data.trim().to_string(),
        None => input.trim().to_string(),
    }
}

#[cfg(target_os = "windows")]
fn ocr_windows(b64: &str) -> Result<OcrRecognizeOut, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|_| "图片数据损坏".to_string())?;
    if bytes.is_empty() {
        return Err("没有读到图片".into());
    }
    std::thread::Builder::new()
        .name("iem-ocr".into())
        .spawn(move || ocr_windows_inner(&bytes))
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|_| "OCR 线程失败".to_string())?
}

/// WinRT OCR 要在独立线程里跑，避免和 Tauri 的异步运行时抢 COM 套间。
#[cfg(target_os = "windows")]
fn ocr_windows_inner(bytes: &[u8]) -> Result<OcrRecognizeOut, String> {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    let stream = InMemoryRandomAccessStream::new().map_err(win_err)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(win_err)?;
    writer.WriteBytes(bytes).map_err(win_err)?;
    writer.StoreAsync().map_err(win_err)?.get().map_err(win_err)?;
    writer.FlushAsync().map_err(win_err)?.get().map_err(win_err)?;
    drop(writer);
    stream.Seek(0).map_err(win_err)?;

    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(win_err)?
        .get()
        .map_err(win_err)?;
    let raw_bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(win_err)?
        .get()
        .map_err(win_err)?;
    let bitmap = SoftwareBitmap::ConvertWithAlpha(
        &raw_bitmap,
        BitmapPixelFormat::Bgra8,
        BitmapAlphaMode::Premultiplied,
    )
    .map_err(win_err)?;
    let image_width = bitmap.PixelWidth().map_err(win_err)?.max(0) as u32;
    let image_height = bitmap.PixelHeight().map_err(win_err)?.max(0) as u32;

    let engine = Language::CreateLanguage(&HSTRING::from("zh-Hans"))
        .ok()
        .and_then(|lang| OcrEngine::TryCreateFromLanguage(&lang).ok())
        .or_else(|| OcrEngine::TryCreateFromUserProfileLanguages().ok())
        .ok_or_else(|| {
            "无法使用系统 OCR。请在 Windows 设置 → 时间和语言 → 语言 中添加「中文（简体）」，并安装光学字符识别。"
                .to_string()
        })?;

    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(win_err)?
        .get()
        .map_err(win_err)?;
    let text = result.Text().map_err(win_err)?.to_string().trim().to_string();
    if text.is_empty() {
        return Err("没有识别到文字，请换一张更清晰的账单截图".into());
    }

    let mut blocks = Vec::new();
    if let Ok(lines) = result.Lines() {
        let count = lines.Size().map_err(win_err)?;
        for i in 0..count {
            let line = lines.GetAt(i).map_err(win_err)?;
            let line_text = line.Text().map_err(win_err)?.to_string().trim().to_string();
            if line_text.is_empty() {
                continue;
            }
            let Some(box_px) = line_union_rect(&line)? else {
                continue;
            };
            blocks.push(OcrBlock {
                text: line_text,
                x: box_px.0,
                y: box_px.1,
                w: box_px.2,
                h: box_px.3,
            });
        }
    }

    Ok(OcrRecognizeOut {
        text,
        image_width,
        image_height,
        blocks,
    })
}

/// WinRT 只给每个词一个框，合成行框后才能和 Android 的 line box 对齐。
#[cfg(target_os = "windows")]
fn line_union_rect(line: &windows::Media::Ocr::OcrLine) -> Result<Option<(f64, f64, f64, f64)>, String> {
    let words = line.Words().map_err(win_err)?;
    let count = words.Size().map_err(win_err)?;
    if count == 0 {
        return Ok(None);
    }
    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;
    for i in 0..count {
        let word = words.GetAt(i).map_err(win_err)?;
        let rect = word.BoundingRect().map_err(win_err)?;
        min_x = min_x.min(rect.X);
        min_y = min_y.min(rect.Y);
        max_x = max_x.max(rect.X + rect.Width);
        max_y = max_y.max(rect.Y + rect.Height);
    }
    if !min_x.is_finite() || max_x <= min_x || max_y <= min_y {
        return Ok(None);
    }
    Ok(Some((
        f64::from(min_x),
        f64::from(min_y),
        f64::from(max_x - min_x),
        f64::from(max_y - min_y),
    )))
}

#[cfg(target_os = "windows")]
fn win_err(error: windows::core::Error) -> String {
    error.to_string()
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("iem-ocr")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.iem.app", "OcrPlugin")?;
                app.manage(AndroidOcr(handle));
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
