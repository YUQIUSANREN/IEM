# 通知监听服务与 Tauri 桥接，release 混淆后仍要能被系统绑定、被 JNI 找到。
-keep class com.iem.app.IemNotificationListener { *; }
-keep class com.iem.app.NotifyBridgePlugin { *; }
