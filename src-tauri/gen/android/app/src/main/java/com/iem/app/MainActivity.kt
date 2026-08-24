package com.iem.app

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * 账本按固定布局使用：关掉缩放，并把 WebView 宽度对齐系统左右安全区。
   * 不设 loadWithOverviewMode，避免按内容最小宽度缩放后仍超出可视区域。
   */
  override fun onWebViewCreate(webView: WebView) {
    val settings = webView.settings
    settings.setSupportZoom(false)
    settings.builtInZoomControls = false
    settings.displayZoomControls = false
    settings.useWideViewPort = true
    settings.loadWithOverviewMode = false
    settings.textZoom = 100
    webView.setInitialScale(0)
    webView.isHorizontalScrollBarEnabled = false
    webView.overScrollMode = View.OVER_SCROLL_NEVER

    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      // 只吃左右；上下交给 CSS env(safe-area-inset-*)，避免底栏双重留白。
      view.setPadding(bars.left, 0, bars.right, 0)
      insets
    }
  }
}
