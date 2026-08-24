package com.iem.app

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * 读取用户已授权的系统通知，把疑似支付成功的条目写入应用私有目录队列。
 * 前端启动或进入「导入 → 通知」时由 Rust 命令 drain_notify_queue 取走。
 *
 * 此服务只有在用户打开「通知使用权」后才会收到回调。
 */
class IemNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (sbn.notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return

        val extras = sbn.notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
        val body = listOf(text, big).filter { it.isNotBlank() }.distinct().joinToString(" ")
        val combined = "$title $body"
        if (!looksLikePayment(sbn.packageName, combined)) return

        val payload = JSONObject()
            .put("packageName", sbn.packageName)
            .put("title", title)
            .put("body", body)
            .put("postedAt", sbn.postTime)
        try {
            synchronized(queueLock) {
                File(filesDir, QUEUE_FILE).appendText(payload.toString() + "\n")
            }
        } catch (error: Exception) {
            Log.w("IEM", "写入通知队列失败", error)
        }
    }

    /**
     * 支付 App 的普通聊天通知很多，必须同时命中金额/付款类文案才入队。
     */
    private fun looksLikePayment(packageName: String, text: String): Boolean {
        if (!PAY_HINT.containsMatchIn(text)) return false
        if (PAY_PACKAGES.any { packageName.startsWith(it) }) return true
        return PAY_BRAND.containsMatchIn(text)
    }

    companion object {
        const val QUEUE_FILE = "iem-notify-queue.jsonl"
        private val queueLock = Any()
        private val PAY_PACKAGES = listOf(
            "com.eg.android.AlipayGphone",
            "com.tencent.mm",
            "com.icbc",
        )
        private val PAY_HINT = Regex("付款|支出|支付成功|已支付|收款|消费|转账|¥|￥|元")
        private val PAY_BRAND = Regex("支付宝|微信|工行|工商银行")
    }
}
