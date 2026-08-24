# Android 通知监听接入

第一期网页和桌面可以用「导入 → 通知」粘贴原文。Android 已在 `src-tauri/gen/android` 挂上 `IemNotificationListener`：用户打开「通知使用权」后，疑似付款通知写入应用私有队列，前端启动或进入该页时收进待确认。

若重新执行 `npx tauri android init` 覆盖了工程，请把本目录的 `IemNotificationListener.kt` 再拷到 `src-tauri/gen/android/app/src/main/java/com/iem/app/`，并按仓库根目录 README 第 4.7 节检查 Manifest 里的 Service 注册。

真机：系统设置 → 通知使用权 → 允许 IEM。小米还需无限制省电策略和自启动。

iOS 没有对等的通知读取接口，请继续用文件导入或粘贴。
