//! LanDeck 控制端（Tauri v2）。
//! 壳只做三件事：给 SPA 一个窗口、提供原生 UDP 广播发现、处理外部链接。
//! 其余逻辑全部在 web/ 里复用，保证和浏览器入口完全一致。

mod autostart;
mod prefs;

use serde::Serialize;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

#[derive(Serialize)]
struct Node {
    v: u32,
    id: String,
    name: String,
    ip: String,
    port: u16,
    tls: bool,
    ver: String,
    os: String,
    arch: String,
    paired: bool,
}

/// 扫描局域网内的 Agent：先发 UDP 探测包，再收应答。
/// 端口固定 8421（与 Agent 的发现端口一致），超时 900ms。
#[tauri::command]
fn scan_lan() -> Vec<Node> {
    let mut out: Vec<Node> = Vec::new();
    let socket = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
        Ok(s) => s,
        Err(_) => return out,
    };
    let _ = socket.set_broadcast(true);
    let _ = socket.set_read_timeout(Some(Duration::from_millis(250)));

    let probe = b"LANDECK_DISCOVER_V1";
    let port = 8421u16;

    // 全局广播 + 每个网卡的定向广播（后者在有多个网段/VPN 时更可靠）
    let mut targets: Vec<Ipv4Addr> = vec![Ipv4Addr::BROADCAST];
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                let ip = u32::from(v4.ip);
                let mask = u32::from(v4.netmask);
                let bcast = Ipv4Addr::from(ip | !mask);
                if !targets.contains(&bcast) {
                    targets.push(bcast);
                }
            }
        }
    }
    for t in &targets {
        let _ = socket.send_to(probe, SocketAddrV4::new(*t, port));
    }

    let deadline = Instant::now() + Duration::from_millis(900);
    let mut buf = [0u8; 2048];
    while Instant::now() < deadline {
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) {
                    let get_str = |k: &str| value.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let id = get_str("id");
                    if id.is_empty() || out.iter().any(|x| x.id == id) {
                        continue;
                    }
                    out.push(Node {
                        v: value.get("v").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
                        id,
                        name: get_str("name"),
                        ip: {
                            let ip = get_str("ip");
                            if ip.is_empty() { from.ip().to_string() } else { ip }
                        },
                        port: value.get("port").and_then(|v| v.as_u64()).unwrap_or(8420) as u16,
                        tls: value.get("tls").and_then(|v| v.as_bool()).unwrap_or(false),
                        ver: get_str("ver"),
                        os: get_str("os"),
                        arch: get_str("arch"),
                        paired: value.get("paired").and_then(|v| v.as_bool()).unwrap_or(false),
                    });
                }
            }
            Err(_) => continue,
        }
    }
    out
}

#[tauri::command]
fn platform() -> String {
    std::env::consts::OS.to_string()
}

/// 返回本机的私有 IPv4，供前端推导要扫的网段。
/// Tauri 里页面 hostname 是 tauri.localhost，前端拿不到内网地址，必须由原生层提供。
#[tauri::command]
fn local_ip() -> Option<String> {
    let ifaces = if_addrs::get_if_addrs().ok()?;
    let mut fallback: Option<String> = None;
    for iface in ifaces {
        if iface.is_loopback() {
            continue;
        }
        if let if_addrs::IfAddr::V4(v4) = iface.addr {
            let ip = v4.ip;
            let o = ip.octets();
            let private = o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168);
            if private {
                // 优先真实网卡，跳过常见的虚拟网卡段（WSL/Hyper-V/VirtualBox 也用私有网段，
                // 但通常排在后面；这里先记下第一个，最后返回最像物理网的）
                let name = iface.name.to_lowercase();
                if name.contains("wsl") || name.contains("vethernet") || name.contains("virtual") || name.contains("vmware") {
                    if fallback.is_none() {
                        fallback = Some(ip.to_string());
                    }
                    continue;
                }
                return Some(ip.to_string());
            }
        }
    }
    fallback
}

/// 开机自启：Windows 写 HKCU\...\Run，macOS 写 LaunchAgent，Linux 写 XDG autostart。
/// 读主题偏好（system | dark | light）
#[tauri::command]
fn theme_get(app: tauri::AppHandle) -> String {
    prefs::load(&app).theme
}

