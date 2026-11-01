// A7 更新签名链验证：用 updater 同款 minisign-verify（0.3.0）。
//
// tauri 的 .sig 与公钥都是「外层 base64(内层 minisign 文本)」的双层结构：
//   .sig 文件内容 = base64("untrusted comment: signature from tauri secret key\n<sig>")
//   公钥 blob     = base64("untrusted comment: minisign public key: <id>\n<key>")
// 所以测试先解外层 base64，再用内层文本走 minisign 标准验签。
// 没有 mock——安装包与签名都是真构建产物。
#[cfg(test)]
mod updater_signature_tests {
    use base64::Engine as _;
    use minisign_verify::{PublicKey, Signature};

    /// tauri.conf.json plugins.updater.pubkey 的值（外层 blob）。
    const PUBKEY_BLOB: &str =
        "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDNCNEI4MDUzNURBQTZEMzYKUldRMmJhcGRVNEJMTzNLWHlGRG9pejZZRXgyckhyVE5oQXZSQnhZT3RjZjlYR3h5eUdVRkpnU3AK";

    fn read(path: &str) -> Option<Vec<u8>> {
        std::fs::read(path).ok()
    }

    fn installer_and_sig() -> Option<(Vec<u8>, Vec<u8>)> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/release/bundle/nsis");
        let exe = read(dir.join("LanDeck_1.0.19_x64-setup.exe").to_str()?)?;
        let sig = read(dir.join("LanDeck_1.0.19_x64-setup.exe.sig").to_str()?)?;
        Some((exe, sig))
    }

    /// 外层 base64 解码 → 内层 minisign 文本 → Signature。
    fn decode_tauri_sig(raw: &[u8]) -> Signature {
        let blob = base64::engine::general_purpose::STANDARD
            .decode(raw)
            .expect("sig 外层 base64 解码");
        let inner = String::from_utf8(blob).expect("sig 内层 utf8");
        Signature::decode(&inner).expect("内层 minisign 签名解析")
    }

    fn pubkey() -> PublicKey {
        let blob = base64::engine::general_purpose::STANDARD
            .decode(PUBKEY_BLOB)
            .expect("公钥外层 base64 解码");
        let inner = String::from_utf8(blob).expect("公钥内层 utf8");
        let key_line = inner.lines().last().expect("公钥内层至少一行");
        PublicKey::from_base64(key_line).expect("内层 key base64 解析")
    }

    /// 真实产物 + 真实签名 + 配置公钥 → 验签必须通过。
    /// 产物缺失（CI 上没跑过本地构建）时跳过而不是失败。
    #[test]
    fn updater_signature_chain_verifies() {
        let Some((artifact, sig)) = installer_and_sig() else {
            eprintln!("skip: 本机没有 1.0.19 安装包产物");
            return;
        };
        let signature = decode_tauri_sig(&sig);
        assert!(
            pubkey().verify(&artifact, &signature, false).is_ok(),
            "真实安装包 + .sig 必须通过 updater 同款验签"
        );
    }

    /// 故障注入：篡改产物一个字节，验签必须失败（否则签名形同虚设）。
    #[test]
    fn updater_signature_rejects_tampered_artifact() {
        let Some((artifact, sig)) = installer_and_sig() else {
            eprintln!("skip: 本机没有 1.0.19 安装包产物");
            return;
        };
        let mut tampered = artifact.clone();
        let mid = tampered.len() / 2;
        tampered[mid] ^= 0xFF;
        let signature = decode_tauri_sig(&sig);
        assert!(
            pubkey().verify(&tampered, &signature, false).is_err(),
            "被篡改的安装包必须验签失败"
        );
        // 原产物必须仍然通过（排除「实现把一切判失败」的假实现）
        assert!(
            pubkey().verify(&artifact, &signature, false).is_ok(),
            "原始产物必须仍然通过（对照组）"
        );
    }
}
