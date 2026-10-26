package dev.landeck.app

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import org.json.JSONObject
import java.io.File
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
    writeDeviceProfile()
  }

  /**
   * 把系统真值写到应用私有文件，交给 Rust 的 device_profile 命令读取。
   *
   * 为什么不直接在 Rust 里读：安卓 10+ 把 /proc/meminfo 标成 proc_meminfo，
   * untrusted_app 读不到（返回 EACCES），于是「16GB 内存」只能显示浏览器分档的 8GB。
   * ActivityManager.MemoryInfo.totalMem 才是权威值。而 Tauri 的插件机制需要
   * Rust 侧 plugin builder + Kotlin 注解 + 权限清单三处配合，对一个只读字段过重；
   * 同一进程内用文件交接最直接，也方便 adb 侧核对。
   *
   * 注意：Rust 侧按固定包名拼路径（dev.landeck.app），改包名需同步。
   */
  private fun writeDeviceProfile() {
    try {
      val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val mi = ActivityManager.MemoryInfo()
      am.getMemoryInfo(mi)
      val o = JSONObject()
      o.put("mem_total_mb", mi.totalMem / (1024 * 1024))
      o.put("model", android.os.Build.MODEL ?: "")
      o.put("vendor", android.os.Build.MANUFACTURER ?: "")
      o.put("os_version", android.os.Build.VERSION.RELEASE ?: "")
      o.put("sdk_int", android.os.Build.VERSION.SDK_INT)
      o.put("device", android.os.Build.DEVICE ?: "")
      File(filesDir, "device_profile.json").writeText(o.toString())
    } catch (_: Throwable) {
      // 读不到就保持静默：Rust 侧会回落，前端如实显示「读不到」
    }
  }
}
