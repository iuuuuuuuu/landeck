package dev.landeck.app

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

/**
 * 沉浸式：内容铺满全屏（含状态栏/导航栏区域），由网页自己用 env(safe-area-inset-*)
 * 避让 —— 这样顶部极光背景能延伸到状态栏下面，不会出现一条生硬的色块。
 *
 * enableEdgeToEdge() 已负责 setDecorFitsSystemWindows(false) 与透明系统栏；
 * 这里再显式把两个栏设成透明，兼容部分厂商 ROM 的默认值。
 */
class MainActivity : TauriActivity() {
  /**
   * Android 16+：访问局域网需要运行时授予 ACCESS_LOCAL_NETWORK，
   * 否则 WebView 里的 fetch 与原生 socket 都发不出包（系统级拦截）。
   * 这里在首帧后申请一次；用户拒绝时扫描页会提示"连接失败"，可在系统设置里重新打开。
   */
  private val localNetworkPerm =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* 结果由系统记录，无需额外处理 */ }

  private fun ensureLocalNetworkPermission() {
    if (Build.VERSION.SDK_INT < 36) return
    val granted = ContextCompat.checkSelfPermission(this, "android.permission.ACCESS_LOCAL_NETWORK") ==
      PackageManager.PERMISSION_GRANTED
    if (!granted) {
      runCatching { localNetworkPerm.launch("android.permission.ACCESS_LOCAL_NETWORK") }
    }
  }

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

    ensureLocalNetworkPermission()
  }
}
