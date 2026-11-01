import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { initTheme } from './store/theme'
import { initI18n } from './i18n'
import { setNativeSelfProvider, readNativeDeviceProfile } from './lib/deviceSelf'
import './index.css'

// 先落 data-theme 再渲染，避免深色闪一帧
initTheme()

// i18n 初始化（含持久化/系统语言的 setLang 与懒加载资源）必须先于首帧：
// 组件挂载后再 addResourceBundle 不触发 react-i18next 重渲染，
// 晚到的语言资源会让已挂载的卡片永远停在 fallback 文案（实测踩过）。

/**
 * 把原生读到的设备真值注入「本机信息」。
 *
 * 之前这条通道从来没接上过（setNativeSelfProvider 无人调用），所以手机页显示的是
 * 浏览器上报的近似值：deviceMemory 分档上限 8GB、hardwareConcurrency 常被钳在 4，
 * 用户 16GB/16 核的机器会被显示成 8GB/4 核。这里改读系统真值。
 */
// 原生真值优先（手机端内存/核心数/系统版本只有原生才准）
setNativeSelfProvider(() => readNativeDeviceProfile())

const root = createRoot(document.getElementById('root')!)

// 等语言资源就绪再挂载——首帧即正确语言，杜绝晚到资源的竞态
void initI18n().finally(() => {
  root.render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  )
})
