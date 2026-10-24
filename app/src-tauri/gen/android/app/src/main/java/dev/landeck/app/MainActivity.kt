package dev.landeck.app

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

/**
 * 沉浸式：内容铺满全屏（含状态栏/导航栏区域），由网页自己用 env(safe-area-inset-*)
 * 避让 —— 这样顶部极光背景能延伸到状态栏下面，不会出现一条生硬的色块。
 *
 * enableEdgeToEdge() 已负责 setDecorFitsSystemWindows(false) 与透明系统栏；
 * 这里再显式把两个栏设成透明，兼容部分厂商 ROM 的默认值。
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // 关闭系统强制对比遮罩，否则浅色主题下导航栏会出现半透明灰条
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }
  }
}
