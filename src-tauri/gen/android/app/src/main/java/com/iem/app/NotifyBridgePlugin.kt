package com.iem.app

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * 给前端打开「通知使用权」设置页，并查询监听服务是否已启用。
 * 队列文件仍由 [IemNotificationListener] 写入，Rust 侧读取。
 */
@TauriPlugin
class NotifyBridgePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun openSettings(invoke: Invoke) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        invoke.resolve()
    }

    @Command
    fun isEnabled(invoke: Invoke) {
        val result = JSObject()
        result.put("enabled", isListenerEnabled())
        invoke.resolve(result)
    }

    private fun isListenerEnabled(): Boolean {
        val expected = ComponentName(activity, IemNotificationListener::class.java)
        val enabled = Settings.Secure.getString(
            activity.contentResolver,
            "enabled_notification_listeners",
        ) ?: return false
        return enabled.split(":").any { entry ->
            ComponentName.unflattenFromString(entry)?.equals(expected) == true
        }
    }
}