/// 写主题偏好。桌面端持久化到磁盘，不依赖 WebView 的 localStorage。
#[tauri::command]
fn theme_set(app: tauri::AppHandle, mode: String) -> Result<String, String> {
    let mode = match mode.as_str() {
        "dark" | "light" | "system" => mode,
        other => return Err(format!("未知主题：{other}")),
    };
    let mut p = prefs::load(&app);
    p.theme = mode.clone();
    prefs::save(&app, &p)?;
    Ok(mode)
}

#[tauri::command]
fn autostart_get() -> bool {
    autostart::is_enabled()
}

#[tauri::command]
fn autostart_set(enabled: bool) -> Result<bool, String> {
    if enabled {
        autostart::enable()?;
    } else {
        autostart::disable()?;
    }
    Ok(autostart::is_enabled())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_lan,
            platform,
            local_ip,
            autostart_get,
            autostart_set,
            theme_get,
            theme_set
        ])
        .run(tauri::generate_context!())
        .expect("LanDeck 启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 实机验证：本机必须能解析出私有 IPv4（Tauri 里前端靠它推导网段）。
    #[test]
    fn local_ip_returns_private_v4() {
        let ip = local_ip().expect("本机应至少有一个私有 IPv4");
        let o: Vec<u8> = ip.split('.').map(|p| p.parse().unwrap()).collect();
        assert_eq!(o.len(), 4, "不是点分四段: {ip}");
        let private = o[0] == 10
            || (o[0] == 172 && (16..=31).contains(&o[1]))
            || (o[0] == 192 && o[1] == 168);
        assert!(private, "返回的不是私有地址: {ip}");
        println!("local_ip = {ip}");
    }

    /// 实机验证：自启开关的行为。
    ///
    /// 注意：这台开发机上有安全软件会拦截「非交互进程创建自启项」，
    /// 所以这里不强制要求 enable 成功 —— 但要区分两种情况：
    ///   a) 被拦截：必须给出明确错误（不能静默失败），测试通过；
    ///   b) 没被拦截：必须真的写进去、真的删掉。
    /// 两者都不允许「返回 Ok 但实际没生效」。
    #[test]
    fn autostart_roundtrip() {
        let before = autostart::is_enabled();
        match autostart::enable() {
            Ok(()) => {
                assert!(autostart::is_enabled(), "enable 返回成功但状态没变 —— 假成功");
                autostart::disable().expect("关闭自启失败");
                assert!(!autostart::is_enabled(), "disable 后仍为启用 —— 假关闭");
                if before {
                    let _ = autostart::enable();
                }
                println!("autostart roundtrip ok (before={before})");
            }
            Err(e) => {
                assert!(!e.is_empty(), "失败必须给出原因");
                assert!(!autostart::is_enabled(), "enable 报错却已生效，状态不一致");
                println!("autostart 被环境拦截（已正确上报错误）：{e}");
            }
        }
    }

    /// 实机验证：UDP 广播必须能发现同网段正在运行的 Agent。
    /// 需要本机 Agent 在跑；没有则跳过（但会打印明确原因，不静默通过）。
    #[test]
    fn scan_lan_finds_local_agent() {
        let nodes = scan_lan();
        println!("发现 {} 台设备", nodes.len());
        for n in &nodes {
            println!("  {} {} {}:{}", n.name, n.os, n.ip, n.port);
        }
        if nodes.is_empty() {
            // 用 HTTP 直连再确认一次：区分「广播不通」与「Agent 没跑」
            let http_ok = std::net::TcpStream::connect_timeout(
                &"127.0.0.1:8420".parse().unwrap(),
                Duration::from_millis(500),
            )
            .is_ok();
            assert!(!http_ok, "Agent 在 8420 上可用，但 UDP 广播没发现它 —— 广播链路有问题");
            println!("跳过：本机 8420 没有 Agent 在跑，无法验证广播");
        } else {
            assert!(nodes.iter().all(|n| !n.id.is_empty() && n.port > 0));
        }
    }
}
