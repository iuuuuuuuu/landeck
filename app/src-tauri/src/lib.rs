//! LanDeck 控制端（Tauri v2）。
//! 壳只做三件事：给 SPA 一个窗口、提供原生 UDP 广播发现、处理外部链接。
//! 其余逻辑全部在 web/ 里复用，保证和浏览器入口完全一致。

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan_lan, platform])
        .run(tauri::generate_context!())
        .expect("LanDeck 启动失败");
}
