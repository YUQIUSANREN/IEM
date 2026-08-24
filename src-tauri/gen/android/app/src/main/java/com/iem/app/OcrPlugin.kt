package com.iem.app

import android.app.Activity
import android.graphics.BitmapFactory
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject

@InvokeArg
class OcrRecognizeArgs {
    var imageBase64: String = ""
}

/**
 * 端上中文 OCR（ML Kit 随包模型，不访问网络）。
 * 图片由前端压成 JPEG base64 再传入，避免原图太大卡住 WebView。
 * 行框坐标相对这张已解码图，供前端按版式猜商家。
 */
@TauriPlugin
class OcrPlugin(private val activity: Activity) : Plugin(activity) {
    private val recognizer = TextRecognition.getClient(
        ChineseTextRecognizerOptions.Builder().build(),
    )

    @Command
    fun recognize(invoke: Invoke) {
        val args = invoke.parseArgs(OcrRecognizeArgs::class.java)
        val payload = args.imageBase64.trim()
        if (payload.isEmpty()) {
            invoke.reject("没有读到图片")
            return
        }
        val bytes = try {
            Base64.decode(payload, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            invoke.reject("图片数据损坏")
            return
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (bitmap == null) {
            invoke.reject("无法解码图片，请换 JPEG 或 PNG")
            return
        }
        val image = InputImage.fromBitmap(bitmap, 0)
        // 后台线程等待 ML Kit，避免和 Tauri 阻塞式插件调用抢主线程。
        Thread({
            try {
                val result = Tasks.await(recognizer.process(image))
                val blocks = JSONArray()
                for (block in result.textBlocks) {
                    for (line in block.lines) {
                        val box = line.boundingBox ?: continue
                        val text = line.text.trim()
                        if (text.isEmpty()) continue
                        val item = JSONObject()
                        item.put("text", text)
                        item.put("x", box.left.toDouble())
                        item.put("y", box.top.toDouble())
                        item.put("w", box.width().toDouble())
                        item.put("h", box.height().toDouble())
                        blocks.put(item)
                    }
                }
                val obj = JSObject()
                obj.put("text", result.text.trim())
                obj.put("imageWidth", bitmap.width)
                obj.put("imageHeight", bitmap.height)
                obj.put("blocks", blocks)
                invoke.resolve(obj)
            } catch (error: Exception) {
                invoke.reject(error.message ?: "识别失败")
            } finally {
                bitmap.recycle()
            }
        }, "iem-ocr").start()
    }
}
