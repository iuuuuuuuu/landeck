package dev.landeck.app

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File
import androidx.core.content.ContextCompat

/**
 * 沉浸式：内容铺满全屏（含状态栏/导航栏区域），由网页自己用 env(safe-area-inset-*)
 * 避让 —— 这样顶部极光背景能延伸到状态栏下面，不会出现一条生硬的色块。
 *
 * enableEdgeToEdge() 已负责 setDecorFitsSystemWindows(false) 与透明系统栏；
 * 这里再显式把两个栏设成透明，兼容部分厂商 ROM 的默认值。
 *
 * 六期实测补丁：Android WebView 里 env(safe-area-inset-*) 恒为 0（WebView 不消费
 * WindowInsets），页面的 .pt-safe 全部失效 —— 手机端页面内容直接顶进状态栏。
 * 修法：监听 decorView 的 WindowInsets，把状态栏/导航栏/刘海的真实像素通过
 * evaluateJavascript 写进 CSS 变量 --ldk-safe-top/bottom/left/right，
 * 页面侧 .pt-safe 等类按 max(env(), var(--ldk-safe-*)) 回退链取值。
 * insets 变化（旋转/分屏/手势栏切换）会重新派发，变量自动跟着更新。
 */
class MainActivity : TauriActivity() {
    /**
     * Android 16+：访问局域网需要运行时授予 ACCESS_LOCAL_NETWORK，
     * 否则 WebView 里的 fetch 与原生 socket 都发不出去（系统级拦截）。
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
      // 必须在 super.onCreate() 之前写：super 会创建 WebView 并加载前端，
      // 前端一挂载就 invoke('device_profile')。若此时文件还没写出来，
      // Rust 只能用 /proc/meminfo（安卓读不到）→ 内存永远是空。实测踩到过这个竞态。
      writeDeviceProfile()

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
      installSafeAreaRelay()
    }

    /**
     * 把系统 inset 换算成 CSS 变量写给 WebView。
     *
     * 时序说明：Tauri 的 WebView 在 super.onCreate() 里创建，inset 的首次派发
     * 发生在其后的首帧布局，所以 listener 里再去找 WebView 子树 —— 找不到时
     * decorView.post 兜底重发一次（只兜一次，避免循环）。
     */
    private fun installSafeAreaRelay() {
      var retried = false
      val root = window.decorView
      ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
        val bars = insets.getInsets(
          WindowInsetsCompat.Type.statusBars() or
            WindowInsetsCompat.Type.navigationBars() or
            WindowInsetsCompat.Type.displayCutout()
        )
        val web = findWebView(v)
        if (web == null) {
          if (!retried) {
            retried = true
            v.post { v.requestApplyInsets() }
          }
          Log.w("LanDeck", "safe-area: WebView 尚未挂载，post 后重发")
        } else {
          val js = buildString {
            append("document.documentElement.style.setProperty('--ldk-safe-top','${bars.top}px');")
            append("document.documentElement.style.setProperty('--ldk-safe-bottom','${bars.bottom}px');")
            append("document.documentElement.style.setProperty('--ldk-safe-left','${bars.left}px');")
            append("document.documentElement.style.setProperty('--ldk-safe-right','${bars.right}px');")
            append("window.dispatchEvent(new Event('ldk-safe-insets'));")
          }
          web.evaluateJavascript(js, null)
          Log.i("LanDeck", "safe-area: top=${bars.top} bottom=${bars.bottom} left=${bars.left} right=${bars.right}")
        }
        ViewCompat.onApplyWindowInsets(v, insets)
      }
    }

    /** 深度优先找 Tauri 的 WebView（挂在 decorView 子树的某个 ViewGroup 里）。 */
    private fun findWebView(v: View?): WebView? {
      if (v is WebView) return v
      if (v is ViewGroup) {
        for (i in 0 until v.childCount) {
          findWebView(v.getChildAt(i))?.let { return it }
        }
      }
      return null
    }

    /**
     * 把系统真值写到应用私有文件，交给 Rust 的 device_profile 命令读取。
     *
     * 为什么不直接在 Rust 里读：安卓 10+ 起 /proc/meminfo 标成 proc_meminfo，
     * untrusted_app 读不到（返回 EACCES），于是「6GB 内存」只能显示浏览器分册的 8GB。
     * 而 ActivityManager.MemoryInfo.totalMem 才是权威值。而 Tauri 的插件机制需要
     * Rust 侧 plugin builder + Kotlin 注解 + 权限清单三处配合，为一个只读字段过重；
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
        val f = File(filesDir, "device_profile.json")
        f.writeText(o.toString())
        // 用 logcat 输出，便于 adb 侧确认这段确实执行、路径与数值都对
        Log.i("LanDeck", "device_profile 写入 ${f.absolutePath} = $o")
      } catch (t: Throwable) {
        Log.w("LanDeck", "写 device_profile 失败", t)
      }
    }
  }
